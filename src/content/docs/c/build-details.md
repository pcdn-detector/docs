---
title: C 版构建体系详解
description: 依赖、工具链、多架构静态构建、调试符号拆分、产物校验与构建变量。
---

本页是 C 版构建系统的完整说明。快速上手见[编译与交叉编译](/deploy/build/)。

## 依赖

四个库以 **git submodule** 放在 `third_party/`，不依赖系统开发包：

| 库 | 用途 | 许可证 |
| --- | --- | --- |
| [tomlc99](https://github.com/cktan/tomlc99) | TOML 配置解析 | MIT |
| [cJSON](https://github.com/DaveGamble/cJSON) | HTTP API 的 JSON 编解码 | MIT |
| [uthash](https://github.com/troydhanson/uthash) | 检测器 / 封禁状态的哈希表与集合 | BSD-1-Clause |
| [picohttpparser](https://github.com/h2o/picohttpparser) | HTTP/1.1 请求行与请求头解析 | MIT / Perl |

系统库只有 `pthread` 与 Linux 的 `AF_PACKET` + 经典 BPF（内核 API）。

```bash
git submodule update --init --recursive   # 或 make deps
```

**为什么用 submodule**：路由器固件要求可复现的静态构建，submodule 固定到具体 commit，交叉编译时
不需要目标平台有包管理器；四个库都很小、无传递依赖。若团队已有依赖管理流程，也可换成
Conan / vcpkg / Meson WrapDB 中的包，只需保证头文件与源文件路径可被 Makefile 找到。

## 宿主机依赖

| 用途 | 包 | 说明 |
| --- | --- | --- |
| 必需 | C23 编译器、`make`、`git` | gcc 14+ 或 clang 18+（需支持 `-std=c23`）；`git` 只用于拉 submodule |
| 必需 | `binutils`、`file`、`coreutils` | `objcopy`/`strip` 拆符号、`file` 校验产物、`sha256sum` 校验工具链 |
| 必需 | `tar` + `xz` / `gzip` | 解压交叉工具链 |
| 下载 | `curl` 或 `wget` | 工具链与 zig 安装包 |
| 解压兜底 | `7z` 或 `python3` | 老内核缺 `openat2` 时 GNU tar 报 `Function not implemented` |
| 本机静态构建 | musl 工具链（`musl-gcc`） | 仅 `make STATIC=1` 需要 |
| zig 构建 | zig 0.17+、`llvm-objcopy` / `llvm-strip` | 交叉架构拆符号必需（宿主 GNU binutils 只认本机架构） |

```bash
# Fedora
sudo dnf install gcc make git tar xz curl binutils file llvm musl-gcc 7zip
# Debian / Ubuntu（24.04+ 默认源提供 gcc-14；更旧发行版需自行准备新工具链）
sudo apt install gcc-14 make git tar xz-utils curl binutils file llvm musl-tools p7zip-full
# Alpine
sudo apk add build-base make git tar xz curl binutils file llvm python3 p7zip
# Arch
sudo pacman -S --needed base-devel git tar xz curl binutils file llvm musl p7zip
```

:::caution[编译器版本]
Debian 12 / Ubuntu 22.04 自带的 gcc 11 / 12 不支持 `-std=c23`；Ubuntu 24.04 自带的 gcc 13 也只接受
`-std=c2x`。请安装 GCC 14+（或 Clang 18+）；使用 GCC 时用 `make CC=gcc-14`。若只能用 GCC 13，
可把 Makefile 中的 `-std=c23` 改为 `-std=c2x`。
:::

`musl-tools` 只影响 `make STATIC=1`（提供 `musl-gcc`）；跨架构脚本用的是 `.toolchains/` 里的
musl-cross，不需要它。

## 工具链与架构

`make all` / `make <arch>` 使用 PATH 中已有的交叉工具链，候选按顺序取第一个存在的：

| 产物 | 典型目标 | GCC 候选（musl-cross / musl / OpenWrt） |
| --- | --- | --- |
| `pcdn-detect-mipsle` | ramips / mt7621 | `mipsel-linux-muslsf-gcc`、`mipsel-linux-musl-gcc`、`mipsel-openwrt-linux-musl-gcc` |
| `pcdn-detect-mips` | ar71xx / ath79 | `mips-linux-muslsf-gcc`、`mips-linux-musl-gcc`、`mips-openwrt-linux-musl-gcc` |
| `pcdn-detect-armv7` | arm_cortex-a7 / a9 | `armv7l-linux-musleabihf-gcc`、`arm-linux-musleabihf-gcc`、`arm-openwrt-linux-musl-gcc` |
| `pcdn-detect-arm64` | aarch64_cortex-a53 | `aarch64-linux-musl-gcc`、`aarch64-openwrt-linux-musl-gcc` |
| `pcdn-detect-amd64` | x86-64 | `musl-gcc`、`x86_64-linux-musl-gcc`、`cc`（musl 发行版） |

MIPS 24Kc 无 FPU，所以 `mips` / `mipsle` 优先选 soft-float 工具链（`muslsf`）。

覆盖与单架构：

```bash
make all CC_arm64=aarch64-linux-musl-gcc
make arm64 CC_arm64=/opt/musl-cross/bin/aarch64-linux-musl-gcc

# 单架构固定静态，等价于：
make ARCH=arm64 CC=aarch64-linux-musl-gcc STATIC=1
```

架构列表由 `ARCHS := mipsle mips armv7 arm64 amd64` 定义，增删架构改这一行并补 `CC_<arch>` 即可。

## 一键多架构脚本

`script/` 按「编译器 × 链接方式」拆分，产物与目标文件各自隔离，互不覆盖：

| 脚本 | 产物目录 | 说明 |
| --- | --- | --- |
| `script/gcc-static.sh` | `bin/gcc-static/` | musl-cross GCC，全静态 `static-pie` |
| `script/gcc-dynamic.sh` | `bin/gcc-dynamic/` | musl-cross GCC，动态链接 musl |
| `script/zig-static.sh` | `bin/zig-static/` | 官方 zig，全静态 `static-pie`（musl） |
| `script/zig-dynamic.sh` | `bin/zig-dynamic-<glibc\|musl>/` | 官方 zig，动态链接，`--libc` 选 libc |

```bash
./script/gcc-static.sh                    # 全部架构：下载工具链 + 编译
./script/gcc-static.sh -t "arm64 amd64"   # 只做指定架构
./script/gcc-static.sh -j 8               # make 并行度
./script/zig-static.sh                    # zig 全静态
./script/zig-dynamic.sh --libc musl       # zig 动态 + musl
ZIG=/opt/zig/zig ./script/zig-static.sh   # 指定 zig
DEBUG=1 ./script/gcc-static.sh            # 保留完整调试符号
```

- GCC 脚本用 `.toolchains/` 里的 musl-cross（[WomsxdTools/musl-libc-toolchains](https://github.com/WomsxdTools/musl-libc-toolchains)，
  musl 1.2.6 + GCC 15.1.0），缺失时由 `script/toolchain.sh` 下载；单架构约 100MB 下载、
  400MB 解压，缓存可离线复用。
- 工具链单独管理：`./script/toolchain.sh [-t "arm64 amd64"] [--list] [--clean] [--tag <tag>] [--base-url <url>]`。
- zig 可用 `./script/zig.sh [--version 0.17.0|--master|--list|--path|--clean]` 下载官方包到
  `.zig/`，按官方 `index.json` 的 `shasum` 校验；单版本约 57MB 下载、400MB 解压。
  解析顺序：`$ZIG` → `.zig/`（版本号最大）→ `PATH`。
- 下载后按 release 的 `SHA256SUMS` 校验；解压优先 `tar`，失败自动转 7z / python3。

**PIE 探测**：脚本每次都验证 `-static-pie` 是否真的产出 PIE（工具链的 musl 若不是 `-fPIC`
编译，链接会退化成非 PIE），失败自动退回 `PIE=0`（仍全静态，只是没有 ASLR）并提示。
zig 侧 `-static-pie` 必须配合 `-fPIE`，动态 + musl 必须显式 `-dynamic`（zig 对 musl 默认静态），
这些由脚本处理并做产物校验。

## 静态构建

任意普通 Linux 上加 `STATIC=1` 即可产出「拷到任意 Linux 就能跑」的单文件，不需要 OpenWrt SDK：

```bash
make STATIC=1        # 自动选 musl 工具链（musl-gcc / x86_64-linux-musl-gcc / cc）
make STATIC=1 test   # 用同一套 musl 静态工具链跑完整测试
```

**为什么不用 `LDFLAGS=-static` + glibc**：glibc 静态链接时 `getaddrinfo` / NSS 仍要 `dlopen`
加载 NSS 模块，产物在运行期会静默失效，且依赖宿主 `/etc`。musl 的静态 libc 是自洽的：DNS、
`/etc/hosts`、时区、pthread 全部编进 libc。因此 `STATIC=1` 会先探测编译器，发现是 glibc 直接
报错，链接完成后还会校验产物确实是 `statically linked`。

静态产物只依赖内核 ABI（`AF_PACKET` + `TPACKET_V2`，Linux 3.2+），在 glibc 发行版上编译、拷到
musl 路由器运行是正常组合。

## 调试符号与产物

默认发布构建（`DEBUG=0`）：

1. 正常链接带 `-g` 的可执行文件；
2. `objcopy --only-keep-debug` 生成 `bin/pcdn-detect.debug`；
3. `strip --strip-unneeded` 精简主程序；
4. 写入 `.gnu_debuglink`，`gdb ./bin/pcdn-detect` 自动加载同目录的 `.debug`。

`DEBUG=1` 跳过 2~4 步。参考体积（x86-64，`-O2 -g` 后 strip，默认 PIE）：

| 产物 | 大小 | 说明 |
| --- | --- | --- |
| `bin/pcdn-detect` | ≈ 434 KiB | `static-pie linked`，无 `PT_INTERP` |
| `bin/pcdn-detect.debug` | ≈ 1.6 MiB | 调试符号 |
| `PIE=0` 主程序 | ≈ 414 KiB | 普通 `statically linked` |

```bash
file bin/pcdn-detect                       # static-pie linked
readelf -l bin/pcdn-detect | grep INTERP   # 应无输出
readelf -S bin/pcdn-detect | grep debug    # 主程序应无 .debug_* 段
readelf -p .gnu_debuglink bin/pcdn-detect  # 应显示 pcdn-detect.debug
```

## 构建变量

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `DEBUG` | `0` | `1` 保留完整调试符号，不拆分 `.debug` |
| `STATIC` | `0` | `1` 全静态链接，并校验编译器不是 glibc |
| `PIE` | `1` | 动态用 `-pie`，静态用 `-static-pie`（配套 `-fPIE`）；`PIE=0` 关闭 |
| `ARCH` | 空（本机） | 目标架构，决定产物名与默认工具链 |
| `ARCHS` | `mipsle mips armv7 arm64 amd64` | `make all` 的架构列表 |
| `CC_<arch>` | 按候选列表探测 | 各架构交叉工具链，可覆盖 |
| `MUSL_CC` | `musl-gcc` → `x86_64-linux-musl-gcc` → `cc` | 本机静态构建使用的编译器 |
| `KERNEL_HEADERS_DIR` | `/usr/include` | 编译器找不到 `linux/filter.h` 时追加的目录（`-idirafter`，musl 头文件优先） |
| `STRIP_FLAGS` | `--strip-unneeded` | 例如 `--strip-debug` 只删调试段 |
| `VARIANT` | 空 | 产物放 `bin/<variant>/`、中间文件放 `build/<variant>/` |

`DEBUG` / `STATIC` / `PIE` / `ARCH` 变化时会自动重新链接，不同组合的目标文件分目录存放
（`build/local`、`build/static`、`build/<arch>`，`PIE=0` 加 `-nopie` 后缀），来回切换不需要
`make clean`。

## 目标机运行时前提

与 libc 无关，但仍需满足：

- 抓包需 root + `CAP_NET_RAW`，并读取 `/proc`；内核支持 `AF_PACKET` + `TPACKET_V2`（Linux 3.2+）；
- `[log] timezone` 用 IANA 名称时要求目标系统有 `/usr/share/zoneinfo`（Alpine 需 `tzdata`）；
  用 POSIX 偏移写法（`8:00`、`CST-8`）无此依赖；
- `iptables` / `nftables` 后端需要目标系统有对应命令；`hook` 后端无外部依赖。
