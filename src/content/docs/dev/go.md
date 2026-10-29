---
title: Go 内核开发
description: 环境、代码风格、测试要求、新增配置项的改动清单与调试手段。
---

代码地图与模块职责见 [Go 版实现概览](/go/overview/)，内存结构见
[内存与性能细节](/go/memory-details/)，测试命令见 [Go 版测试与自检](/go/testing/)。

## 环境

需要 Go **1.27.3+**（以 `go.mod` 为准），无需 CGO、libpcap 或 OpenWrt SDK：

```bash
git clone https://github.com/Womsxd/pcdn-detector.git
cd pcdn-detector
make build      # -> bin/pcdn-detect
```

单元测试不需要特权；实机抓包测试需要 root / `CAP_NET_RAW` 与 `lo`。

## 代码风格

| 约定 | 说明 |
| --- | --- |
| 格式 | 必须通过 `gofmt`（CI 会 `gofmt -l` 并在有输出时失败） |
| 注释 | 包与导出符号用中文注释，与 `internal/` 现有代码一致；只在逻辑不自明处写 |
| 分层 | 保持 `internal/<模块>` 的职责划分，**不要把横跨模块的代码堆到 `cmd/pcdn-detect/`** |
| 测试 | 改动行为要在同目录 `*_test.go` 补用例 |
| 文档 | 同步 `README.md`、`docs/` 与 `internal/config/template.go` |

## 新增一个配置项

Go 版的配置项会贯穿多个位置，按这个顺序改最省事：

1. `internal/config/`：结构体字段、默认值、校验规则；
2. `internal/config/template.go` 的 `defaultConfigTemplate`：加注释与默认值（它同时是权威文档）；
3. 使用方（`detector` / `capture` / `firewall` / `httpapi` 等）；
4. 热重载路径：确认该字段在 `POST /api/v1/reload` / `SIGHUP` 的原地应用表里有对应处理，
   否则会出现「改了但没生效」；
5. 测试：配置解析、校验失败分支、热更新后的行为；
6. 文档：`README.md` 的参数/配置表 + 对应 `docs/*.md`。

如果该配置需要暴露给面板或 API，还要同步 `internal/httpapi/` 与 LuCI 的 UCI 默认值
（见 [LuCI 前端开发](/dev/lua/)）。

## 测试要求

```bash
gofmt -l .        # 必须无输出
go vet ./...
go test ./...     # CI 额外跑 -race -count=1
make build        # 改了抓包 / 防火墙 / HTTP 层时另跑 make mipsle
```

- `internal/minihttp` 的改动要跑差分测试，保证与 `net/http` 的状态码、keep-alive、流水线
  行为一致。
- 涉及内存结构的改动，跑 `go test ./internal/detector/ -run '^$' -bench .` 对比
  `RetainedBytesPerPeer` / `RetainedBytesPerIdlePort` 是否回退。

## 调试

| 手段 | 用途 |
| --- | --- |
| `pcdn-detect -T -c <配置>` | 只校验配置，0 = 通过；与热重载共用同一套校验 |
| `--init-config <目录>` | 生成模板，验证模板是否被改坏 |
| `[log] level = "info"` | 看到告警、封禁/解封、UPnP 拦截等业务事件（支持热重载） |
| `-H` / `hide_address` | 分享日志前脱敏设备 MAC / IPv6 / 公网 IPv4 |
| `/api/v1/devices` 的 `port_evictions` / `port_drops` | 判断 `max_ports` 是否生效 |
| `/dev/memory` | 查看 Go 堆、`GOMEMLIMIT`、goroutine 数 |
| `TestSnaplenLive` | 真实内核路径下校验 `CaptureLength == snaplen` |

排查「封禁没生效」时优先把日志开到 `info`，再看 `internal/firewall/` 对应后端的命令拼装。

## 提交前

```bash
gofmt -l . && go vet ./... && go test ./... && make build
git commit -s -m "fix(firewall): ..."
```

CI 会再跑一遍 `-race` 与 `make all`，并校验 `-ldflags` 版本注入后 `-v` 输出符合预期。

## 版本与产物

- `make VERSION=x.y.z GIT_HASH=abc1234 build` 注入版本，`-v` 输出 `x.y.z+abc1234`。
- 发布产物命名固定：`pcdn-detect-mipsle` / `-mips` / `-armv7` / `-arm64` / `-amd64`，
  与 LuCI 的下载逻辑、C 版命名一致。改名前请确认面板的架构映射表。
