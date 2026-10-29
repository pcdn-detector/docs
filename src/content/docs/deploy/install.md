---
title: 安装与开机自启
description: 部署 pcdn-detect 二进制、初始化配置、配置 procd 服务与日常启停。
---

## 1. 放置二进制

```bash
scp bin/pcdn-detect-mipsle root@192.168.1.1:/usr/bin/pcdn-detect
ssh root@192.168.1.1 'chmod +x /usr/bin/pcdn-detect && /usr/bin/pcdn-detect -v'
```

推荐路径：`/usr/bin/pcdn-detect`（LuCI 面板的默认 `bin_path` 也是它）。

## 2. 初始化配置

```bash
mkdir -p /etc/pcdn-detect
/usr/bin/pcdn-detect --init-config /etc/pcdn-detect
/usr/bin/pcdn-detect -T -c /etc/pcdn-detect/pcdn-detect.toml
```

至少修改两项：

```toml
[capture]
interface = "br-lan"    # 必须是 LAN 侧网桥，能看到设备 MAC

[log]
level = "info"          # 想看到告警与封禁记录时
```

:::caution[工作目录]
`pcdn-detect` 按**当前工作目录**查找 `config.toml` / `pcdn-detect.toml`。作为 procd 服务运行时
默认工作目录是 `/`，所以要么在启动命令里 `cd` 到配置目录，要么始终用 `-c` 显式指定。
:::

## 3. 配置 procd 服务

不用 LuCI 面板时，手写 `/etc/init.d/pcdn-detect`：

```sh
#!/bin/sh /etc/rc.common
START=99
USE_PROCD=1

start_service() {
    procd_open_instance
    procd_set_param command /usr/bin/pcdn-detect -c /etc/pcdn-detect/pcdn-detect.toml
    procd_set_param stdout 1
    procd_set_param stderr 1
    procd_set_param respawn
    procd_close_instance
}

reload_service() {
    local pids
    pids="$(pidof pcdn-detect 2>/dev/null)"
    [ -n "$pids" ] && kill -HUP $pids
}
```

```bash
chmod +x /etc/init.d/pcdn-detect
/etc/init.d/pcdn-detect enable
/etc/init.d/pcdn-detect start
logread -e pcdn-detect        # 查看日志
```

`reload_service` 会给进程发 `SIGHUP`，实现原地热重载；脚本没有实现该函数时，`reload` 不会发送信号：

```bash
/etc/init.d/pcdn-detect reload
```

### 用 LuCI 面板时

装了 `luci-app-pcdn-detector` 就不需要手写脚本，它自带 `/etc/init.d/pcdn-detector`：

- 从 UCI（`/etc/config/pcdn-detector`）读取 `enabled` / `bin_path` / `config_path` / `extra_args`；
- 配置文件不存在时，自动调用 `pcdn-detect --init-config` 生成，并把 `interface` 填成 `br-lan`；
- `respawn 3600 5 5`，崩溃后自动拉起；
- 日志走 stdout，syslog tag 为 `pcdn-detect`。

此时通过 LuCI 或 `/etc/init.d/pcdn-detector {start|stop|restart|reload|isrunning|version}` 管理。

:::note[不要两套并存]
手写的 `/etc/init.d/pcdn-detect` 与面板的 `/etc/init.d/pcdn-detector` 会各自启动一个进程，
抓同一张网卡、下发同一批防火墙规则。二者只留一个。
:::

## 4. 前台调试

排查问题时先停服务，前台带高日志等级运行：

```bash
/etc/init.d/pcdn-detector stop
pcdn-detect -c /etc/pcdn-detect/pcdn-detect.toml -L -n 10 -t 30s
```

命令行参数优先于配置文件，适合临时放宽条件验证链路。

## 5. 升级与卸载

- **有面板**：用「下载/更新」页，安装后自动执行 `-v` 自检，失败回滚到 `.bak`。详见
  [界面使用与运维](/luci/usage/#下载与更新)。
- **无面板**：覆盖 `/usr/bin/pcdn-detect` 后 `/etc/init.d/pcdn-detect restart`。旧进程退出时会
  兜底解封并清理规则，因此重启不会遗留封禁。
- **卸载**：先 `stop`（触发兜底解封与规则清理），再删除二进制、init 脚本与配置目录。
  直接 `kill -9` 不会清理，nftables 后端下次启动会重建表，iptables 后端会清空专用链，
  `hook` 后端需自行幂等处理。

## 6. 与其他服务共存

- 抓包是**只读**的，不会改动任何系统状态，只消耗少量 CPU。混杂模式（默认开启）额外覆盖的是
  「设备 ↔ 设备」纯二层互访帧，对判定与封禁没有作用；`br-lan` 这类网桥接口上可以设为
  `promisc = false`，LAN 内互访流量大时能明显减少进入用户态的报文量。监听物理端口、或本机只做
  AP / 交换（流量经网桥穿过、目的地是其它设备）时保持默认 `true`。
- `nftables` 后端要求 LAN 侧是**网桥**（`ether saddr` 仅 bridge / netdev 族可用）。纯路由环境
  请改用 `iptables` 或 `hook` 后端。
- 与其他防火墙脚本共存时，注意专用链名（`ban_chain` / `upnp_chain`）不要与自己已有的链重名。
