---
title: 命令行参数
description: pcdn-detect 的全部命令行选项、优先级与常用示例。
---

短形式（`-x`）与完整形式（`--xxx`）完全等价，可混用。**优先级：命令行参数 > 配置文件 > 内置默认值**。

## 参数表

| 短 / 长 | 默认值 | 说明 |
| --- | --- | --- |
| `-i` / `--interface` | 空（**必填**） | 监听网卡，如 `br-lan`、`br0`、`eth0` |
| `-n` / `--count` | `20` | 窗口内同一设备同一端口的**不同远端公网 IP** 数量阈值 |
| `-t` / `--window` | `60s` | 检测时长（滑动窗口），支持 `30s` / `5m` / `1h` |
| `-a` / `--alert-duration` | `10m` | 持续提示时长；期间有流量即续期，超时无流量则输出「PCDN行为结束」 |
| `-p` / `--promisc` | `true` | 混杂模式；`br-lan` 等网桥接口上可以关闭 |
| `-s` / `--interval` | `2s` | 检测扫描间隔 |
| `-z` / `--timezone` | 空 | 日志时区；IANA 名称（`Asia/Shanghai`）或 POSIX 串（`CST-8`），默认自动读取 |
| `-H` / `--hide-address` | `false` | 隐私模式：隐藏设备自身 MAC / IPv6 / 公网 IPv4 |
| `-L` / `--low-memory` | `false` | 低内存模式：告警后清空对端列表且不再记录新对端 |
| `--peer-limit` | `max(1000, 阈值×10)`；低内存模式下为 `阈值` | 单端口对端记录上限，`0` 不限制，小于阈值自动抬到阈值 |
| `--max-ports` | `512` | 单设备端口条目上限，`0` 不限制 |
| `-P` / `--protocol` | `udp` | `udp` / `tcp` / `all`，大小写不敏感 |
| `-c` / `--config` | 空 | 指定配置文件（只读该文件，不自动创建） |
| `--init-config` | — | 在指定目录生成默认配置 `pcdn-detect.toml` 并退出 |
| `-T` / `--test-config` | `false` | 只校验配置（含命令行覆盖）并退出 |
| `-v` / `--version` | — | 输出版本号并退出 |
| `-h` / `--help` | — | 输出帮助（两版均支持） |

两版 CLI 对显式指定的 `-n` / `--peer-limit` / `--max-ports` 均限制在 `200000000` 以内；C 版还会
校验配置文件中这些字段的取值上限。

## 语义要点

- **`--peer-limit`** 省略时取 `max(1000, threshold × 10)`；开启 `low_memory` 时取 `threshold`。
  显式配置始终优先。
- **`--init-config <目录>`**：目录必须已存在（不存在直接报错，不自动创建）；目标文件已存在则
  报错退出、**不覆盖**；生成后立即退出，不加载配置，也不在当前目录留下文件。
- **`-T` / `--test-config`**：通过返回 `0`，失败返回 `1`；不启动抓包 / HTTP / 防火墙，不创建配置
  文件。热重载在应用变更前跑同一套校验。
- **`-v` / `--version`**：形如 `0.0.1-beta.2+<git 短哈希>`，哈希为 SemVer build metadata；
  未注入哈希时显示 `+unknown`。该选项不加载也不创建配置文件。
- **`-c`**：显式指定后**不走候选顺序**（`config.toml` → `pcdn-detect.toml`），也不自动创建。
- **`-P` / `--protocol`**：不仅决定抓包过滤，也决定封禁协议与 nftables 预建集合。

## 常用示例

```bash
# 基本运行：监听 br-lan，60 秒内 20 个不同对端即告警
pcdn-detect -i br-lan -n 20 -t 60s

# 指定配置 + 隐私模式 + 只看 UDP
pcdn-detect -c /etc/pcdn-detect/pcdn-detect.toml -H -P udp

# 内存紧张的设备
pcdn-detect -i br-lan -L -n 15 --max-ports 256

# 同时检测 UDP 与 TCP
pcdn-detect -i br-lan -P all

# 只校验配置
pcdn-detect -T -c /etc/pcdn-detect/pcdn-detect.toml

# 生成默认模板
pcdn-detect --init-config /etc/pcdn-detect

# 系统时区不对时显式指定
pcdn-detect -i br-lan -z Asia/Shanghai
```

## 没有命令行参数的配置

以下只能写在配置文件里：`[memory]` 的 `memory_limit` / `gc_percent`、`[capture]` 的
`frame_size` / `block_size` / `num_blocks` / `snaplen`、`[log]` 的 `level`，以及 `[http]`、
`[filter]`、`[firewall]`、`[full_ban]`、`[upnp]` 的全部字段。
