---
title: HTTP API
description: 运行时状态读取、设备与端口明细、手动解封、配置热重载与 CORS。
---

## 启用

默认**关闭**，且默认只监听回环地址。

```toml
[http]
enabled = false
listen = "127.0.0.1:8080"
token = ""                 # 非空时要求 Authorization: Bearer <token>
device_ip_limit = 200      # /api/v1/peers 单页最多返回的对端 IP 数
# cors_allowed_origins = []
# cors_allow_credentials = false
# cors_max_age = 600
# state_dir = ""           # 重启继承用状态文件目录，留空为系统临时目录
```

:::danger[安全默认]
`listen` 绑定到**非回环地址**却未配置 `token` 时，启动会被**拒绝**。不要把这个接口直接暴露到公网。
:::

- 内置极简 HTTP/1.1 服务端，**无第三方依赖，仅明文 HTTP**。需要加密请在前置反向代理
  （nginx / stunnel）终结 TLS。
- `token` 非空时，所有请求须带 `Authorization: Bearer <token>`。
- 特殊值 `token = "allow-no-token"` 表示**显式关闭鉴权**（无 token 也可访问，并允许绑定非回环
  地址），启动日志会给出警告。仅在完全可信的场景使用。

### 传输层限制

| 项目 | 限制 | 超限响应 |
| --- | --- | --- |
| 请求行 | 4 KiB | 414 |
| 请求头单行 | 4 KiB | 431 |
| 请求头总量 | 16 KiB | 431 |
| 请求体 | 1 MiB，仅 `Content-Length` | 413；chunked 等返回 501 |
| 读请求头 | 5s | 断开连接 |
| 空闲 keep-alive | 30s | 断开连接 |
| 响应写 | 10s | 断开连接 |

不支持 HTTPS / HTTP-2 / `Transfer-Encoding: chunked` 请求体。正常响应带标准 `Date` 头，不写
`Server` 头；C 版由传输层直接生成的协议级错误（413 / 414 / 431 / 501）不带 `Date`。
错误响应统一为 `{"error":"..."}`。

## 端点

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/v1/health` | 存活探测：`{"status":"ok","uptime_seconds":N}` |
| GET | `/api/v1/status` | 跟踪设备数、累计告警数、当前封禁条目数、全端口封禁设备数、UPnP 状态 |
| GET | `/api/v1/devices` | 设备级汇总：每设备 IPv4 / IPv6 端口条目数与封禁数（不含明细） |
| GET | `/api/v1/device` | 单设备端口明细，可按地址族与封禁状态筛选，分页 |
| GET | `/api/v1/peers` | 按需读取单个端口的对端 IP 列表，分页 |
| GET | `/api/v1/blocks` | 当前端口级封禁列表 + 全 UDP 封禁设备 + UPnP 拦截/放行状态 |
| GET | `/dev/memory` | 运行时内存 / 诊断（注意挂在字面量 `/dev/` 前缀下） |
| POST | `/api/v1/unban` | 手动解封 |
| POST | `/api/v1/reload` | 重载配置 |

```bash
curl -s localhost:8080/api/v1/health
curl -s localhost:8080/api/v1/status
curl -s localhost:8080/api/v1/devices
curl -s 'localhost:8080/api/v1/device?mac=aa:bb:cc:dd:ee:ff&family=v4&state=banned'
curl -s 'localhost:8080/api/v1/peers?mac=aa:bb:cc:dd:ee:ff&port=40000&proto=udp'
curl -s localhost:8080/api/v1/blocks
curl -s localhost:8080/dev/memory

curl -s -XPOST localhost:8080/api/v1/unban \
  -d '{"mac":"aa:bb:cc:dd:ee:ff","port":40000,"proto":"udp"}'

