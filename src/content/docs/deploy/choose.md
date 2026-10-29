---
title: 选择后端实现
description: Go 版与 C 版的实现差异与适用场景。
---

两个检测内核功能等价、可以互换。配置、命令行、HTTP API、状态文件乃至发布产物命名都一致，
差别只在运行时与抓包实现。

## 对比

| 维度 | Go 版 `pcdn-detector` | C 版 `pcdn-detector-c` |
| --- | --- | --- |
| 语言 / 工具链 | Go 1.27.3+，`CGO_ENABLED=0` | C23，GCC 14+ / Clang 18+ |
| 运行时 | Go runtime + GC | pthread，**无 GC** |
| 抓包 | AF_PACKET + **TPACKET_V3** 环形缓冲 | AF_PACKET + **TPACKET_V2** 环形缓冲 |
| 内核过滤 | 经典 BPF，解析前丢弃无关报文 | 同左 |
| 外部依赖 | 无（不需 libpcap） | 无（tomlc99 / cJSON / uthash / picohttpparser 以 submodule 静态编入） |
| 内存控制 | `memory_limit` / `gc_percent` / `low_memory` / `peer_limit` / `max_ports` 全部生效 | `memory_limit` / `gc_percent` 仅解析与校验，**无运行时效果**；其余三项语义完整 |
| 抓包容量语义 | 一个 frame 可容纳多个小包，容量由 `snaplen × 帧数` 决定 | 每帧只放一个报文，**帧槽数 = 突发容量** |
| HTTP 传输层 | 内置 `minihttp`（自实现 HTTP/1.1） | 自实现 HTTP/1.1 + picohttpparser |
| 重载 | `Migrate` 原地迁移 | 「快照 → 关旧 → 清旧 → 建新 → 恢复」，效果等价 |

## 选型建议

- **默认选 Go 版**。内存控制项 `memory_limit` / `gc_percent` 真实生效，调优手段更完整。
- **这些情况考虑 C 版**：
  - 设备内存极小，希望避开 GC 抖动与 Go 运行时开销；
  - 需要一个静态链接、无运行时依赖的极小 ELF；
  - 你已经在用 C 版并希望保持一致的运维方式。

两者的防火墙后端（`hook` / `iptables` / `nftables`）、全 UDP 端口封禁与 UPnP 拦截行为一致，
可以按同一套流程部署。

## 互操作

两个内核可随时替换，运维侧只需注意：

- **配置文件通用**：C 生成的模板可被 Go 加载，反之亦然。
- **状态文件通用**：`pcdn-detect.state` 为同一 PCST v1 布局，已双向验证；但状态文件仅在
  **兜底重启**时写入，正常停止不写。
- **切换会短暂断流**：防火墙后端迁移期间存在极短的无规则窗口，封禁状态随后按新后端恢复。
- **不要在 C 版期待 GC 相关行为**：`memory_limit` / `gc_percent` 会被接受但不生效，启动日志
  会给出提示；真正决定内存上限的是抓包缓冲与 `low_memory` / `peer_limit` / `max_ports`。

LuCI 面板的「下载/更新」页可直接选择 `Go` 或 `C`，两者使用相同的 Release 资源名，无需手工改
文件名。

## 延伸阅读

- **Go 版**：[实现概览](/go/overview/) · [内存与性能细节](/go/memory-details/) ·
  [测试与自检](/go/testing/)
- **C 版**：[实现概览](/c/overview/) · [构建体系详解](/c/build-details/) ·
  [运行时与传输层](/c/runtime/) · [测试与自检](/c/testing/)
