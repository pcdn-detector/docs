---
title: Go 版测试与自检
description: 单元测试、需要权限的实机测试、基准测试与部署后的自检步骤。
---

## 测试范围

| 包 | 覆盖内容 |
| --- | --- |
| `internal/capture` | BPF 生成、`snaplen` 返回值、截断后的头部解析、分片处理、真实内核路径 |
| `internal/detector` | 阈值触发、续期、结束回收、对端上限、端口上限与淘汰、内存占用基准 |
| `internal/config` | 默认值、校验、模板可解析、未知键与类型错误 |
| `internal/filter` | MAC / 端口表达式匹配、名单模式 |
| `internal/firewall` | 命令拼装、专用链参数、`ban_both` 双栈 |
| `internal/blocker` | 引用计数、全端口封禁联动、手动解封 |
| `internal/httpapi` | 路由、鉴权、CORS、分页、各端点返回结构 |
| `internal/minihttp` | 与标准库 `net/http` 的行为差分（状态码、keep-alive、流水线、连接关闭） |
| `internal/state` | PCST v1 读写往返、损坏检测 |

## 跑测试

```bash
# 全量
go test ./...

# 抓包解析（无需权限）
go test ./internal/capture/ -run 'TestBPFSnaplen|TestHandle' -v

# 真实内核路径（需 root / CAP_NET_RAW 与 lo）
go test ./internal/capture/ -run TestSnaplenLive -v

# 检测器单项
go test ./internal/detector/ -run TestDetector -v
```

基准测试用于验证内存优化是否回退：

```bash
go test ./internal/detector/ -run '^$' -bench . -benchtime 3x
```

具体指标解释见[内存与性能细节](/go/memory-details/)。

## 构建自检

```bash
make build
./bin/pcdn-detect -v
```

期望输出形如 `0.0.1-beta.2+<git 短哈希>`。哈希是 SemVer build metadata，直接 `go build` 未注入时
为 `+unknown`。CI 里可用 `make VERSION=... GIT_HASH=... build` 固定版本。

## 配置自检

```bash
# 生成模板（目录须已存在，不覆盖）
mkdir -p /tmp/pcdn-check
./bin/pcdn-detect --init-config /tmp/pcdn-check

# 只校验（含命令行覆盖），0 = 通过
./bin/pcdn-detect -T -i br-lan -c /tmp/pcdn-check/pcdn-detect.toml
```

模板由 `internal/config/template.go` 的 `defaultConfigTemplate` 生成，是配置项的权威说明。
`-T` 与热重载共用同一套校验，因此「`-T` 通过」意味着重载不会因配置非法被拒。

## 部署后自检

1. `pcdn-detect -v` 能输出版本；
2. 启动日志出现「开始监听网卡 …」与「抓包缓冲：frame=…」；
3. `[log] level = "info"` 时能在 `logread -e pcdn-detect` 里看到告警与封禁记录；
4. 启用 HTTP 后 `curl -s localhost:8080/api/v1/health` 返回 `{"status":"ok",...}`；
5. 封禁链路：确认 `iptables -S PCDN_DETECT` 或 `nft list ruleset` 中出现对应条目，
   行为结束后消失。

## 贡献要求

提交 PR 前阅读仓库 `CONTRIBUTING.md`（开发环境、检查项与流程）。完整流程、改动清单与 CI 说明
见[开发总览](/dev/overview/) 与 [Go 内核开发](/dev/go/)。提交即视为同意 `CLA.md`，
且**每个提交需要 `Signed-off-by` 签署行**：

```bash
git commit -s -m "detector: ..."
```
