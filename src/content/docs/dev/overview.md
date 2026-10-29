---
title: 开发总览与贡献流程
description: 三个仓库的环境要求、提交前检查、CI 流水线与文档同步约定。
---

本专区面向要给三个仓库提交代码的开发者。只想部署使用时，看[快速开始](/start/quickstart/)即可。

## 三个仓库的开发栈

| 仓库 | 语言 / 工具链 | 依赖管理 | 最低版本依据 |
| --- | --- | --- | --- |
| `pcdn-detector` | Go，`CGO_ENABLED=0` | Go modules | `go.mod` 声明 **1.27.3** |
| `pcdn-detector-c` | C23，GCC 14+ / Clang 18+ | git submodule（`third_party/`） | 编译器需支持 `-std=c23` |
| `luci-app-pcdn-detector` | Lua / LuCI / shell | 随 OpenWrt 源码树 | OpenWrt 21.02+ 或含 `luci-compat` 的 LEDE |

三个仓库都不需要 libpcap：抓包分别基于 `AF_PACKET` + TPACKET_V3（Go）与 TPACKET_V2（C）。

:::note[Go 版本以 go.mod 为准]
Go 版最低要求为 `go.mod` 声明的 **1.27.3**，CI 使用 `go-version-file: go.mod`。
:::

## 通用流程

1. **Fork 并从默认分支建分支**（Go / C 仓库默认分支为 `master`），命名如
   `fix/nftables-timeout`、`feat/upnp-whitelist`。
2. **一个 PR 只做一件事**，保持改动聚焦。
3. **每个提交都要有 `Signed-off-by`**（DCO），用 `git commit -s` 自动添加；漏了可
   `git rebase --signoff master` 补。
4. **PR 即视为同意 CLA**（`CLA.md`），无需单独签署文件；不满足 CLA 的 PR 不会合并。
5. **Commit / PR 标题用 Conventional Commits**：`feat:`、`fix:`、`docs:`、`refactor:`、
   `test:`、`ci:`、`chore:`，可带作用域（`fix(firewall): …`）。
6. **关联 issue**（`Fixes #123`），并在 PR 描述里说明「改了什么、为什么」。

## 提交前检查对照

| 仓库 | 必跑命令 |
| --- | --- |
| Go | `gofmt -l .`（无输出）、`go vet ./...`、`go test ./...`、`make build` |
| C | `make clean && make`（无新增告警）、`make test`、`make STATIC=1`（改了抓包/防火墙/HTTP） |
| LuCI | `find luasrc -name '*.lua' -exec luac -p {} \;`、`sh -n` 两个脚本 |

单元测试都不需要 root、真实网卡或运行中的防火墙；只有实机抓包测试例外。

## CI 流水线

| 仓库 | CI 做的事 |
| --- | --- |
| Go `ci.yml` | `gofmt -l` 检查、`go vet`、`go test -race -count=1 ./...`；另一 job 跑 `make all` 全架构交叉编译并校验版本注入 |
| Go `release.yml` | 解析版本 → 全架构构建 → 生成 `SHA256SUMS` → 上传产物 → 建 tag 与 GitHub Release |
| C `ci.yml` | `gcc-14` 本机测试 + `musl-gcc` 全静态测试；`gcc-static.sh` 与 `zig-static.sh` 全架构构建，校验版本注入与「确实静态链接」 |
| C `release.yml` | 同 Go：多架构产物 + 校验 + Release |
| LuCI `release.yml` | 矩阵构建（23.05 → `.ipk`、25.12 → `.apk`）→ 收集包 → 建 tag 与 Release |
| LuCI | **没有独立 CI**：前端只有 Lua / HTML / shell，合并前靠人工按上面的检查命令自检 |

## 文档同步约定（三个仓库共通）

改动影响用户可见行为时，文档必须一起改，且**只能描述代码实际做了什么**：

| 仓库 | 需要同步的位置 |
| --- | --- |
| Go | `README.md`（选项与默认值）、`docs/`（`memory` / `filter` / `firewall` / `upnp` / `http`）、`internal/config/template.go` 的默认模板 |
| C | `README.md`、`docs/` 同上一组、`--init-config` 生成的模板；**模板必须仍能被 Go 版加载** |
| LuCI | `README.md`、`docs/`（`install` / `build` / `usage` / `http-api` / `update` / `faq` / `development`）、`po/zh-cn/pcdn-detector.po` |

新增配置项时最容易漏的是**默认配置模板**：它同时是配置项的权威说明，C 版还要求与 Go 版互相
可加载。测试里通常会有「模板可解析」用例兜底。

## 报告问题

提交 issue 时提供：

- 版本（`pcdn-detect -v`，面板问题另加 LuCI 包版本）；
- OpenWrt / 发行版版本与架构（`cat /proc/cpuinfo`、`opkg print-architecture` 或 `apk --print-arch`）；
- C 版另需编译器与 libc（glibc / musl，静态或动态）；
- 抓包网卡、防火墙后端（`hook` / `iptables` / `nftables`）、所用浏览器（面板问题）；
- 复现步骤与日志，建议 `[log] level = "info"`。

:::caution[日志脱敏]
粘贴日志前隐去 MAC 与公网 IP，或用 `-H` / `--hide-address` 运行。安全漏洞不要开公开 issue。
:::
