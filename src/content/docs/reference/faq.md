---
title: 常见问题
description: 启动失败、看不到告警、封禁不生效、内存与升级相关问题的排查路径。
---

## 启动与配置

**服务启动失败 / 一直重启**

先用 `pcdn-detect -T -c <配置>` 看具体错误（面板里是「配置编辑 → 仅校验」）。常见原因：

| 原因 | 修法 |
| --- | --- |
| `[capture] interface` 为空或写错 | 填 LAN 侧网桥，通常是 `br-lan` |
| `backend = "hook"` 但没写 `[firewall.hook] cmd` | 补上命令模板，或换 `iptables` / `nftables` |
| `list_mode = "blacklist"` 但名单为空 | 加条目，或改回 `whitelist` |
| HTTP 绑定非回环地址但未设 token | 设置 `token`，或改回 `127.0.0.1` |
| 非 root / 缺 `CAP_NET_RAW` | 用 root 运行 |
| `iptables` 后端但系统无 `iptables` | 安装 `iptables`，或先用 `hook` 后端 |
| `nftables` 后端但系统无 `nft` | 安装 `nftables`，或改用 `iptables` / `hook` |

**配置文件到底读的是哪个？**

按**当前工作目录**依次尝试 `config.toml` → `pcdn-detect.toml`，取第一个能解析的；都不行就自动创建
`pcdn-detect.toml`。作为 procd 服务运行时工作目录是 `/`，所以务必用 `-c` 显式指定，或先 `cd` 到
配置目录。启动日志的「已加载配置文件：…」会直接告诉你答案。

## 看不到检测结果

**日志页为空 / 看不到告警**

`[log] level` 默认 `warn`，只输出警告与错误。改成 `info` 并热重载即可看到「疑似产生PCDN行为」等
业务事件。其它可能：服务没启动、系统日志缓冲区已滚动、设备没有 `logread`。

**确实有 PCDN 但没触发**

按顺序检查：

1. **网卡选错**：必须是能看到设备真实 MAC 的 LAN 侧网桥，不是 WAN，也不是纯三层接口。
2. **协议不符**：默认只统计 UDP。若目标走 TCP，需 `[capture] protocol = "all"` 或 `"tcp"`。
3. **阈值过高**：先临时降 `threshold`、缩 `window` 验证链路上有数据，再调回去。
4. **名单挡掉了**：`list_mode = "blacklist"` 时只有名单内设备会被检测，且条目若写了 `ports`
   只覆盖这些端口。
5. **对端被过滤**：只有全球可路由的远端 IP 参与统计，内网 / 链路本地 / 组播不计。

**误报太多**

调高 `threshold` 或延长 `window`；确认 `[filter]` 里没有把正常的高并发应用（下载器、游戏加速、
监控回传）也纳入检测范围。建议先只开日志观察一两天再启用自动封禁。

## 封禁相关

**告警了但设备没被断网**

1. `[firewall] enabled` 是否为 `true`，`backend` 是否为你实际在用的防火墙；
2. 把 `[log] level` 设为 `info`，看是否有「已封禁」；有报错会以 `warn` 输出（如命令不存在、超时）；
3. **nftables 后端要求 LAN 侧是网桥**：`ether saddr` 只在 bridge / netdev 族可用，纯路由环境改用
   `iptables` 或 `hook`；
4. 确认钩子是 `prerouting`（默认）。挂在 `forward` 上会漏掉「发给路由器自身 MAC 再被三层转发」
   的 PCDN 流量；
5. `[capture] protocol` 决定了封哪个协议：`udp` 只封 UDP。

**启用全 UDP 封禁后设备基本不能上网**

这通常不是预期情况：多半是 `allow` 列表没有覆盖设备必需的 UDP 服务。内置放行
`53 / 123 / 67 / 68 / 546 / 547`；显式配置 `allow` 会**替换**而不是叠加内置端口，注意补上。
需要恢复时手动解封：

```bash
curl -XPOST localhost:8080/api/v1/unban \
  -d '{"mac":"aa:bb:cc:dd:ee:ff","port":40000,"proto":"udp"}'
```

或临时把 `[full_ban] mode` 设为 `off` 后热重载。

**进程被 kill 后规则会残留吗**

- `nftables`：下次启动先 `delete table` 再重建，残留被清理；
- `iptables`：规则都在专用链内，启动时清空并重建，不影响你自己的 `FORWARD` / `INPUT`；
- `hook`：由你的命令负责，建议 ban / unban 幂等；
- 想彻底避免，给 nftables 配 `ban_ttl`（如 `"30m"`），进程死后元素由内核自动过期。

## HTTP API 与面板

**概览页没有实时统计**

`[http] enabled = false`，或 `listen` / `token` 不匹配。默认 `127.0.0.1:8080` 只有本机能访问，
面板通过本机回环读取。「检测 HTTP API」显示 401 说明密钥不匹配。

**curl 返回 401 / 403**

配置了 `token` 就必须带 `Authorization: Bearer <token>`。若在浏览器里跨源直连调用，还需要把来源
加入 `cors_allowed_origins`（不带路径，非默认端口要写端口）。

**面板「下载/更新」返回 404**

默认仓库没有公开 Release 时会出现。改用自定义完整地址，或本地编译后上传到 `/usr/bin/pcdn-detect`。

**概览页版本显示 `sh: ... Permission denied`**

旧版缓存问题：`version_of` 曾把失败输出写进 `/tmp/pcdn-detect.version`，而 `chmod` 只改 `ctime` /
`mode`，导致缓存不失效。清除即可：

```bash
rm -f /tmp/pcdn-detect.version
```

新版已修复（缓存 key 含 `mtime | ctime | mode`，且只缓存匹配版本号的输出）。

**LuCI 菜单不显示 / 页面空白**

21.02+ 未安装 `luci-compat` 时会这样。正常安装本包会自动拉取；手动安装请先
`opkg install luci-compat`（apk 系统用 `apk add luci-compat`），然后清缓存：

```bash
rm -f /tmp/luci-indexcache && rm -rf /tmp/luci-modulecache
```

## 性能与内存

**内存占用高 / 内存不回落**

- Go 版：设 `[memory] memory_limit`（如 `"32MiB"`）与 `gc_percent`（20~50）；
- 两个版本都受 `max_ports`（默认 512）、`peer_limit`、`low_memory` 约束；
- 抓包缓冲默认只占 256KiB，不是主要开销；
- 逐个端口对端数极多时，可开 `low_memory` 牺牲明细换取稳定内存。

用 `/api/v1/devices` 的 `port_evictions` / `port_drops` 判断端口上限是否已生效，
`/dev/memory`（Go 版）查看真实堆占用。

**怀疑抓包丢包**

先增大 `num_blocks`（`4 → 8 → 16`）。`ip -s link` 的丢包计数反映的是网卡层，不等于 AF_PACKET
环形缓冲溢出；环形缓冲丢包计数目前未通过接口暴露，只能通过加倍 `num_blocks` 观察行为变化。
PCDN 检测统计的是窗口内不同远端 IP 数，短暂突发丢少量包通常不影响判定。

**日志时间不对**

依次检查 `-z` 参数、`TZ` 环境变量、`/etc/TZ`。OpenWrt 上常见 `/etc/TZ` 缺失，显式配
`timezone = "Asia/Shanghai"` 或 `"CST-8"` 即可，支持热重载。
