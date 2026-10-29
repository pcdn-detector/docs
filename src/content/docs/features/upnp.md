---
title: UPnP 拦截
description: 阻断设备向路由器发起的 SSDP 与 HTTP 控制请求，阻止其自行打洞开端口。
---

PCDN 设备常借助 UPnP 在路由器上自动映射端口（打洞），绕过 NAT 限制。本功能拦截**设备发往路由器
的 UPnP 请求**：阻断目的端口（默认 **SSDP 发现 UDP 1900** 与 **HTTP 控制 TCP 5000**）。

## 依赖

`[upnp]` 是独立配置块，但**复用 `[firewall]` 的后端**，必须同时启用防火墙：

```toml
[firewall]
enabled = true
backend = "iptables"

[upnp]
mode = "on"                 # off（默认）/ on / device
# ports = [1900, 5000]      # 拦截的目的端口（UDP + TCP）
# [upnp.hook]
# cmd = ""
```

`[firewall] enabled = false` 时该功能不生效，启动会提示警告。

## 拦截范围随名单方向变化

| `[filter] list_mode` | 拦截范围 |
| --- | --- |
| `blacklist` | **仅拦截名单内设备** |
| `whitelist` | **拦截全部**进入路由器的 UPnP，**仅放行名单内设备**（名单即例外）；名单为空即全部拦截 |

`mode` 决定名单里「哪些设备」参与：

| `mode` | 黑名单模式下的效果 | 白名单模式下的效果 |
| --- | --- | --- |
| `off` | 关闭 | 关闭 |
| `on` | 拦截全部黑名单设备 | 放行全部白名单设备 |
| `device` | 只拦截标记 `upnp = true` 的设备 | 只放行标记 `upnp = true` 的设备（**其余一律拦截**） |

名单条目的标记写法见[黑白名单](/config/filter/)。

## 端口

- **留空**（未配置或空数组）→ 内置 `[1900, 5000]`。
- **显式配置** → 以其为准，**不再叠加内置端口**；元素可为整数或端口表达式（如 `"5000-5100"`）。
- 同时覆盖 **UDP 与 TCP**：SSDP 是 UDP 1900，HTTP 控制是 TCP（如 5000）。

## 链与钩子

默认取「进入路由器」方向，因为 UPnP 请求的目的地是路由器自身：

| 后端 | 配置项 | 默认 |
| --- | --- | --- |
| `iptables` | `[firewall.iptables] input_chain` | `INPUT`（只是跳转插入点，规则写入专用链 `PCDN_DETECT_UPNP`） |
| `nftables` | `[firewall.nftables] input_hook` | `input`（独立的 bridge 基础链，与端口封禁链分开） |

端口封禁用的 `chain` / `hook`（默认 `FORWARD` / `prerouting`）与这里相互独立，可以各自挂不同位置。
特殊网络结构（路由器作三层转发、UPnP 服务不在本机）可改为 `FORWARD` / `prerouting` 等。

## 规则实现

- **iptables**：规则写入专用链 `PCDN_DETECT_UPNP`，并在 `input_chain` 插入跳转；对 UDP / TCP 各按
  目的端口（`multiport`）插入规则（v4 / v6 各一套）。黑名单模式插入按源 MAC 的 `DROP`；白名单
  模式先插无源 MAC 的全量 `DROP`，再为放行设备插 `ACCEPT`（`-I` 插表头，因此 ACCEPT 在 DROP 之上）。
- **nftables**：在独立的 bridge 基础链（`<table>_upnp`）中，黑名单模式用「被拦截设备 MAC 集合」
  命中即丢；白名单模式先 `ether saddr @<放行集合> … accept`，再对其余 `drop`。
- **hook**：需要 `[upnp.hook] cmd` 单条模板，`{action}` 区分动作，对 v4 / v6 各执行一次：
  `ban` / `unban`（黑名单按设备）、`block-all` / `unblock-all`（白名单拦截全部）、
  `allow` / `disallow`（白名单放行设备）。占位符 `{action}` `{mac}` `{ip}` `{family}` `{ports}`。

## 生效与解除

- 设备集合与拦截规则在**启动时**确定并立即下发；
- 修改名单、条目标记或 `list_mode` 后，热重载会同步更新实际策略；
- 程序退出时**兜底解除**；
- 防火墙迁移与重启继承都以**当前配置**为准，不恢复状态文件里已撤销的 UPnP 权限；
- 设备相关规则按**源 MAC** 生效，对 IPv4 与 IPv6 **同时**起作用（与 `ban_both` 无关）。

:::tip[只解决「打洞」]
UPnP 拦截不阻止设备直接发起的出站连接，只切断它借路由器自动开端口的能力。要真正阻断 PCDN
流量，仍需[防火墙联动](/features/firewall/)的端口封禁。
:::
