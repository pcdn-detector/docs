---
title: 编译与交叉编译
description: 从源码构建 Go 版与 C 版检测二进制，包括 OpenWrt 交叉编译与静态链接。
---

## 产物命名

两个实现的产物名完全一致，LuCI 的「下载/更新」也按这套名字推导地址：

| 架构（`opkg print-architecture`） | 产物名 | Go 目标 | C 目标 |
| --- | --- | --- | --- |
| `mipsel_24kc` / `mipsel_*` | `pcdn-detect-mipsle` | `make mipsle` | `make mipsle` |
| `mips_24kc` / `mips_*` | `pcdn-detect-mips` | `make mips` | `make mips` |
| `arm_*`（armv7，如 `arm_cortex-a7`） | `pcdn-detect-armv7` | `make arm` | `make armv7` |
| `aarch64_*` | `pcdn-detect-arm64` | `make arm64` | `make arm64` |
| `x86_64` | `pcdn-detect-amd64` | `make amd64` | `make amd64` |

不确定架构时：

```bash
cat /proc/cpuinfo
uname -m
opkg print-architecture     # opkg 系统
apk --print-arch            # apk 系统（25.12+）
```

## Go 版

需要 **Go 1.27.3+**（以 `go.mod` 为准）。

```bash
# 本机架构
make build

# OpenWrt 常见架构（产物落在 bin/）
make mipsle     # ramips / mt7621
make mips       # ar71xx / ath79
make arm        # armv7
make arm64      # armv8 / aarch64
make amd64

# 一次全编
make all

# 自定义版本号 / 覆盖 git 短哈希
make VERSION=0.0.2 build
make GIT_HASH=dev build
```

- 构建参数：`CGO_ENABLED=0`、`-trimpath`、`-ldflags "-s -w -buildid="`，即**纯静态、无 CGO**。
- 版本通过 `-ldflags "-X main.baseVersion=... -X main.gitHash=..."` 注入。`-v` 输出形如
  `0.0.1-beta.2+<git 短哈希>`，哈希作为 SemVer build metadata；直接 `go build` 未注入时显示
  `+unknown`。
- 清理：`make clean`。

## C 版

需要支持 **C23** 的编译器（GCC 14+ / Clang 18+）。使用更旧的版本（如 GCC 13 / Clang 16）时，
需把 Makefile 中的 `-std=c23` 改为 `-std=c2x`。依赖以 **git submodule** 放在 `third_party/`：

```bash
git submodule update --init --recursive   # 或 make deps

make                        # 本机构建 → bin/pcdn-detect
make -j4 && make test       # 构建 + 单元 / HTTP / CLI 测试
make STATIC=1               # Musl 全静态，可拷到任意 Linux 直接运行
make all                    # 多架构静态产物 bin/pcdn-detect-<arch>
make DEBUG=1                # 保留完整调试符号
make PIE=0                  # 关闭 PIE（默认开启）
make clean                  # 清理 build/ 与 bin/
```

单架构交叉编译用 `make <arch>`（`mipsle` / `mips` / `armv7` / `arm64` / `amd64`）。工具链按
「musl.cc / Alpine / OpenWrt」三种候选命名自动探测，找不到会提示而不是静默失败；也可显式覆盖：

```bash
make all CC_arm64=aarch64-linux-musl-gcc
```

`script/` 下提供组合好工具链的一键脚本：

```bash
./script/gcc-static.sh                    # 全架构静态（自动准备交叉工具链）
./script/zig-static.sh                    # 同上，改用官方 zig
./script/zig-dynamic.sh --libc musl       # zig 动态链接，可选 glibc / musl
```

:::caution[静态链接与 glibc]
`STATIC=1` 要求 musl 工具链。用 glibc 编译器做全静态会产出「能编译、运行期失灵」（DNS、时区、
pthread 等）的二进制，因此构建脚本检测到 glibc 会直接报错，并在链接后校验产物确实是
`statically linked`。
:::

静态产物只依赖内核 ABI（`AF_PACKET` + `TPACKET_V2`，Linux 3.2+），在 glibc 发行版上编译后拷到
musl 路由器上运行是正常的组合。

C 版的依赖、调试符号拆分、交叉工具链细节与产物校验见仓库 `docs/build.md`。

## 需要哪些系统能力

| 能力 | 说明 |
| --- | --- |
| `CAP_NET_RAW` | 抓包必需，通常意味着 root 运行 |
| `/proc` 可读 | C 版在无权限时直接报错退出 |
| 防火墙后端命令 | 仅启用防火墙联动时需要：`iptables` 后端需 `iptables`（可选 `ip6tables`），`nftables` 后端需 `nft`；缺失时启动检查会报错（`ip6tables` 例外：只告警并忽略 IPv6） |
| nftables 内核支持集合 timeout（约 4.8+） | 仅启用 `ban_ttl` 时需要 |

## 运行时校验

```bash
./bin/pcdn-detect -v                      # 版本与构建号
./bin/pcdn-detect -T -c /path/config.toml # 只校验配置，0 = 通过
./bin/pcdn-detect --init-config /etc/pcdn-detect   # 生成默认模板（目录须已存在）
```

`--init-config` 不覆盖已有文件，也不在当前目录留副本；它**不加载**配置，生成后即退出。
