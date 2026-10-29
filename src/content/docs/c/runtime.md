---
title: C 版运行时与传输层
description: TPACKET_V2 环形缓冲、uthash 数据结构、HTTP 传输层细节、reload 流程与状态继承。
---

## 抓包：TPACKET_V2

环形缓冲总内存与 Go 版一致（`block_size × num_blocks`，默认 256KiB），但**帧槽语义不同**：

```text
帧槽数 = (block_size / frame_size) × num_blocks = (65536 / 2048) × 4 = 128
```

TPACKET_V2 下**每个帧最多承载一个报文**，所以帧槽数就是可缓冲的报文数。这意味着：

- 想提高突发容量，**增大 `num_blocks`**（不要指望调 `frame_size`）；
- `frame_size` 要保持足够大（需容纳内核头部 + `snaplen`），过小会被内核拒绝；
- 参数非法（不能整除、非页大小整数倍等）时**整体回退内置默认值**，启动日志输出实际生效值。

```text
抓包缓冲：frame=2048B，block=65536B × 4 块 = 256KiB，snaplen=256B（可在 [capture] 中调整）
```

内核过滤、`snaplen` 截断、`tp_len` 统计线路长度、非首片分片处理等与 Go 版语义相同，详见
[检测与抓包](/config/detect/) 与 [内存与性能](/config/memory/)。

## 用户态数据结构

用 **uthash** 按「设备 → 地址族 → 端口 → 对端」四级组织：

| 设计 | 收益 |
| --- | --- |
| 对端键用原始地址（IPv4 4 字节 / IPv6 16 字节），不存 IP 字符串 | 每个对端省下字符串与指针开销 |
| 地址族拆表（`device.v4` / `device.v6`） | IPv4 端口条目只需 4 字节键，两族遍历互不影响 |
| 字节数只在端口级累计（`up_bytes` / `down_bytes`） | 对端记录只留键 + 时间戳 + `reported` + 哈希句柄 |
| 告警期「已提示」标记复用对端记录的 `reported` | 不再维护与对端集合同规模的集合 |
| 端口内对端全部过期且不在告警中时删除整个端口状态 | 设备无端口时同样删除，避免空壳累积 |
| 哈希表峰值收缩（当前 < 峰值 1/4 且峰值 ≥ 64 时重建） | uthash 删除元素不会自动缩桶，重建把多余桶还给分配器 |
| 抓包层直接由报文字节构造地址 | 每个报文不分配 IP 字符串；IP 只在告警与 API 返回时格式化 |

告警日志最多列出 20 个 IP，其余以省略号提示。

## HTTP 传输层

`src/http.c` 自实现 HTTP/1.1：**每个连接一个线程**，请求行与请求头用 picohttpparser 解析，
支持 keep-alive、`Content-Length`、`Date` 头；不实现 TLS，因此不依赖 OpenSSL 等库。

| 项目 | 限制 | 超限响应 |
| --- | --- | --- |
| 请求行 | 4 KiB | 414 |
| 请求头单行 | 4 KiB | 431 |
| 请求头总量 | 16 KiB | 431 |
| 请求体 | 1 MiB，仅 `Content-Length` | 413；chunked 等返回 501 |
| 读请求头 | 5s | 断开连接 |
| 空闲 keep-alive | 30s | 断开连接 |
| 响应写 | 10s | 断开连接 |

- 不支持 HTTPS / HTTP-2 / chunked 请求体；协议级错误（413/414/431/501）返回 `{"error":"..."}`，
  由传输层直接生成，**不带 `Date` 头**；正常响应带标准 `Date`（IMF-fixdate），不写 `Server`。
- 错误码集合：400（参数错误 / 重载失败）、401、404、405（带 `Allow`）、413、414、431、501、
  503（依赖未启用）。
- 线程数 ≈ 并发连接数，可用 `/dev/memory` 的 `threads` 观察峰值。

端点与参数与 Go 版完全相同，见 [HTTP API](/features/http-api/)。`/api/v1/status` 的字段：

```json
{
  "status": "ok",
  "uptime_seconds": 128,
  "tracked_devices": 1,
  "alerts": 2,
  "active_bans": 3,
  "full_banned": 0,
  "upnp_blocked": 0,
  "upnp_allowed": 0,
  "upnp_all": false
}
```

### `/dev/memory`

C 版返回运行时诊断而非 Go 堆统计：

| 字段 | 含义 |
| --- | --- |
| `version` | `<version>+<git hash>` |
| `uptime_seconds` | 运行时长 |
| `num_cpu` | CPU 数 |
| `threads` | `/proc/self/status` 的 `Threads`（含抓包 / 扫描 / blocker 等常驻线程） |
| `rss_bytes` / `vm_bytes` | 常驻内存 / 虚拟内存 |
| `tracked_devices` / `alerts` | 跟踪设备数 / 累计告警数 |

## reload 流程

与 Go 版的 `Migrate` 效果等价，但实现是显式的四步：

```text
导出 blocker 快照 → 关闭旧 blocker（逐条解封）→ 清理旧后端 → 构建新后端 → 按快照恢复
```

旧 blocker / firewall 对象保留到进程退出，避免并发 HTTP 请求持有悬空指针。

| 变更 | 生效方式 |
| --- | --- |
| `[detect]` 阈值 / 时长 / 持续期 / 扫描间隔 | 原地更新 |
| `[memory] low_memory` / `peer_limit` / `max_ports` | 原地更新 |
| `[log]` 等级 / 时区 / 隐私模式 | 即时生效 |
| `[filter]` 名单 | 同步并清理已排除端口的双栈告警与封禁 |
| `[capture]` 协议 / snaplen / 混杂模式 | 既有 socket 上重设 BPF / 切换混杂模式 |
| `[capture]` 网卡 / 环形缓冲 | **原地重开 socket**（TPACKET_V2 不支持在既有 socket 上改动，期间可能极短丢包） |
| `[firewall]` / `[full_ban]` / `[upnp]` | 上述快照迁移 |
| `[http]` token / `device_ip_limit` | 原地更新，`device_ip_limit` 自下一次 `/peers` 生效 |
| `[http]` enabled / listen | 原地重启监听 |

:::caution[HTTP 监听变更的特殊情况]
若监听地址变更发生在 **HTTP 请求线程内**（例如通过 `POST /api/v1/reload` 触发），C 版会回退为
「保存状态 + 自重启」，避免线程停止并等待自身造成死锁。此时响应表示需要重启，封禁状态由 PCST
文件继承。
:::

重载前同样会完整校验配置，失败则拒绝并保留旧配置（HTTP 400 / `SIGHUP` 只记日志）。

## 状态继承

`pcdn-detect.state` 使用 **PCST v1** 二进制布局：magic / version / CRC32 / 小端记录，权限 `0600`，
默认在系统临时目录（可用 `[http] state_dir` 改），与 Go 版**双向互通**（C 写 Go 读、Go 写 C 读
均已验证）。

- **只在兜底重启时写入**；正常停止（SIGINT / SIGTERM）不写、不继承，仍按现有语义解封并清理；
- 文件损坏（魔数 / 版本 / CRC 校验失败）记录警告并按无继承启动；
- `ban_active_alerts = true` 时，启动继承会补发当前已告警端口的封禁（幂等）。
