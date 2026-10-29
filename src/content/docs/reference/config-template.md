---
title: 完整配置模板
description: pcdn-detect 的默认 TOML 模板，含逐项注释，可直接复制使用。
---

以下为整理版模板：字段名与默认值与二进制内置的 `defaultConfigTemplate` 一致，注释作了精简，
并补充了黑白名单的示例条目。实际生成结果以 `pcdn-detect --init-config` 为准。Go 版与 C 版的
活动配置键一致，两版模板可互相加载 / 校验通过。

```toml
# pcdn-detect 配置文件（TOML 格式）
#
# 命令行参数优先于本文件：显式指定的参数会覆盖此处的同名配置。
# 配置按功能分块：[detect] 检测、[capture] 抓包、[memory] 内存、
# [log] 日志展示、[filter] 黑白名单、[firewall] 防火墙对接、[full_ban] 全端口封禁、
# [upnp] UPnP 拦截、[http] HTTP API。

# ===== 检测参数 =====
[detect]
# 触发次数：同一设备同一端口在检测时长内出现的不同远端公网 IP 数量达到该值即判定疑似 PCDN
threshold = 20

# 检测时长（滑动窗口），支持 "60s"、"5m"、"1h"，也接受整数秒
window = "60s"

# 持续提示时长：期间只要该端口仍有流量（任意对端，无论新旧）就刷新计时器；超过该时长
# 没有任何流量则输出「PCDN行为结束」并静默（期间出现新对端时额外输出「持续产生PCDN行为」）
alert_duration = "10m"

# 检测扫描间隔
interval = "2s"

# ===== 抓包 =====
[capture]
# 要监听的网卡名称（必填），例如 br-lan、br0、eth0
interface = ""

# 是否开启混杂模式（br-lan 等网桥接口上可以关闭）
promisc = true

# 抓包环形缓冲：总内存 = block_size * num_blocks（字节）。默认 65536 * 4 = 256KiB；
# 若抓包出现丢包可适当增大 num_blocks（如 8 = 512KiB）。
#   frame_size  单个帧上限（字节），须能整除 block_size；默认 2048；
#   block_size  每个块大小（字节），须为页大小(4096)与 frame_size 的整数倍；
#   num_blocks  块数量，至少为 1。
# snaplen 为内核层 BPF 每包复制到用户态的最大字节数（默认 256，只需头部）：
# 调大可覆盖更长的 IPv6 扩展头链，设为 frame_size 即不截断（旧行为，内核复制量更高）。
frame_size = 2048
block_size = 65536
num_blocks = 4
snaplen = 256

# protocol 为内核层过滤器放行的传输层协议（默认 "udp"）：
#   "udp" = 仅放行 UDP（默认，PCDN 以 UDP 为主）；
#   "tcp" = 仅放行 TCP；
#   "all" = 同时放行 UDP 与 TCP（TCP 流量也参与统计）。
# 三种取值都会在内核层丢弃 ARP、STP、ICMP/ICMPv6 等无关报文。
# 防火墙的封禁协议随此设置变化。
protocol = "udp"

# ===== 内存 =====
[memory]
# Go 堆内存软上限：达到后运行时会更积极地 GC。支持 "16MiB"、"24M"、纯字节数等写法；
# 未配置时不设置软上限（也可用环境变量 GOMEMLIMIT，由 Go 运行时原生识别）。
# 建议设为设备可用内存的一半左右，并预留抓包环形缓冲 + 2~3MiB 余量。
# C 版无 GC：本项仅解析与校验，不产生运行时效果。
# memory_limit = "32MiB"

# GC 目标百分比（GOGC 语义）：堆内新增数据达到「存活堆 × gc_percent/100」时触发 GC。
# 未配置时用运行时默认（GOGC=100），也尊重环境变量 GOGC。
# 取值范围 1~1000（推荐 20~50）；-1 会关闭 GC，不支持。C 版无效果。
# gc_percent = 30

# 低内存模式：某「设备 + 端口」一旦触发告警，即清空已记录的对端 IP 列表并停止记录新的对端，
# 只保留触发状态（告警续期 / 累计流量）继续统计。
# 代价：告警期间不再输出「持续产生PCDN行为（新增相关IP）」。
low_memory = false

# 单端口对端记录上限：
#   - 省略：默认取 max(1000, threshold × 10)；开启 low_memory 时改为 threshold；
#   - 0：不限制；
#   - 大于 0 但小于 threshold：自动提升为 threshold。
# peer_limit = 1000

# 单设备端口条目上限：同一设备同时跟踪的「端口 + 协议 + 地址族」条目数上限。
#   - 省略：默认 512（约 90KiB/设备）；
#   - 0：不限制。
# 达到上限时按「最接近过期 + 同档内对端数最少」批量提前过期 10% 的端口。
# 告警中的端口不参与淘汰；若全部端口都在告警中，则新端口不建立（见 port_drops）。
# max_ports = 512

# ===== 日志展示 =====
[log]
# 日志输出等级：debug / info / warn / error，低于该等级的日志不再输出。
#   warn（默认）：只输出警告与错误；
#   info：额外输出检测告警与封禁 / 解封等业务事件；
#   debug：额外输出调试信息。
# 可用 SIGHUP 或 POST /api/v1/reload 热更新。
level = "warn"

# 日志时区：IANA 名称（如 Asia/Shanghai）或 POSIX 串（如 CST-8）；留空表示自动读取系统时区
timezone = ""

# 隐私模式：隐藏设备自身的 MAC / IPv6 / 公网 IPv4（内网 IPv4 保持原样），
# 远端对端地址不受影响。仅影响日志展示。
hide_address = false

# ===== HTTP API =====
# 可选的本机管理接口：读取运行时状态、手动解封、重载配置。默认关闭。
# 注意：热重载不依赖本接口，SIGHUP 始终可用。
[http]
enabled = false

# 监听地址。默认仅监听回环地址；
# 若监听其它地址（如 0.0.0.0:8080），必须同时设置 token，否则启动会被拒绝。
listen = "127.0.0.1:8080"

# Bearer 令牌：非空时所有请求须带 Authorization: Bearer <token>。
# 特殊值 "allow-no-token" 表示显式关闭鉴权（允许绑定非回环地址）。
token = ""

# /api/v1/peers 每次最多返回的对端 IP 数量；默认 200。
device_ip_limit = 200

# 跨域（CORS）：默认不启用。["*"] 表示允许任意来源（仍需 token 鉴权）。
# 预检请求（OPTIONS）在鉴权之前响应，不要求携带 Authorization。
# cors_allowed_origins = []
# cors_allow_credentials = false   # 不能与 "*" 组合
# cors_max_age = 600               # 预检结果缓存秒数；0 表示不缓存

# 重启继承用的状态文件目录（二进制，含 MAC / IP，权限 0600）；留空为系统临时目录。
# state_dir = ""

# ===== 黑白名单（按设备 MAC 过滤）=====
[filter]
#   "whitelist" = 名单内命中的设备（或指定端口）不检测，其余照常检测（默认；空名单 = 检测全部）
#   "blacklist" = 只检测名单内的设备，其余不检测（名单为空会报错退出）
list_mode = "whitelist"

# 每条需写 mac；enabled = false 可临时停用（默认 true）。
# 省略 ports = 全部端口；指定 ports 则只作用于这些端口，元素可为整数或表达式字符串。
#
# [[filter.blacklist]]
# mac = "aa:bb:cc:dd:ee:ff"
#
# [[filter.blacklist]]
# mac = "11:22:33:44:55:66"
# ports = [40000, 40001]
# upnp = true                      # [upnp] mode = "device" 时使用
# full_ban = true                  # [full_ban] mode = "device" 时使用
#
# [[filter.whitelist]]
# mac = "aa:bb:cc:dd:ee:ff"
#
# [[filter.whitelist]]
# mac = "22:33:44:55:66:77"
# ports = ["40000-40010", "80/443"]

# ===== 防火墙对接（自动封禁 / 解封）=====
# enabled = true 时：某设备某端口触发 PCDN 行为即封禁该端口流量，
# 「PCDN行为结束」时解封；退出时兜底解封。
# 封禁协议随触发报文：UDP 触发只封 UDP，TCP 触发只封 TCP。
# [firewall]
# enabled = false
# backend = "hook"                 # hook / iptables / nftables
#
# 封禁地址族：true（默认）= 同时封禁 IPv4 与 IPv6；false = 按触发地址族单独封禁
# ban_both = true
#
# 启用防火墙 / reload 时把当前已处于告警中的端口直接纳入封禁（幂等，默认关闭）
# ban_active_alerts = false
#
# 单条命令执行超时
# timeout = "5s"
#
# ---- 后端专用项按后端分块，只解析当前 backend 对应的块 ----
#
# backend = "hook"：单条模板用 {action} 区分动作（ban / unban）
# 占位符：{action} {mac} {ip} {port} {family} {proto}；ban_both=true 时对 v4/v6 各执行一次
# [firewall.hook]
# cmd = "my-hook {action} {mac} {ip} {port} {family} {proto}"
#
# backend = "iptables"：iptables 与 ip6tables 的专用链 PCDN_DETECT / PCDN_DETECT_UPNP
# chain / input_chain 只是跳转插入点（启动时会清空并重建专用链）
# [firewall.iptables]
# chain = "FORWARD"
# input_chain = "INPUT"
# ban_chain = "PCDN_DETECT"        # 自定义时请勿与 chain / input_chain 重名
# upnp_chain = "PCDN_DETECT_UPNP"
#
# backend = "nftables"：bridge 族指定钩子按源 MAC + 协议 + 源端口丢弃（链名固定与表名一致）
# 集合按「地址族 + 协议」拆分为 <set>_<family>_<proto>，如 banned_v4_udp
# [firewall.nftables]
# table = "pcdn_detect"
# set = "banned"
# hook = "prerouting"              # 建议保持 prerouting
# input_hook = "input"             # UPnP 拦截专用链的钩子
#
# 封禁元素超时（默认不设置）：设置后集合元素带 timeout，Blocker 按 TTL/3 周期续期；
# 进程被 SIGKILL / OOM 杀死后由内核自动过期。需内核支持集合 timeout（约 4.8+）。
# 若续期失败，封禁可能提前失效（fail-open）。
# ban_ttl = "30m"

# ===== 全 UDP 端口封禁模式（独立配置块）=====
# 某设备「被封禁的不同端口数」达到 threshold 后，封禁该设备全部 UDP 端口，
# 但放行 allow 指定的端口；计数归零时自动解除。
# [full_ban]
# mode = "off"                    # off（默认）/ on（全部设备）/ device（仅名单中标 full_ban）
# threshold = 5
#
# 留空（或删除该行）时使用内置常用端口：[53, 123, 67, 68, 546, 547]。
# 显式配置时以其为准（不叠加内置端口）。
# allow = [53, 123, 67, 68, 546, 547]
#
# hook 后端专用：{action} 为 ban / unban，占位符 {action} {mac} {ip} {family} {ports}
# [full_ban.hook]
# cmd = ""

# ===== UPnP 拦截（独立配置块）=====
# 拦截设备向路由器发起的 UPnP 请求（SSDP 发现 + HTTP 控制），依赖 [firewall] 启用。
# 拦截范围随 [filter] list_mode 变化：
#   黑名单模式 = 仅拦截名单内设备；白名单模式 = 拦截全部，仅放行名单内设备。
# [upnp]
# mode = "off"                    # off（默认）/ on / device
#
# 留空时为内置端口：[1900, 5000]（SSDP / miniupnpd HTTP 控制）。
# ports = [1900, 5000]
#
# hook 后端专用。动作：ban / unban、block-all / unblock-all、allow / disallow
# [upnp.hook]
# cmd = ""
```

## 最小可用配置

只想尽快跑起来时，只需要这几行：

```toml
[detect]
threshold = 20
window = "60s"

[capture]
interface = "br-lan"

[log]
level = "info"
```

其余项取内置默认值。需要自动封禁时再加 `[firewall]`，需要面板显示统计时再加 `[http]`。
