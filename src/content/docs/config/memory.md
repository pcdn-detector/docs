---
title: 内存与性能
description: 抓包缓冲、snaplen、低内存模式、对端与端口上限，以及两个实现在内存上的差异。
---

## 内存花在哪

| 部分 | 由谁决定 | 是否计入 Go 堆 |
| --- | --- | --- |
| 内核抓包环形缓冲 | `block_size × num_blocks` | 否（mmap 驻留页，计入 RSS） |
| 运行时开销 | Go runtime / GC，或 C 的线程栈 | 部分 |
| 用户态检测数据结构 | 设备数、端口数、对端数，受 `peer_limit` / `max_ports` / `low_memory` 约束 | 是 |

## 抓包缓冲与 snaplen

默认方案（两个实现一致）：

| 配置项 | 默认值 | 约束 |
| --- | --- | --- |
| `snaplen` | `256` | 内核每包复制的最大字节数 |
| `frame_size` | `2048` | 须能整除 `block_size` |
| `block_size` | `65536` | 须为页大小(4096)与 `frame_size` 的整数倍 |
| `num_blocks` | `4` | ≥ 1 |
| 合计 | **256KiB** | `block_size × num_blocks` |

`snaplen` 是最有效的优化：解析只需要以太网头 + IP 头 + 扩展头 + 4 字节端口，256B 足以覆盖
「2 层 VLAN + IPv6 + 分片 + 若干扩展头」的常见组合（约 90B）。内核只把前 256B 复制进环形缓冲，
负载不再进入用户态。

流量统计不受截断影响：字节数取自内核记录的**线路长度**（`tp_len`），与复制长度相互独立。
代价是极长的 IPv6 扩展头链可能让传输层头落在 `snaplen` 之外，该包被跳过。

### 预设组合

通常只需挑一组替换 `[capture]` 中对应的 4 行，`interface` / `promisc` / `protocol` 保持不变：

| 预设 | 适用场景 | `frame_size` | `block_size` | `num_blocks` | `snaplen` | 环形缓冲 |
| --- | --- | --- | --- | --- | --- | --- |
| 最小 | 32 / 64MB 内存、百兆以内 | 2048 | 65536 | 2 | 256 | 128KiB |
| **普通（默认）** | 大多数家用路由器 | 2048 | 65536 | 4 | 256 | 256KiB |
| 高流量 | 千兆、小包多、担心丢包 | 2048 | 65536 | 8 | 256 | 512KiB |
| 超高流量 | 千兆满载 / 多 WAN 汇聚 | 2048 | 65536 | 16 | 256 | 1MiB |
| 旧版默认 | 需要整帧复制 | 65536 | 262144 | 8 | 65536 | 2MiB |

### 单项调整

| 目标 / 现象 | 调整 |
| --- | --- |
| 高 pps 怀疑丢包 | `num_blocks` `4 → 8 → 16` |
| 超长 IPv6 扩展头链导致漏检 | `snaplen` `256 → 512 / 1024` |
| 需要完整载荷（临时排查） | `frame_size` 与 `snaplen` 同时调大，如 `4096 / 4096` |
| 内存极度紧张 | `num_blocks = 2`，并配合 `low_memory` |
| 只想降 CPU，不在意缓冲 | 保持默认，不要动 `frame_size` |

取值规则：`snaplen <= 0` 用默认 256；`< 64` 抬到 64；`> frame_size` 压到 `frame_size`；
缓冲参数非法时整体回退内置默认值。想恢复「整帧复制」必须**同时**令 `snaplen = frame_size`。

## 内存控制项 `[memory]`

```toml
[memory]
# memory_limit = "32MiB"   # Go 堆软上限（Go 版生效）
# gc_percent = 30          # GOGC 语义（Go 版生效）
low_memory = false
# peer_limit = 1000
# max_ports = 512
```

