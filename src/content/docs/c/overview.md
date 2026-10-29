---
title: C 版实现概览
description: pcdn-detector-c 的线程模型、模块划分、无 GC 设计以及与 Go 版的兼容约定。
---

`pcdn-detector-c` 是 C 语言移植版：行为、配置格式、命令行参数、HTTP API 与状态
继承格式均与 Go 版保持一致，运行时改为 **pthread + AF_PACKET**，便于在 OpenWrt 上静态链接部署。

选型建议见[选择后端实现](/deploy/choose/)，配置与功能见[配置总览](/config/overview/)。

## 运行模型

单进程多线程，无常驻 GC：

| 线程 | 职责 |
| --- | --- |
| 抓包线程 | 从 `AF_PACKET` + TPACKET_V2 环形缓冲取帧并解析 |
| 扫描线程 | 按 `interval` 扫描滑动窗口，产生告警事件 |
| blocker | 消费事件并执行防火墙命令（命令经 `sh -c`，受 `timeout` 约束） |
| HTTP 服务 | **每个连接一个线程**，最坏线程数 ≈ 并发连接数 |

`/dev/memory` 的 `threads` 字段读取 `/proc/self/status` 的 `Threads`，包含抓包 / 扫描 / blocker
等常驻线程，可用来观察连接数峰值。

## 无 GC 的含义

| 项 | 行为 |
| --- | --- |
| `[memory] memory_limit` / `gc_percent` | 会被解析与校验，但**不产生运行时效果**，启动日志给出提示 |
| `low_memory` / `peer_limit` / `max_ports` | 语义完整保留 |
| 真正的内存上限 | 抓包缓冲（`num_blocks` 等）+ 上述三项控制项 |

因此 C 版的调优重点是**抓包缓冲与结构上限**，而不是 GC 参数。

## 模块划分

| 文件 | 职责 |
| --- | --- |
| `src/app.c` | CLI 解析、启动装配、reload 编排、信号与退出 |
| `src/config.c` | 配置结构、默认值、TOML 映射、校验、模板 |
| `src/capture.c` | AF_PACKET TPACKET_V2 环形缓冲、经典 BPF、报文解析 |
| `src/detector.c` | 滑动窗口、对端集合、端口淘汰、告警 |
| `src/filter.c` | MAC + 端口黑白名单 |
| `src/firewall.c` | `hook` / `iptables` / `nftables` 后端 |
| `src/blocker.c` | 告警事件队列、封禁协调、全端口封禁、UPnP |
| `src/httpapi.c` | API 路由、鉴权、CORS、JSON |
| `src/http.c` | 极简 HTTP/1.1 传输层（picohttpparser + pthread） |
| `src/state.c` | PCST v1 二进制状态文件（与 Go 版格式一致） |
| `src/util.c` | 日志、时长/字节格式化、MAC/IP、时区、掩码 |
| `src/main.c` | 入口 |

测试位于 `tests/`：`test_core.c`（配置 / 过滤 / 检测 / 状态文件）、`test_http.c`（HTTP API
鉴权 / CORS / 路由 / reload / 内存接口），以及 `test_blocker.c` / `test_firewall*.c`（封禁协调与
防火墙后端）。

## 兼容约定

| 兼容项 | 说明 |
| --- | --- |
| 配置 | 同一份 TOML，C 生成的模板可被 Go 加载，反之亦然 |
| 命令行 | 短 / 长形式与默认值一致，两版均提供 `-h` / `--help` |
| HTTP API | 端点、鉴权、CORS、分页参数一致；细节差异见[运行时与传输层](/c/runtime/) |
| 状态文件 | `pcdn-detect.state` 为 PCST v1（magic / version / CRC32 / 小端记录），与 Go 版**双向互通** |
| 日志 | 文本与等级一致，面板可无差别读取 |
| 发布产物 | `pcdn-detect-mipsle` / `-mips` / `-armv7` / `-arm64` / `-amd64` |

重载流程与 Go 版等价但实现不同：导出 blocker 快照 → 关闭旧 blocker（逐条解封）→ 清理旧后端 →
构建新后端 → 恢复快照。旧 blocker / firewall 对象保留到进程退出，避免并发 HTTP 请求持有悬空
指针。

## 版本与构建

版本通过 `-DPCDN_BASE_VERSION` / `-DPCDN_GIT_HASH` 注入，默认取当前 git 短哈希：

```bash
make GIT_HASH=dev
./bin/pcdn-detect --version     # 0.0.1-beta.2+dev
```

构建、交叉编译与静态链接的完整说明见[构建体系详解](/c/build-details/)。

## 依赖与许可

运行时无第三方依赖：`pthread` + Linux `AF_PACKET`（内核 API），不依赖 libpcap。构建期依赖
（tomlc99 / cJSON / uthash / picohttpparser）以 submodule 静态编入，许可证分别为 MIT / MIT /
BSD-1-Clause / MIT；主项目为 **GPL-3.0**。