# 配置 token 后
curl -s -H 'Authorization: Bearer <token>' localhost:8080/api/v1/status
```

## 设备统计与明细

`/api/v1/devices` 只返回汇总，**不下发明细**，避免大网络下响应过大：

```json
{
  "tracked_devices": 1,
  "alerts": 2,
  "port_evictions": 0,
  "port_drops": 0,
  "devices": [
    {
      "mac": "aa:bb:cc:dd:ee:ff",
      "ipv4": {
        "ports": 12, "banned": 3,
        "udp": {"ports": 10, "banned": 3},
        "tcp": {"ports": 2, "banned": 0}
      },
      "ipv6": {"ports": 2, "banned": 0, "udp": {"ports": 2, "banned": 0}, "tcp": {"ports": 0, "banned": 0}}
    }
  ]
}
```

顶层两个累计计数对应 `[memory] max_ports` 的生效情况：

| 字段 | 含义 |
| --- | --- |
| `port_evictions` | 因达到 `max_ports` 被提前过期的端口数 |
| `port_drops` | 因上限且无端口可淘汰而丢弃的新端口报文数 |

两者为 0 表示上限尚未生效。

查看某设备端口明细用 `/api/v1/device`（`mac` 必填）：

| 参数 | 必填 | 说明 |
| --- | --- | --- |
| `mac` | 是 | 设备 MAC |
| `family` | 否 | `all`（默认）/ `v4` / `v6`；兼容 `ipv4` / `ipv6` |
| `state` | 否 | `all`（默认）/ `banned` / `unbanned` |
| `limit` | 否 | 每页端口条目上限，默认 200，最多 1000 |
| `page` | 否 | 页码，从 1 开始 |

返回中的 `ipv4` / `ipv6` 统计始终是**全量口径**，不受筛选与分页影响；`matched` 为符合筛选条件的
总数，`truncated` 表示后面还有数据。`banned` 按当前生效规则判定：全 UDP 封禁生效时，该设备除
`allow` 放行端口外所有 UDP 端口都视为封禁（`full_banned = true`）。

对端 IP 用 `/api/v1/peers`：

```json
{"port":40000,"proto":"udp","v6":false,"page":1,"limit":200,"peer_count":5,"peer_ips":["1.1.1.1","1.1.1.2"],"truncated":false}
```

参数：`mac`（必填）、`port`（必填）、`proto`（`udp` 默认 / `tcp`）、`v6`（`false` 默认）、
`limit`（默认取 `device_ip_limit`，不得超过它）、`page`。`peer_count` 是真实对端数，不受分页影响；
IP 按地址数值序排序，只构造当前页。

未跟踪的设备 / 端口返回 404，参数非法返回 400。

## `/dev/memory`

Go 版返回 `runtime.MemStats` 关键字段，以及当前 `GOMEMLIMIT`（即 `memory_limit`）、`gc_percent`、
goroutine 数、`GOMAXPROCS`、`NumCPU`、Go 版本与运行时长。读取接口本身不会 stop-the-world，
也不会改变这两项设置。

C 版无 GC，该接口返回其自身可提供的运行时信息（线程数等），不包含 Go 内存统计。

## 重载配置

两个入口，共用同一个逻辑与同一把锁：

```bash
kill -HUP <pid>                              # 始终可用（HTTP 关闭时唯一入口）
curl -XPOST localhost:8080/api/v1/reload     # 启用 [http] 后
# OpenWrt：/etc/init.d/pcdn-detect reload    # 需在 init 脚本中实现 reload_service
```

重载会重新读取配置文件（并重新套用启动时的命令行覆盖），**原地应用**，不重启进程。
在改动任何运行状态之前先做完整校验（与 `-T` 相同），**失败则拒绝本次重载**（HTTP 返回 400；
`SIGHUP` 仅记录日志），当前配置与状态保持不变。重载期间重复到达的 `SIGHUP` 会合并为一次。

成功时返回：

```json
{"applied":["capture","firewall","detect"],"restart_required":null,"restarting":false}
```

### 原地生效范围

| 变更 | 生效方式 |
| --- | --- |
| `[memory] memory_limit` / `gc_percent` | 运行时接口直接调整（仅 Go 版生效） |
| `[detect]` 阈值 / 时长 / 持续期 / 扫描间隔 | 检测器原地更新，扫描间隔自下一 tick 起生效 |
| `[memory] low_memory` / `peer_limit` / `max_ports` | 原地更新 |
| `[log] level` | 即时生效 |
| `[log] timezone` / `hide_address` | 时区即时切换；隐私模式影响后续日志 |
| `[filter]` 名单 | 同步名单并清理已排除端口的双栈告警与封禁 |
| `[capture]` 协议 / snaplen / 混杂模式 | 在既有 socket 上重设 BPF / 切换混杂模式 |
| `[capture]` 网卡 / 环形缓冲 | **原地重开抓包 socket**（重开期间可能有极短丢包） |
| `[firewall]` / `[full_ban]` / `[upnp]` | **原地迁移**：旧后端解封并清理后，按内存快照重新下发 |
| `[http]` token / `device_ip_limit` / `cors_*` | HTTP 服务原地更新 |
| `[http]` enabled / listen | **原地重启监听**（仅监听，不重启进程） |

`[capture] protocol` 变化时，若防火墙已启用，会一并原地重建防火墙后端。

### 兜底重启

若某组件原地重建失败（新网卡打不开、新防火墙后端构建报错等），回退为「保存状态 + 自重启」：
写状态文件（告警会话 + 封禁状态）→ `exec` 自重启 → 启动时按新后端继承。响应变为
`{"restart_required":["capture"],"restarting":true}`。

:::caution
若新配置本身非法导致启动期失败，进程会退出；由 procd 托管时可能反复重启，需要修正配置。
:::

### 封禁状态继承

- **原地重载**：状态在内存中转移。先取快照，按旧后端逐条解封并清理，再由同一个 blocker 按新后端
  恢复。因此切换后端时存在一个**极短的无规则窗口**。
- **兜底重启**：通过状态文件（二进制，权限 `0600`，默认在系统临时目录下 `pcdn-detect.state`，
  可用 `[http] state_dir` 改目录）传递。状态文件**只在兜底重启时写入**；正常停止不写、不继承。
  文件损坏（魔数 / 版本 / CRC 校验失败）则记录警告并按无继承启动。

## CORS

默认不启用（不回写任何 `Access-Control-*` 头）。需要浏览器从其它源直接调用时显式列出：

```toml
[http]
cors_allowed_origins = ["https://admin.example.com", "http://192.168.1.10:5173"]
# cors_allow_credentials = false   # 不能与 "*" 组合
# cors_max_age = 600
```

- 仅当请求带 `Origin` 且命中允许列表时才回写 `Access-Control-Allow-Origin`（回显来源，附
  `Vary: Origin`）；未命中不回写，由浏览器拦截响应。
- `["*"]` 允许任意来源，此时不能同时设 `cors_allow_credentials = true`（配置校验会拒绝）。
- **预检（OPTIONS）在鉴权之前响应**，因此不需要 token；实际请求仍需 Bearer 鉴权。
- 来源支持 `http` / `https`，可带端口，不接受路径与查询串。改动可热重载生效。
- CORS 只约束浏览器能否读取响应，不阻止请求本身。若用 `allow-no-token` 关闭鉴权又监听非回环
  地址，跨站页面仍可发起写请求（CSRF）。

## 与隐私模式的关系

`hide_address` 只影响**日志展示**。HTTP API 默认返回**原始**（不脱敏）的 MAC / IP，以便本机管理
工具使用——这也是必须限制接口可达范围的原因。

## 实现差异

| 项 | Go 版 | C 版 |
| --- | --- | --- |
| HTTP 传输层 | 内置 `minihttp`，与 `net/http` 有差分测试 | 自实现 HTTP/1.1 + picohttpparser |
| chunked 请求体 | 不支持（501） | 不支持（501） |
| `/dev/memory` | Go 运行时内存统计 | 无 GC 信息 |
| 监听地址变更 | 原地重启监听 | 若发生在 HTTP 请求线程内，回退为「保存状态 + 自重启」，避免等待自身 |

LuCI 面板可选**直连模式**，绕过 LuCI 代理直接请求本 API，需要同时满足 `listen` 局域网可达、
设置 `token`、并把面板来源加入 `cors_allowed_origins`。详见
[界面使用与运维](/luci/usage/#直连模式)。
