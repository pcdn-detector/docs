---
title: 防火墙联动
description: 自动封禁与解封、三种后端、封禁地址族、规则残留处理与全 UDP 端口封禁。
---

## 行为

启用后：

- 某设备某端口**首次触发告警** → 封禁该设备在该端口上的流量；
- 输出「PCDN行为结束」→ **解封**；
- 程序正常退出 → 对仍在封禁中的条目**兜底解封**并清理规则；
- 启动失败（HTTP 监听 / 抓包初始化失败）→ 先清理再退出。

封禁粒度是「**设备 MAC + 本地端口 + 协议**」，不同端口、不同协议各自独立封禁与解封。

```toml
[firewall]
enabled = true
backend = "nftables"        # hook / iptables / nftables
ban_both = true             # 同时封禁 IPv4 与 IPv6
ban_active_alerts = false   # 启用 / reload 时补发当前已告警端口的封禁
# timeout = "5s"            # 单条防火墙命令超时
```

| `backend` | 实现 |
| --- | --- |
| `hook` | 一条自定义命令模板，`{action}` 区分 `ban` / `unban`，可适配任意防火墙 |
| `iptables` | `iptables` / `ip6tables` 的专用链 `PCDN_DETECT`，在 `chain`（默认 `FORWARD`）插入跳转 |
| `nftables` | `bridge` 族指定钩子（默认 `prerouting`）上的拼接集合，按「源 MAC . 源端口」丢弃 |

:::tip[先看日志再排查]
封禁 / 解封都按 **info** 输出，默认 `warn` 看不到。把 `[log] level` 设为 `"info"` 就能看到
`已封禁` / `已解封` / `已执行全 UDP 端口封禁`。
:::

## 后端专用配置

只解析与当前 `backend` 同名的子表，其余子表可保留备用。

```toml
[firewall]
enabled = true
backend = "hook"

[firewall.hook]
cmd = "my-fw-hook {action} {mac} {ip} {port} {family} {proto}"

# 换成 iptables 时：
# [firewall.iptables]
# chain = "FORWARD"                # 端口封禁的跳转插入点
# input_chain = "INPUT"            # UPnP 拦截的跳转插入点
# ban_chain = "PCDN_DETECT"        # 端口封禁专用链
# upnp_chain = "PCDN_DETECT_UPNP"  # UPnP 拦截专用链

# 换成 nftables 时：
# [firewall.nftables]
# table = "pcdn_detect"
# set = "banned"                   # 实际使用 <set>_<family>_<proto>
# hook = "prerouting"
# input_hook = "input"             # UPnP 专用链钩子
# ban_ttl = "30m"
```

`hook` 的占位符：`{action}` `{mac}` `{ip}` `{port}` `{family}`（`v4` / `v6`）`{proto}`（`udp` / `tcp`）。
只配一条模板，使用者自写 sh 包装按 `$1` 分发动作。

`iptables` 的 `chain` / `input_chain` 只是**跳转插入点**，规则实际写入专用链。启动时会安全地
清空并重建专用链：既清理上次被 `SIGKILL` / OOM 杀死后的残留，也不影响用户自己在 `FORWARD` /
`INPUT` 里的规则。专用链名可自定义，但**不能与 `chain` / `input_chain` 重名**，长度 ≤ 28，
只能含字母、数字、下划线、连字符。

:::caution[nftables 后端要求 LAN 为网桥]
`ether saddr` 仅在 `bridge` / `netdev` 族可用，所以 nftables 后端要求 LAN 侧是网桥（如 `br-lan`）。
规则挂在 **`prerouting`** 上，因为 `prerouting` 能看到所有进入网桥的帧——既覆盖纯二层桥接转发，
也覆盖「发给路由器自身 MAC、随后被三层转发出去」的 PCDN 流量；挂在 `forward` 上后者不会被命中，
封禁会失效。纯三层路由环境请改用 `iptables` 或 `hook`。
:::

## 封禁地址族 `ban_both`

| 取值 | 行为 |
| --- | --- |
| `true`（默认） | 任一地址族触发，**同时封禁该设备的 IPv4 与 IPv6**；同一「MAC + 端口 + 协议」只封一次 |
| `false` | 按触发到的地址族单独封禁，v4 / v6 各自独立封禁与解封 |