| 项 | 默认 | 说明 |
| --- | --- | --- |
| `memory_limit` | 未设置 | Go 堆软上限，达到后 GC 更积极；也可用环境变量 `GOMEMLIMIT` |
| `gc_percent` | 未设置 | GOGC 语义，堆内新增达到「存活堆 × n%」触发 GC；推荐 20~50，范围 1~1000 |
| `low_memory` | `false` | 告警后清空并停止记录该端口对端，只留触发状态 |
| `peer_limit` | `max(1000, threshold×10)`；低内存模式下为 `threshold` | 单端口对端记录上限，`0` 不限制，小于阈值时自动抬到阈值 |
| `max_ports` | `512` | 单设备端口条目上限，`0` 不限制 |

### 低内存模式（`low_memory`）

某「设备 + 端口」一旦触发告警，立即清空已记录的对端 IP 列表（map 置 nil，bucket 归还运行时），
并**不再记录该端口的新对端**，只继续统计告警续期、累计流量与累计对端数。

- 代价：告警期间不再输出「持续产生PCDN行为（新增相关IP）」，也不展示新增对端；
  首次告警日志仍输出触发时刻窗口内的完整列表。
- 收益：长期告警（滑动续期）时该端口内存不再增长。
- 命令行等价项：`-L` / `--low-memory`。

### 单端口对端上限（`peer_limit`）

防止单个异常端口记录无限多对端。达到上限后不再记录新对端 IP，已有对端照常刷新，端口级流量
仍完整累计。阈值调高时上限会同步抬升，否则端口永远凑不到阈值、告警会静默失效。

### 单设备端口上限（`max_ports`）

目的端口扫描、QUIC / TCP 短连接会为每个新端口建立条目（IPv4 约 174 字节，IPv6 约 230 字节），
65536 个端口可达 10 MiB 量级。达到上限时按「最接近过期 + 同档内对端最少」**批量提前过期 10%**
的端口，避免每个新端口都全表排序（否则扫描流量会变成 CPU 放大器）。

- 告警中的端口**不参与淘汰**；若全部端口都在告警中，新端口不建立、该端口流量不再累计，
  首次丢弃会打日志。
- 上限被热更新调小时，下一次扫描会收敛到新值。
- 可观测：`/api/v1/devices` 顶层的 `port_evictions`（提前过期端口数）与 `port_drops`
  （丢弃的新端口报文数），均为累计计数，0 表示上限尚未生效。

## 两个实现的差异

| 项 | Go 版 | C 版 |
| --- | --- | --- |
| GC / 运行时 | 有 GC；`memory_limit` / `gc_percent` 生效 | 无 GC；两项仅解析校验，**不产生效果**，启动时提示 |
| 抓包缓冲 | TPACKET_V3，一个 frame 可容纳多个小包 | TPACKET_V2，**每帧只放一个报文** |
| 突发容量 | 由 `snaplen × 帧数` 决定 | **帧槽数 = `(block_size / frame_size) × num_blocks`**，默认 128 |
| 内存调节重点 | `memory_limit` + `peer_limit` + `max_ports` + `low_memory` | `num_blocks` + `peer_limit` + `max_ports` + `low_memory` |

C 版用户尤其注意：因为 TPACKET_V2 每帧只放一个报文，**提高突发容量要增大 `num_blocks`**，
只调 `frame_size` 不会增加可缓冲报文数（且过小会被内核拒绝）。

## 建议起点

| 设备内存 | 建议 |
| --- | --- |
| ≤ 64MB | 最小缓冲预设 + `low_memory = true` + `max_ports = 256`，必要时 `memory_limit = "16MiB"` |
| 128MB | 默认缓冲 + `memory_limit = "32MiB"` + `gc_percent = 30`（Go 版） |
| ≥ 256MB | 默认即可，高流量下把 `num_blocks` 提到 8 |

`memory_limit` 只统计 Go 堆，不含抓包环形缓冲，设置时需预留环形缓冲 + 2~3MiB 的余量。

运行时可从 `/dev/memory`（Go 版返回 `runtime.MemStats`、`GOMEMLIMIT`、goroutine 数等）观察真实
占用，见 [HTTP API](/features/http-api/)。
