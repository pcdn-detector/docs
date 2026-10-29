---
title: 内存与性能细节
description: Go 版的内存结构、实测基准数据、map 收缩机制与复现命令。
---

本页是 Go 版内存优化的原始数据与机制说明。调优结论（预设、建议值）见
[内存与性能](/config/memory/)；这里解释「为什么」以及如何自己复现。

## 三部分开销

| 部分 | 默认值 | 说明 |
| --- | --- | --- |
| 内核抓包环形缓冲 | 256KiB（`65536 × 4`） | mmap 驻留页，计入 RSS，**不计入 Go 堆** |
| Go 运行时 | 由 `GOMEMLIMIT` / `GOGC` 约束 | 堆、栈、GC 元数据 |
| 检测数据结构 | 设备 → 端口 → 对端三级 | 由 `peer_limit` / `max_ports` / `low_memory` 约束 |

`memory_limit` 只统计 Go 堆，设值时需预留环形缓冲 + 2~3MiB 的余量。

## 单包成本与容量

`snaplen` 决定内核每包复制的字节数，是收益最大的一项：

| 方案 | 单包占用 | 可缓冲包数 |
| --- | --- | --- |
| 旧默认：2MiB，整帧复制（1500B 帧） | ~1580B | ~1300 |
| 默认：256KiB，`snaplen = 256` | ~336B | ~780 |

单包占用 ≈ `snaplen` + tpacket3 头（约 80B，随内核版本略有差异）。结论：**单位内存能装的包数
约 4.7 倍，但总容量约为旧默认的 0.6 倍**。PCDN 检测统计的是窗口内不同远端 IP 数，短暂突发丢
少量包通常不影响判定；真机高 pps 下怀疑丢包，优先加 `num_blocks`。

## 对端记录：184 → 44 字节

单设备单端口 2 万个 IPv4 对端、处于告警态时的实测演进：

| 阶段 | 每个对端 | 相对最初 |
| --- | --- | --- |
| 最初 | 约 184 字节 | — |
| 去掉对端级冗余字节字段 | 约 79 字节 | −57% |
| 键紧凑化 + 告警标记复用 + 时间戳 `int64` | **约 44 字节** | **−76%** |

关键改动：

- **键紧凑**：IPv4 用 `As4()` 的 4 字节（`peerKey4`）、IPv6 用 16 字节（`peerKey6`），
  而不是 24 字节的 `netip.Addr`——其 8 字节「地址种类」指针在同一 map 内是冗余的。
- **不存字节数**：对端级字节数从未被读取（流量只在端口级累计），去掉后 `peer` 由 32 字节缩到
  16 字节，`map[peerKey4]peer` 的 value 数组随之减半，每个对端省约 35 字节（约 44%）。
- **告警标记复用**：告警期间的「已提示对端」直接复用对端记录的 `reported` 字段，只额外维护一个
  计数，不再维护一份与对端集合同规模的集合，约省 40% 对端内存，也避免长时间续期时该集合只增不减。
- **时间戳用 `int64`（Unix 纳秒）**，每个对端再省 16 字节。

## 端口条目：365.6 → 173.6 字节

单对端端口（绝大多数临时端口只有 1 个对端）原本也要付一份 map 的固定开销（hmap + bucket，约
200 字节）。现在每个端口在自身结构体内**内联保存最多 4 个对端**（定长数组，零额外分配），超过
4 个才升级为 map；升级后不再退回内联，避免对端数围绕 4 抖动时反复升降级。

| 指标 | 内联前 | 内联后 |
| --- | --- | --- |
| 空闲单对端端口 | 365.6 B | **173.6 B**（−53%） |

5000 个各含 1 个对端的空闲端口测得。其中 `portStat` 本身 144 字节，其余是端口表 map 项开销；
纯 IPv6 端口的内联项为 32 字节，单端口 `portStat` 208 字节。

同一时期的结构体瘦身（为内联腾空间）：

| 结构 | 变化 | 收益 |
| --- | --- | --- |
| `portStat` | 96 → 88 → 80 字节 | 从 96 字节分配档降到 80 字节档，每端口省 16 字节堆 |
| `portStat`（引入内联后） | 80 → 144 字节 | 用定长内联数组替代对端 map 指针 |
| `device` | 24 → 16 字节 | 每设备省 8 字节 |
| `device`（按地址族拆表后） | → 32 字节 | 每设备 +16 字节，相对端口数量可忽略 |

另外端口/设备状态不再重复保存键字段（`port` / `proto` / `mac` 由调用方传入），端口表按地址族
拆成 `device.v4` / `device.v6`，让 IPv4 端口的内联项每项仅 16 字节。

## map 峰值收缩

Go 的 map 删除元素后**不会收缩底层 bucket 数组**，长期运行时曾达到峰值的 map 会一直驻留内存——
这是「内存不回落」的主因。每次扫描记录设备 / 端口 / 对端三级 map 的元素数峰值，当当前元素数降到
峰值 **1/4 以下**（且峰值 ≥ 64）时重建该 map，把多余 bucket 归还运行时。

只在「峰值大、当前小」时触发，避免抖动。单端口 2 万个对端缩到 1 个后，一次重建可回收约
**0.85 MiB**。

## 运行时限制

| 项 | 语义 | 建议 |
| --- | --- | --- |
| `memory_limit` | `debug.SetMemoryLimit`，Go 堆软上限；也可用 `GOMEMLIMIT` | 设备可用内存的一半，如 128MB 设备设 `"32MiB"` |
| `gc_percent` | `debug.SetGCPercent`，GOGC 语义；范围 1~1000，`-1` 不支持 | 低内存设备 20~50 |

两者不冲突：堆逼近软上限由软上限收紧，远离上限由 GOGC 决定。`memory_limit` 不含环形缓冲，
设置时要预留。

## 复现命令

```bash
# 每个对端的常驻字节数
go test ./internal/detector/ -run '^$' -bench RetainedBytesPerPeer -benchtime 3x

# map 收缩回收量
go test ./internal/detector/ -run '^$' -bench MapShrinkReclaim -benchtime 3x

# 空闲单对端端口开销
go test ./internal/detector/ -run '^$' -bench RetainedBytesPerIdlePort -benchtime 3x
```

抓包侧：

```bash
# 无需权限：校验 BPF 返回值等于 snaplen、截断后仍能解析端口、L4 头超出 snaplen 时安全跳过
go test ./internal/capture/ -run 'TestBPFSnaplen|TestHandle' -v

# 需要 root + CAP_NET_RAW + lo：校验 CaptureLength == snaplen 且 Length 仍为线路长度
go test ./internal/capture/ -run TestSnaplenLive -v
```

## 已知可观测性缺口

**环形缓冲丢包计数尚未通过接口暴露**。`ip -s link` 反映的是网卡层丢包，不等于 AF_PACKET 环形
缓冲溢出；如需判断，临时把 `num_blocks` 加倍，观察检测结果 / CPU 是否变化。端口淘汰则有明确
指标：`/api/v1/devices` 的 `port_evictions` / `port_drops`。