`ban_both = true` 时 `hook` 后端会对 `v4`、`v6` **各执行一次命令**。若模板里不含 `{family}`
等区分项，同一条命令会被执行两次——请保证命令幂等，或改用 `iptables` / `nftables`。

## 协议与地址族的实际范围

- 封禁协议**随触发报文**：UDP 触发只封 UDP，TCP 触发只封 TCP。
- `[capture] protocol = "udp"`（默认）时抓包层只统计 UDP，因此只会封 UDP。
- `[capture] protocol` 变化且防火墙已启用时，热重载会**一并原地重建防火墙后端**，否则新协议的
  封禁命令可能因集合不存在而失败。

## 补发既有告警

`ban_active_alerts = true`（默认关闭）时，启用防火墙或 reload 会把检测层**当前已处于告警中**的
端口直接纳入封禁，不等下一轮触发，且幂等。适用于「启动时防火墙关闭、运行中 reload 启用」，
或状态文件只恢复了告警会话而没有封禁的场景。

## 进程被强杀后的残留

正常退出会清理；被 `SIGKILL` / OOM 杀死时用户态无法自救，依赖后端自身的兜底：

| 后端 | 兜底方式 |
| --- | --- |
| `nftables` | 启动时先 `delete table` 再重建，残留元素与规则一并清除 |
| `iptables` | 启动时清空并重建专用链，不影响用户自己链中的规则 |
| `hook` | 由用户命令负责；建议 ban / unban 幂等，并在启动时自行清理 |

若希望**进程死后由内核自动解封**，给 nftables 集合元素加超时：

```toml
[firewall.nftables]
ban_ttl = "30m"
```

启用后集合元素带 `timeout`，Blocker 按 `TTL/3` 周期重新 `add` 续期，进程死亡后最迟在 TTL 内
自动过期。注意：

- 需要内核 nftables 集合支持 timeout（约 4.8+），且重复 `add` 能刷新超时；
- 若续期失败，封禁可能在告警结束前**提前失效**（fail-open）；
- 只对 nftables 有效，`iptables` / `hook` 没有内核级超时语义。

## 全 UDP 端口封禁

在「按端口封禁」之上叠加的设备级封禁：某设备**被封禁的不同端口数**达到阈值后，直接封禁该设备的
**全部 UDP 端口**，仅放行常用端口，从而阻断 UDP 方向的 PCDN，同时不影响基本联网。

```toml
[firewall]
enabled = true
backend = "iptables"

[full_ban]
mode = "device"                      # off（默认）/ on / device
threshold = 5                        # 被封禁的不同端口数达到该值后触发
allow = [53, 123, 67, 68, 546, 547]  # 放行的 UDP 端口；留空用内置常用端口
# [full_ban.hook]
# cmd = ""
```

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `mode` | `off` | `on` = 所有被检测设备；`device` = 仅名单中 `full_ban = true` 的设备 |
| `threshold` | `5` | 被封禁的不同端口数达到该值触发；同端口的 v4/v6 只计一个，UDP/TCP 都计入 |
| `allow` | 内置 | 留空 = `[53, 123, 67, 68, 546, 547]`；显式配置时以其为准，不叠加内置值 |

行为细节：

- **冗余规则清理**：全封禁生效后会移除该设备此前单独下发的 UDP 端口级规则；TCP 端口不在全封禁
  范围内，其规则保留。
- **触发后的新端口**：不再单独下发端口级规则，但仍计入端口统计，使全封禁在该设备告警全部结束
  前保持有效。
- **解除**：被封禁端口数归零时自动解除；程序退出时对所有仍处于全封禁状态的设备兜底解除。
- **作用范围**：按源 MAC 生效，对 IPv4 与 IPv6 **同时**起作用（与 `ban_both` 无关）。
- 依赖 `[firewall] enabled = true`，否则不生效（启动时提示警告）。

## 启动检查

启动时会检查后端命令是否存在：

- `iptables` 后端缺少 `iptables` → **报错退出**；
- `nftables` 后端缺少 `nft` → **报错退出**；
- 例外是 `ip6tables`：精简固件常见缺失，此时只告警并**忽略 IPv6**，IPv4 封禁照常工作，
  不会阻止启动（即使 `ban_both = true` 也只封 IPv4）。
