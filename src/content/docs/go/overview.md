---
title: Go 版实现概览
description: pcdn-detector 的运行模型、抓包方案、模块划分与关键设计取舍。
---

`pcdn-detector` 是 Go 版参考实现：纯 Go、`CGO_ENABLED=0`，交叉编译出静态二进制，安装后即可在
OpenWrt 上运行。本页说明它的内部结构，供二次开发、排查问题或对照 C 版阅读源码时使用。

通用配置与功能见[配置总览](/config/overview/)；Go / C 选型见[选择后端实现](/deploy/choose/)。

## 运行模型

单进程，若干 goroutine 各司其职：

| 组件 | 职责 |
| --- | --- |
| 抓包循环 | 从 `AF_PACKET` 环形缓冲取帧，解析后交给检测器 |
| 扫描定时器 | 每 `interval` 扫描一次滑动窗口，产生告警事件 |
| blocker | 消费告警事件，串行下发防火墙命令（命令在后台执行，不阻塞抓包） |
| HTTP 服务 | 每个连接一个 goroutine，读写运行时状态 |
| 信号处理 | `SIGHUP` 触发重载，`SIGINT` / `SIGTERM` 兜底解封并退出 |

重载期间 blocker 对象不换绑，只替换其内部后端，因此检测层的 sink 与 HTTP 持有的指针始终有效，
迁移期间到达的事件排队而非丢弃。

## 抓包方案

- **AF_PACKET + TPACKET_V3** 环形缓冲，**不依赖 libpcap、不需要 CGO**，可交叉编译为静态文件。
- socket 上挂**内核经典 BPF** 过滤器，只放行可能承载所选协议的 IPv4 / IPv6 报文（兼容 VLAN /
  QinQ）。ARP、STP、ICMP、ICMPv6、NDP 等在进入用户态前即被丢弃。
- **`snaplen` 截断**：BPF 返回值决定内核每包复制多少字节（默认 256B），负载不进入用户态；
  流量统计用内核记录的线路长度 `tp_len`，不受截断影响。
- TPACKET_V3 的一个 frame 可容纳多个小包，所以**容量由 `snaplen × 帧数` 决定**，`frame_size`
  只影响块的切分粒度（详见[内存与性能细节](/go/memory-details/)）。

## 模块划分

| 目录 | 职责 | 常见排查切入点 |
| --- | --- | --- |
| `cmd/pcdn-detect/` | 命令行解析、组件装配、启动流程 | 参数优先级、启动失败的第一现场 |
| `internal/config/` | 配置结构、默认值、校验、模板 | `template.go` 里的 `defaultConfigTemplate` 是配置项权威说明 |
| `internal/capture/` | 抓包、报文解析、BPF 生成 | BPF 与 `snaplen` 的测试都在这里 |
| `internal/detector/` | 滑动窗口、对端集合、端口淘汰、告警 | 阈值/续期/淘汰逻辑 |
| `internal/filter/` | MAC + 端口黑白名单 | 名单匹配与端口表达式 |
| `internal/firewall/` | `hook` / `iptables` / `nftables` 后端 | 封禁规则拼装、残留清理 |
| `internal/blocker/` | 告警事件到封禁动作的协调 | 引用计数、全端口封禁、UPnP |
| `internal/httpapi/` | API 路由、鉴权、CORS、分页 | 各端点的筛选与统计口径 |
| `internal/minihttp/` | 极简 HTTP/1.1 服务端 | 传输层限制、与 `net/http` 的差分测试 |
| `internal/state/` | 重启继承用的二进制状态（PCST v1） | 兜底重启、状态文件兼容性 |
| `internal/netutil/` | MAC、协议号、公网地址判定 | 地址归属判断 |
| `internal/util/`、`internal/logx/`、`internal/tz/` | 展示格式化、分级日志、时区解析 | 日志掩码与时间显示 |

## 关键取舍

**不引入 `net/http` 与 TLS**。`internal/minihttp` 自己实现 HTTP/1.1，因此不会带入
`crypto/tls` / `crypto/x509`，可执行文件更小；代价是不支持 HTTPS 与 chunked 请求体，需要加密时
在前置反向代理终结 TLS。行为边界（状态码、keep-alive、流水线、连接关闭语义）有与 `net/http`
的差分测试保证。

**默认只放行 UDP**。PCDN 以 UDP 为主，内核层过滤能大幅降低内核→用户态的处理量与内存带宽；
需要 TCP 时显式改 `[capture] protocol`，此时防火墙封禁协议也会跟着变。

**内存优先于信息完整度**。对端键用紧凑地址、单对端端口内联、告警标记复用对端记录、map 峰值
收缩等多处优化，换来单端口约 174 字节的常驻开销；具体数字与复现命令见
[内存与性能细节](/go/memory-details/)。

**状态只在兜底重启时落盘**。正常运行不写状态文件；只有组件原地重建失败、需要 `exec` 自重启时，
才把告警会话与封禁状态写入 `pcdn-detect.state`（PCST v1，权限 0600）供下次启动继承。

## 构建与版本

```bash
make build      # 本机架构 → bin/pcdn-detect
make all        # mipsle / mips / armv7 / arm64 / amd64
```

- 构建参数固定 `CGO_ENABLED=0`、`-trimpath`、`-ldflags "-s -w -buildid="`。
- 版本通过 `-X main.baseVersion=... -X main.gitHash=...` 注入，`-v` 输出形如
  `0.0.1-beta.2+<git 短哈希>`；未注入时显示 `+unknown`。
- 交叉编译细节与架构对照见[编译与交叉编译](/deploy/build/)。

## 与其他仓库的关系

- 配置、命令行、HTTP API、状态文件格式与 [C 版](/c/overview/) 保持一致，两者可互换。
- LuCI 面板通过 `-T` 校验、`SIGHUP` 重载、HTTP API 读状态与之交互；面板不解析 TOML。
