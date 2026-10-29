---
title: C 版测试与自检
description: make test 的覆盖范围、静态构建测试、产物校验与部署后自检。
---

## 跑测试

```bash
make -j4 && make test      # 构建 + 单元 / HTTP 集成 / CLI 冒烟
make STATIC=1 test         # 用 musl 静态工具链重跑全部测试
```

`make test` 调用 `tests/run.sh`，在真实 HTTP 监听下运行集成测试。测试只能在本机架构上跑
（交叉架构会直接报错）。

## 覆盖范围

| 领域 | 用例 |
| --- | --- |
| 配置解析 | 类型错误、未知键、数组表、端口表达式、CORS / 令牌校验、模板可解析 |
| 黑白名单 | MAC 匹配、端口表达式、模式切换、`enabled` / `full_ban` / `upnp` 标记 |
| 检测器 | 阈值触发、持续告警、结束回收、对端上限、端口上限与淘汰 |
| 状态文件 | PCST v1 读写往返；与 Go 版 `internal/state` **双向兼容**（C 写 → Go 读、Go 写 → C 读） |
| blocker | 引用计数（`ban_both` 合并 v4/v6）、全 UDP 封禁联动、手动解封 |
| hook 后端 | 占位符替换、v4/v6 双发、全端口 / UPnP 参数 |
| iptables / nftables | 命令拼装（用假命令记录 argv，不触碰真实防火墙） |
| HTTP API | 鉴权、CORS 预检、404 / 405 / 503、`/devices` `/device` `/peers` `/dev/memory` `/reload` |
| CLI | `--version`、`--init-config`、`-T` 校验（缺少网卡应失败） |

## 手工自检

```bash
# 版本（形如 0.0.1-beta.2+<git hash>）
./bin/pcdn-detect --version

# 生成模板（目录须存在，不覆盖）
mkdir -p /tmp/pcdn-check
./bin/pcdn-detect --init-config /tmp/pcdn-check

# 只校验配置，0 = 通过
./bin/pcdn-detect -T -i br-lan -c /tmp/pcdn-check/pcdn-detect.toml

# 帮助
./bin/pcdn-detect -h
```

## 产物校验

```bash
file bin/pcdn-detect                       # static-pie linked（或 PIE=0 时 statically linked）
readelf -l bin/pcdn-detect | grep INTERP   # 无输出
readelf -S bin/pcdn-detect | grep debug    # 主程序无 .debug_* 段
readelf -p .gnu_debuglink bin/pcdn-detect  # 显示 pcdn-detect.debug
```

静态产物只依赖内核 ABI，可在本机用 `file` / `readelf` 判断，无需目标机 libc。部署到路由器后：

```bash
scp bin/pcdn-detect root@router:/usr/bin/pcdn-detect
ssh root@router '/usr/bin/pcdn-detect --version'
```

## 部署后自检

1. `--version` 正常输出，且与下载的版本号一致；
2. 启动日志出现「开始监听网卡 …」与「抓包缓冲：frame=…」；
3. `[log] level = "info"` 时 `logread -e pcdn-detect` 能看到告警与封禁记录；
4. 启用 HTTP 后 `curl -s localhost:8080/api/v1/health` 与 `/dev/memory` 正常返回；
5. 封禁链路：确认 `iptables -S PCDN_DETECT` 或 `nft list ruleset` 中出现条目，行为结束后消失。

## 贡献要求

提交 PR 前阅读 `CONTRIBUTING.md`。完整流程与对齐上游的要求见[开发总览](/dev/overview/) 与
[C 内核开发](/dev/c/)。提交即视为同意 `CLA.md`，且**每个提交需要 `Signed-off-by` 签署行**：

```bash
git commit -s -m "capture: ..."
```
