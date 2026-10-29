---
title: LuCI 面板安装与打包
description: 兼容性、包格式、随固件编译、本地 SDK 打包与手动安装。
---

## 它是什么

`luci-app-pcdn-detector` 是检测内核的 LuCI 前端，只包含 Lua / HTML / shell 脚本，**不含检测二进制**。
它负责：

- 图形化管理（状态、配置、日志、升级）；
- UCI 配置与 procd 服务脚本；
- 调用 `pcdn-detect -T` 校验配置、发 `SIGHUP` 热重载、通过 HTTP API 读状态。

## 兼容性与包格式

支持官方 OpenWrt（21.02+）、Lean LEDE（含 `luci-compat` 的 LuCI）、ImmortalWrt。

| 构建树 | 包格式 |
| --- | --- |
| 21.02 / 22.03 / 23.05 / 24.10 | `.ipk`（opkg） |
| 25.12+（`CONFIG_USE_APK=y`） | `.apk` |
| Lean LEDE / ImmortalWrt | 由构建树的包管理器决定 |

同一份 `Makefile` 会根据构建树自动产出对应格式，无需分别维护。24.10 的 apk 开关在上游仍标记为
`BROKEN`，写了也会被 `defconfig` 丢弃，因此 24.10 只能产出 `.ipk`。

面板是 **noarch**（`PKGARCH:=all`）：同一份包可装在所有架构上。架构相关的只有 `pcdn-detect`
二进制，由「下载/更新」按设备架构单独获取。

## 依赖

| 依赖 | 说明 |
| --- | --- |
| `luci-base` | LuCI 基础 |
| `luci-compat` | Lua CBI / `luci.model.uci` 兼容层，已写入 `DEPENDS` 自动安装 |
| `curl` 或 `wget` | 下载功能；BusyBox 自带 `wget` 即可 |
| `iptables` 或 `nftables` | 仅启用防火墙联动时需要（由 `pcdn-detect` 调用） |

`Makefile` **没有**把 `pcdn-detect` 写成依赖，因为上游二进制通常不在官方 feed 中。

## 随固件编译

```bash
cd openwrt
git clone https://github.com/Womsxd/luci-app-pcdn-detector.git package/luci-app-pcdn-detector
./scripts/feeds update -a && ./scripts/feeds install -a   # 首次编译时执行
make menuconfig     # LuCI → Applications → luci-app-pcdn-detector
make package/luci-app-pcdn-detector/compile V=s
```

产物：

```bash
# opkg 构建树
bin/packages/<arch>/luci/luci-app-pcdn-detector_*.ipk
# apk 构建树（25.12+）
bin/packages/<arch>/luci/luci-app-pcdn-detector-*.apk
```

noarch 包在部分构建树中会输出到 `bin/packages/<arch>/base/` 而不是 `luci/`。

## 本地打包（无需完整源码树）

仓库自带 `scripts/build-openwrt.sh`：

```bash
./scripts/build-openwrt.sh 25.12 --sdk      # 只编包，最快
./scripts/build-openwrt.sh 23.05 --sdk
./scripts/build-openwrt.sh all --sdk        # 依次编 23.05（ipk）与 25.12（apk）
```

常用参数：

| 参数 | 作用 |
| --- | --- |
| `--sdk` | 使用官方 SDK，跳过 tools / toolchain 编译 |
| `--mirror URL` | 指定 SDK 镜像（`official` / `ustc` / `tencent` / `tencent-intra` 或自定义 URL） |
| `--fallback URL` | 显式指定备用镜像；默认不回退 |
| `--update` | 更新源码树 / feeds；默认复用已有内容 |
| `--jobs N` | 并行任务数 |
| `--clean` | 删除对应源码树 / SDK 后重新下载 |

- 产物复制到 `dist/openwrt-<version>/`，并生成 `SHA256SUMS`。
- 构建目标固定 `x86/64`；面板是 noarch，产物可安装到任意架构。
- `--sdk` 首次会下载约 100–250MB SDK，建议预留 10GiB 以上磁盘；完整源码模式建议 20GiB+。
- 包格式由构建树决定：`21.02`–`24.10` 产出 `.ipk`，`25.12+` 产出 `.apk`，`all` 两种都编。
- `--mirror` 只影响 SDK 下载；完整源码模式请用 `OPENWRT_GIT_URL` 指定 git 镜像。
- 更新 feeds 需要 Perl 的 `FindBin`（Fedora：`dnf install perl-FindBin`）。

编译依赖（Fedora / Debian / Ubuntu / Arch 的完整清单见仓库 `docs/build.md`）：`git`、`make`、
GCC、`ncurses` 开发包、`gettext`、`python3`、Perl 若干模块、`rsync`、`patch`、`unzip`、
`xz`、`zstd`、`7zip`（受限容器里 `tar` 报 `Function not implemented` 时必需）、`cmake`、`ninja`。

## 手动安装到路由器

```bash
scp -r luasrc root /tmp/
ssh root@192.168.1.1 '
  cp -r /tmp/luasrc/* /usr/lib/lua/luci/ &&
  cp -r /tmp/root/* / &&
  chmod +x /etc/init.d/pcdn-detector /etc/uci-defaults/40_luci-pcdn-detector /usr/share/pcdn-detector/update.sh &&
  /etc/init.d/pcdn-detector enable &&
  rm -f /tmp/luci-indexcache && rm -rf /tmp/luci-modulecache
'
```

手动安装前确认 `luci-compat`：

```bash
opkg install luci-compat     # ipk / opkg
apk add luci-compat          # apk（25.12+）
```

## 安装检测二进制

两种方式：

1. 面板内：**服务 → PCDN 检测 → 下载/更新**，按设备架构安装（推荐）。
2. 手动：

   ```bash
   scp bin/pcdn-detect-mipsle root@192.168.1.1:/usr/bin/pcdn-detect
   ssh root@192.168.1.1 'chmod +x /usr/bin/pcdn-detect && /usr/bin/pcdn-detect -v'
   ```

## 首次初始化

1. 打开 **服务 → PCDN 检测 → 概览**，确认「程序路径」下有可执行文件。
2. 进入 **配置编辑**，确认 `[capture] interface` 是 LAN 侧网桥（默认 `br-lan`）后保存。
3. 回概览点「启动」，在「日志」页查看告警。

首次打开配置页时配置可能还不存在，页面会调用 `pcdn-detect --init-config` 生成默认文本，校验通过
后写入 `config_path`（默认 `/etc/pcdn-detect/pcdn-detect.toml`）。此过程**要求二进制已安装**。

## 开发校验

只改 Lua / HTML 时不必每次打包，直接覆盖 `luasrc` 与 `root` 到路由器并清一次 LuCI 缓存即可。
目录职责、保存链路约定与改动清单见 [LuCI 前端开发](/dev/lua/)。

```bash
# Lua 语法
find luasrc -name '*.lua' -exec luac -p {} \;

# shell 语法
sh -n root/etc/init.d/pcdn-detector
sh -n root/usr/share/pcdn-detector/update.sh

# 用真实二进制验证模板与校验链路
tmp="$(mktemp -d)"
pcdn-detect --init-config "$tmp"
pcdn-detect -T -i br-lan -c "$tmp/pcdn-detect.toml"
rm -rf "$tmp"
```
