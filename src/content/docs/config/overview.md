---
title: 配置总览
description: 配置文件的位置与查找顺序、优先级、分块结构、校验与热重载。
---

## 配置分层

| 场景 | 层次 | 文件 | 内容 |
| --- | --- | --- | --- |
| 二进制 | TOML | `config.toml` / `pcdn-detect.toml`（当前目录） | 全部配置 |
| 面板 | UCI | `/etc/config/pcdn-detector` | 自启、二进制路径、TOML 路径、附加参数、更新源 |
| 面板 | TOML | `/etc/pcdn-detect/pcdn-detect.toml` | 检测内核的全部配置 |

面板的 UCI 层只做「怎么启动」，检测逻辑全部在 TOML 里。面板的「配置编辑」把 TOML 当纯文本
处理，不解析字段。

## 优先级

**命令行参数 > 配置文件 > 内置默认值**。

面板的 `extra_args` 会追加到 `pcdn-detect -c <配置>` 之后，因此它同样优先于 TOML，
例如 `-i br-lan -n 30 -t 60s`。

## 查找顺序

启动时在当前工作目录依次尝试：

1. `config.toml`
2. `pcdn-detect.toml`

取**第一个能成功解析**的。前一个不存在或解析失败会继续尝试下一个（失败原因记为警告）。若全部
不可用，**自动创建 `pcdn-detect.toml` 并写入内置模板**；若该文件已存在导致无法创建，则报错退出。

用 `-c <路径>` 显式指定时行为不同：**只读该文件**，不走候选顺序，也**不会自动创建**，不存在或
解析失败直接报错退出。

## 分块结构

| 配置块 | 作用 | 详见 |
| --- | --- | --- |
| `[detect]` | 阈值、窗口、持续期、扫描间隔 | [检测与抓包](/config/detect/) |
| `[capture]` | 网卡、混杂模式、协议、抓包缓冲与 snaplen | [检测与抓包](/config/detect/) |
| `[memory]` | 内存软上限、GC、低内存模式、对端与端口上限 | [内存与性能](/config/memory/) |
| `[log]` | 日志等级、时区、隐私模式 | [日志、时区与隐私](/config/log/) |
| `[http]` | HTTP API 开关、监听、令牌、CORS、状态目录 | [HTTP API](/features/http-api/) |
| `[filter]` | 黑白名单，按 MAC / 端口 | [黑白名单](/config/filter/) |
| `[firewall]` | 防火墙联动与后端专用项 | [防火墙联动](/features/firewall/) |
| `[full_ban]` | 全 UDP 端口封禁（全端口封禁） | [防火墙联动](/features/firewall/#全-udp-端口封禁) |
| `[upnp]` | UPnP 请求拦截 | [UPnP 拦截](/features/upnp/) |

完整可复制的模板见[完整配置模板](/reference/config-template/)。

## 取值规则

- **时长**：支持字符串（`"60s"`、`"5m"`、`"1h"`）或整数（按秒）。
- **端口**：整数或端口表达式字符串，支持范围 `a-b` 与斜杠列表 `a/b`，可混用，如
  `ports = [40000, "40001-40010", "80/443"]`。
- **内存大小**：支持 `"16MiB"`、`"24M"`、纯字节数等写法。
- **未知配置项**或 TOML 语法 / 类型错误：该文件视为**解析失败**，触发回退逻辑
  （显式 `-c` 时直接报错退出）。

## 校验

```bash
pcdn-detect -T -c /etc/pcdn-detect/pcdn-detect.toml
```

只校验配置（含命令行覆盖）并退出：通过返回 `0`，失败返回 `1`，不启动抓包 / HTTP / 防火墙，
也不创建配置文件。LuCI 面板保存前调用的就是它，校验失败不会写盘。热重载应用变更前也跑同一套
校验，失败则**拒绝本次重载**，进程继续用旧配置运行。

## 热重载

两种入口，共用同一把锁、串行执行：

```bash
kill -HUP <pid>                        # 始终可用（HTTP 关闭时唯一入口）
curl -XPOST localhost:8080/api/v1/reload   # 启用 [http] 后
```

重载期间重复到达的 `SIGHUP` 会合并为一次。绝大多数变更原地生效，包括阈值、名单、日志等级、
防火墙后端、HTTP 令牌等；只有 `[capture]` 的网卡 / 环形缓冲需要重开 socket（可能有极短丢包），
极少数组件重建失败时回退为「保存状态 + 自重启」。逐项对照表见
[HTTP API 的重载章节](/features/http-api/#重载配置)。

## 生成模板

```bash
pcdn-detect --init-config /etc/pcdn-detect
```

在指定目录写出 `pcdn-detect.toml` 并退出。目录必须已存在；目标文件已存在则报错、**不覆盖**；
生成过程不加载配置，也不会在当前目录留下文件。模板内容来自二进制内置的
`defaultConfigTemplate`，会随版本更新。
