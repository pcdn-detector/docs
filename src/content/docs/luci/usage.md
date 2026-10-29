---
title: 界面使用与运维
description: 概览、配置编辑、日志、下载更新、直连模式与常见运维命令。
---

菜单入口：**服务 → PCDN 检测**，包含「概览」「配置编辑」「日志」「下载/更新」四个页面。

## 概览

显示的内容：

- 运行状态、版本（主版本 + 构建号分开显示，完整字符串在悬停提示里）、PID / 运行时长、监听网卡；
- 启动 / 停止 / 重启 / **热重载**按钮；
- HTTP API 端口与密钥（点击「获取密钥」按需读取），「检测 HTTP API」按钮的状态码含义：

  | 结果 | 含义 |
  | --- | --- |
  | `200` | 正常 |
  | `401` / `403` | 密钥不匹配 |
  | 连接失败 | 服务未启动、端口 / 监听地址错误，或被防火墙拦截 |
  | 未启用 | `[http] enabled = false` |

- 启用 HTTP API 后展示**设备级统计**：每设备 IPv4 / IPv6 的端口条目数与封禁数（含 UDP / TCP 拆分），
  可下钻「端口明细」（按地址族、封禁状态筛选 + 分页）和「对端 N」（分页上限受 `device_ip_limit` 约束）。
- `port_evictions` / `port_drops` 大于 0 时提示 `[memory] max_ports` 已生效。

实时统计默认每 5 秒刷新一次，可用「自动刷新」开关关闭（选择会记住）。页面切到后台时停止轮询，
切回前台立即刷新一次；同一时刻只允许一个轮询在途。自动刷新只更新汇总，展开的明细保持不动。

## 配置编辑

- **完整 TOML 文本编辑**：像编辑普通文本一样修改全文，保留注释、黑白名单与未知配置项；
- 保存前调用 `pcdn-detect -T` 校验，**失败不写盘**；支持 `Ctrl/Cmd+S`；
- 校验通过后：服务运行中 → `kill -HUP` 原地热重载（不重启、不丢封禁状态）；已启用但未运行 →
  自动启动；未启用 → 仅保存；
- 「恢复默认」也用程序生成一份新配置（保留当前监听网卡），不依赖随包模板。

大配置按**每片最多 1000 字符**分片上传（`POST savechunk` 追加到临时文件），全部发完后
`POST savecommit` 统一校验、落盘、热重载。从而不受部分固件约 8KiB 请求体上限的影响——旧方式会把
`[[filter.blacklist]]` 等尾部内容截断。分片仍保留完整注释与名单。

后端 `getconfig` / `saveconfig` **只收发完整文件**，不做 TOML 解析、字段提取或补丁。

## 日志

- 从 `logread` 按 **syslog tag 精确筛选**（不是正文模糊匹配），不会混入其它进程日志；
- 支持等级、关键词、行数、自动刷新、暂停与下载；
- 页面切到后台时自动暂停刷新；
- 可查看的历史长度取决于系统日志缓冲区，长期保存请配置落盘或远程 syslog。

看不到告警时先检查 `[log] level`：默认 `warn` 不会输出普通告警。

## 下载与更新

用于安装 / 升级 `pcdn-detect` 二进制。

| 选项 | 取值 | 下载前缀 |
| --- | --- | --- |
| 更新源 | `GitHub` | `https://github.com/<repo>/releases/latest/download` |
| 更新源 | `CNB` | `https://cnb.cool/<repo>/-/releases/latest/download` |
| 版本 | `Go` | 默认仓库 `pcdn-detector` |
| 版本 | `C` | 默认仓库 `pcdn-detector-c`（资源名与 Go 版一致） |

- 切换源或版本时「代码仓库」会自动回填；填写其他值即视为自定义仓库，原样使用；
- 「下载地址前缀」可覆盖自动推导的前缀（资源名仍自动追加），也可直接填完整 http(s) 地址
  （须为**未压缩的 ELF 二进制**）；
- 架构识别顺序：`opkg print-architecture` → `apk --print-arch` → `uname -m`；
- 资源名映射：`mipsel_*` → `pcdn-detect-mipsle`、`mips_*` → `-mips`、`aarch64_*` → `-arm64`、
  `arm_*` → `-armv7`、`x86_64` → `-amd64`。

