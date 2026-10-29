---
title: 架构与仓库关系
description: 三个仓库的分工、运行时数据流与跨实现兼容层。
---

## 组件关系

```text
                ┌──────────────────────────────────────────────┐
                │  LuCI 面板  luci-app-pcdn-detector           │
                │  概览 / 配置编辑 / 日志 / 下载更新            │
                └───────┬───────────────┬──────────────┬───────┘
                        │ TOML 全文收发  │ SIGHUP       │ logread
                        │ + pcdn-detect  │ 热重载       │ (syslog tag)
                        │   -T 校验      │              │
                        ▼                ▼              ▼
        ┌──────────────────────────────────────────────────────────┐
        │  检测内核  pcdn-detect（Go 版 或 C 版，二选一）            │
        │                                                          │
        │  capture ──► detector ──► blocker ──► firewall           │
        │  (AF_PACKET)  (滑动窗口)   (封禁协调)   (hook/ipt/nft)    │
        │      ▲            │             │                        │
        │      │            │             └──► full_ban / upnp     │
        │   br-lan          └──► log ──► stdout ──► procd/logread  │
        │                        └──► httpapi ──► LuCI 代理/浏览器  │
        └──────────────────────────────────────────────────────────┘
                        │
                        ▼
                 LAN 侧设备流量
```

面板与内核之间只有四类交互，没有私有协议：

| 交互 | 方向 | 说明 |
| --- | --- | --- |
| `pcdn-detect -T -c <配置>` | 面板 → 内核 | 保存前校验配置，失败不落盘 |
| `kill -HUP <pid>` | 面板 → 内核 | 原地热重载，不重启、不丢封禁状态 |
| `GET /api/v1/*` | 面板 → 内核 | 状态、设备统计、端口明细、对端列表 |
| `logread`（syslog tag） | 面板 ← 内核 | 日志由 procd 收集，按 tag 精确筛选 |

## 运行时数据流

1. **抓包**：`capture` 层在指定网卡上开 `AF_PACKET` socket，附带内核 BPF 过滤器（默认只放行 UDP），
   按 `snaplen` 截断后复制进环形缓冲。
2. **解析**：用户态解析以太网 / IP / 传输层头部，判定「本端设备」与「远端对端」。
   本端归属依据**网卡自身所在网段**（IPv4 子网 + IPv6 前缀），而非公网 / 私网区分。
3. **统计**：`detector` 按 `MAC + 端口 + 协议 + 地址族` 维护滑动窗口，定时扫描并产生告警事件。
4. **协调**：`blocker` 把告警事件转换为封禁 / 解封动作，维护引用计数（`ban_both` 时合并 v4/v6）、
   全 UDP 端口封禁与 UPnP 策略。
5. **下发**：`firewall` 后端用 `hook` 自定义命令、`iptables` / `ip6tables` 专用链或 `nftables`
   bridge 集合落地规则。
6. **可观测**：日志走 stdout（procd 收集），运行时状态走 HTTP API。

## 面板的分工边界

LuCI 面板**不解析业务配置**，也不参与检测：

- 「配置编辑」是完整的 TOML 文本编辑器，保存时把全文发回后端，只做「校验 + 落盘 + 热重载」；
- 大配置按 1000 字符分片上传（避免部分固件约 8 KiB 的请求体上限截断 `[[filter.blacklist]]`），
  全部发完后统一提交；
- 仓库里**不内嵌 TOML**：配置不存在时，由 `pcdn-detect --init-config` 生成，再把 `interface`
  填成 `br-lan`。

因此：**只装面板无法工作**，必须另有对应架构的 `pcdn-detect` 二进制。

## 跨实现兼容层

Go 版与 C 版刻意保持了以下约定，配置与运维流程完全一致：

| 兼容项 | 说明 |
| --- | --- |
| 配置文件 | 同为 TOML，分块与字段语义一致；双方模板可互相加载 / 校验通过 |
| 命令行参数 | 短 / 长形式、默认值一致，两版均提供 `-h` / `--help` |
| HTTP API | 端点、鉴权、CORS、分页参数一致 |
| 状态文件 | `pcdn-detect.state` 同为 **PCST v1** 二进制布局（magic / version / CRC32 / 小端记录），已做双向兼容验证 |
| 发布产物名 | `pcdn-detect-mipsle` / `-mips` / `-armv7` / `-arm64` / `-amd64` |
| 日志格式 | 文本与等级一致，面板可直接切换版本而不改页面 |

已知实现差异见[选择后端实现](/deploy/choose/)。

## 内部模块对照

| 职责 | Go 版 | C 版 |
| --- | --- | --- |
| 入口 / CLI / reload 编排 | `cmd/pcdn-detect/` | `src/app.c`、`src/main.c` |
| 配置与模板 | `internal/config/` | `src/config.c` |
| 抓包与 BPF | `internal/capture/`（TPACKET_V3） | `src/capture.c`（TPACKET_V2） |
| 滑动窗口与告警 | `internal/detector/` | `src/detector.c` |
| 黑白名单 | `internal/filter/` | `src/filter.c` |
| 防火墙后端 | `internal/firewall/` | `src/firewall.c` |
| 封禁协调 | `internal/blocker/` | `src/blocker.c` |
| HTTP API | `internal/httpapi/` + `internal/minihttp` | `src/httpapi.c` + `src/http.c` |
| 状态继承 | `internal/state/` | `src/state.c` |
| 日志 / 格式化 | `internal/logx/`、`internal/util/`、`internal/tz/` | `src/util.c` |

各模块的职责、实现取舍与实测数据见实现专区：[Go 版实现概览](/go/overview/)、
[C 版实现概览](/c/overview/)。
