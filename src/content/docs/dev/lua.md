---
title: LuCI 前端开发
description: 目录结构、页面职责、保存链路约定、本地迭代与打包发布。
---

面板的功能与使用见 [界面使用与运维](/luci/usage/)，安装与打包见
[安装与打包](/luci/install/)。

## 目录结构

```text
luci-app-pcdn-detector/
├── Makefile                                      # OpenWrt 打包（noarch）
├── scripts/build-openwrt.sh                      # 官方 SDK 构建 ipk / apk
├── luasrc/
│   ├── controller/pcdn-detector.lua              # 菜单、页面与后端接口（getconfig / savechunk / …）
│   ├── model/pcdn_toml.lua                       # TOML 只读解析（状态 / 统计）
│   ├── model/pcdn_util.lua                       # JSON、进程、HTTP、格式化
│   ├── model/cbi/pcdn-detector/
│   │   ├── overview.lua                          # 概览 + 服务设置（UCI）
│   │   ├── config.lua                            # 完整 TOML 文本编辑
│   │   ├── log.lua                               # 日志
│   │   └── update.lua                            # 下载源设置
│   └── view/pcdn-detector/
│       ├── status.htm                            # 状态卡片 + 服务控制
│       ├── config.htm                            # TOML 文本编辑器
│       ├── log.htm                               # 日志查看器
│       └── update.htm                            # 下载面板
├── root/
│   ├── etc/config/pcdn-detector                  # UCI 配置
│   ├── etc/init.d/pcdn-detector                  # procd 服务（缺配置时让程序自动生成）
│   ├── etc/uci-defaults/40_luci-pcdn-detector    # 首次安装初始化
│   └── usr/share/pcdn-detector/update.sh         # 下载 / 安装 / 回滚
└── po/zh-cn/pcdn-detector.po
```

## 核心约定

**保存链路不解析 TOML。**「配置编辑」有意把文件当纯文本：前端整段回传，后端只做校验、落盘、
热重载。`pcdn_toml.lua` 仅用于状态页 / 统计里读取少量字段。不要在保存路径加解析或字段提取。

**大配置分片上传。** 每片最多 1000 字符（UTF-8 约 4KiB），`POST savechunk` 追加到
`/tmp/pcdn-detect.save.part`，全部发完后 `POST savecommit` 统一校验、落盘、热重载。这样绕开
部分固件约 8KiB 的请求体上限——旧方式会把 `[[filter.blacklist]]` 等尾部内容截断。

**大响应流式转发。** `device` / `peers` 只解析上游响应头，body 按 16KiB 分块直接转发；
`stats` 的 `/devices` 同样流式，只有体积很小的 `/status` 整段缓冲。Lua 侧不做 JSON 解码，
浏览器统一 `JSON.parse`；读取总量有 32MiB 上限，避免异常上游撑爆 CGI 进程。

**版本缓存要看 `ctime`。** 缓存 key 包含 `mtime | ctime | mode`：`chmod` 只改 `ctime`，用
`mtime` 作 key 会导致旧错误信息一直显示（历史 bug）。

## 与内核的四种交互

| 通道 | 用途 |
| --- | --- |
| `pcdn-detect -T -c <配置>` | 保存前校验，失败不落盘 |
| `kill -HUP <pid>` | 原地热重载（不重启、不丢封禁状态） |
| `GET /api/v1/*` | 状态、设备统计、端口明细、对端列表（可直连或经 Lua 代理） |
| `logread`（syslog tag） | 日志页按 tag 精确筛选 |

面板本身不含检测逻辑，仓库也不内嵌 TOML：配置不存在时由 `pcdn-detect --init-config` 生成，
再把 `interface` 填成 `br-lan`。

## 本地迭代

没有编译步骤，改完直接覆盖到路由器：

```bash
scp -r luasrc root /tmp/
ssh root@192.168.1.1 '
  cp -r /tmp/luasrc/* /usr/lib/lua/luci/ && cp -r /tmp/root/* / &&
  rm -f /tmp/luci-indexcache && rm -rf /tmp/luci-modulecache
'
```

语法检查（提交前必跑）：

```bash
find luasrc -name '*.lua' -exec luac -p {} \;
sh -n root/etc/init.d/pcdn-detector
sh -n root/usr/share/pcdn-detector/update.sh
```

有二进制时再验证配置链路：

```bash
tmp="$(mktemp -d)"
pcdn-detect --init-config "$tmp"
pcdn-detect -T -i br-lan -c "$tmp/pcdn-detect.toml"
rm -rf "$tmp"
```

配置编辑、热重载与实时统计的端到端验证，需要路由器上有可用的 `pcdn-detect`；没有二进制时页面
会进入「未安装」状态。

## 改动清单

**改界面文案**：同一 PR 更新 `po/zh-cn/pcdn-detector.po`。

**加 UCI 选项**（如新增一个启动参数）：

1. `root/etc/config/pcdn-detector` 加默认值；
2. `root/etc/init.d/pcdn-detector` 的 `load_options` 读取并拼进启动命令；
3. `model/cbi/pcdn-detector/overview.lua` 加表单项；
4. `docs/usage.md` 的 UCI 选项表同步。

**加页面**：在 `model/cbi/pcdn-detector/` 加 CBI、在 `view/pcdn-detector/` 加模板，并在
`controller/pcdn-detector.lua` 注册菜单与 entry。

**改前端行为**：注意保持「整篇上传 + 后端校验」的模型，不要在前端做配置合并。

## 打包与发布

只在交付安装包时才需要编译：

```bash
./scripts/build-openwrt.sh 24.10 --sdk            # .ipk
./scripts/build-openwrt.sh 25.12 --sdk            # .apk
./scripts/build-openwrt.sh all --sdk             # 两种都编
```

或在 OpenWrt 源码树中 `make package/luci-app-pcdn-detector/compile V=s`。包是 **noarch**，
同一份产物可装在所有架构；架构相关的只有 `pcdn-detect` 二进制。

CI 的 `release.yml` 用矩阵构建 23.05（`.ipk`）与 25.12（`.apk`），收集到同一 Release。
**本仓库没有独立 CI**，合并前靠上面的语法检查与人工验证。

## 常见坑

| 现象 | 原因 |
| --- | --- |
| 菜单不显示 / 页面空白 | 缺 `luci-compat`，或安装后没清 `luci-indexcache` / `luci-modulecache` |
| 保存后名单尾部丢失 | 请求体超过固件上限（已由分片上传解决） |
| 概览页版本显示 `Permission denied` | 旧版缓存未区分 `ctime`，清 `/tmp/pcdn-detect.version` |
| 直连模式不生效 | `listen` 非局域网可达、未设 `token`、或来源未加入 `cors_allowed_origins` |
| HTTPS 下直连被拦 | 浏览器 mixed content，只能走 Lua 代理 |
| 热重载没变化 | 保存时校验未通过（未落盘），或服务未运行（仅保存） |