安装流程按剩余空间选择下载位置：

| 方式 | 条件 | 行为 |
| --- | --- | --- |
| `tmp` | `/tmp` ≥ 24MiB | 下载到 `/tmp`（tmpfs，占用内存），复制后立即删除 |
| `direct` | `/tmp` < 24MiB 且目标分区 ≥ 16MiB | 下载到目标目录临时文件，同分区 `rename` 原子覆盖 |
| `overwrite` | 两者都不足 | 先删旧程序再下载；需开启「空间不足时覆盖安装」，**失败无法回滚** |

任何方式都会：校验文件大小与 ELF 头 → 备份原文件（`rename` 为 `pcdn-detect.bak`，不额外占闪存）
→ 覆盖安装 → 执行 `-v` 自检 → 失败自动回滚 → 成功则清理临时文件与 `.bak` → 重启服务。
上次更新被中断（只剩 `.bak`）时，下次运行会先自动恢复。进度日志在
`/tmp/pcdn-detect-update.log`。

## 直连模式

在「概览 → 服务设置」勾选「直连后端 API（绕过 LuCI 代理）」后，实时统计、端口明细与对端列表改由
浏览器直接请求 `pcdn-detect`，不再为每次轮询启动 Lua 代理进程。

需要同时满足以下条件，否则页面自动回退到代理并显示原因：

1. `[http] listen` 监听局域网可达地址（默认 `127.0.0.1:8080` 只有路由器本机能访问）；
2. 设置 `[http] token`；
3. 把 LuCI 页面来源加入 `[http] cors_allowed_origins`（**不带路径**；非 80 端口要写端口，
   默认端口 80 / 443 不要写，因为浏览器 `Origin` 不带默认端口）。

```toml
[http]
enabled = true
listen = "0.0.0.0:8080"
token = "换成随机字符串"
cors_allowed_origins = ["http://192.168.1.1"]
```

只有浏览器层面失败（CORS 未放行、网络不通、5 秒超时）才回退，且 60 秒内不再重试；`401` 等业务
错误照常展示。直连时 token 会随 `/status` 下发（页面本来也能通过「获取密钥」看到），API 仅支持
明文 HTTP，请只在可信内网使用。LuCI 若通过 HTTPS 访问，浏览器会以 mixed content 拦截直连请求。

## 面板代理的实现要点

- `device` / `peers` 只解析上游响应头，body 按 16KiB 分块直接转发给浏览器，Lua 侧峰值约等于一块；
  `stats` 的 `/devices` 同样流式转发，只有体积很小的 `/status` 整段缓冲；
- Lua 侧不做 JSON 解码，浏览器统一 `JSON.parse`；
- 读取总量有 32MiB 上限，异常上游不会把 CGI 进程撑爆；
- 上游 4xx / 5xx 的 `{"error":"..."}` 与状态码原样到达前端。

## 常用运维命令

```bash
/etc/init.d/pcdn-detector start | stop | restart | reload
/etc/init.d/pcdn-detector enable | disable
/etc/init.d/pcdn-detector isrunning     # 输出 running / stopped
/etc/init.d/pcdn-detector version       # 输出二进制版本
logread -e pcdn-detect
```

对应的 UCI 配置在 `/etc/config/pcdn-detector`：

| 选项 | 默认 | 说明 |
| --- | --- | --- |
| `enabled` | `0` | 是否开机自启 |
| `config_path` | `/etc/pcdn-detect/pcdn-detect.toml` | TOML 路径 |
| `bin_path` | `/usr/bin/pcdn-detect` | 二进制路径 |
| `extra_args` | 空 | 追加参数，**优先级高于 TOML** |
| `update_source` | `github` | `github` / `cnb` |
| `build_variant` | `go` | `go` / `c` |
| `repo` | `Womsxd/pcdn-detector` | 切换源 / 版本时自动回填 |
| `download_base` | 空 | 覆盖下载地址前缀 |
| `allow_overwrite` | `0` | 空间不足时允许覆盖安装（失败无法回滚） |
| `direct_api` | `0` | 概览页直连 HTTP API |
| `log_file` | 空 | 自定义日志文件路径；留空时用 `logread` 读取 syslog（默认配置未写入该项，需要时手动添加） |
