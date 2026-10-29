---
title: C 内核开发
description: 环境、与上游 Go 版的对齐要求、代码风格、测试与调试。
---

模块职责见 [C 版实现概览](/c/overview/)，构建系统见 [构建体系详解](/c/build-details/)，
测试覆盖见 [C 版测试与自检](/c/testing/)。

## 环境

```bash
git clone https://github.com/Womsxd/pcdn-detector-c.git
cd pcdn-detector-c
git submodule update --init --recursive   # 或 make deps
make                                      # -> bin/pcdn-detect
make test                                 # 单元 / HTTP / CLI
```

要求 C23 编译器（GCC 14+ / Clang 18+；GCC 13 / Clang 16 需把 Makefile 的 `-std=c23` 改为
`-std=c2x`）。**不要直接改 `third_party/` 下的代码**：修复应提交
上游，或在 `src/` 中封装/规避，保证 submodule 仍可升级。

## 与上游对齐

C 版的行为以 Go 版为基准（仓库根目录的 `UPSTREAM` 记录了对应关系）。提交涉及行为、配置、
HTTP API 或状态文件的改动时，要在 PR 里说明两者如何保持一致：

| 兼容面 | 注意点 |
| --- | --- |
| 配置格式 | 新增字段要同时能被 Go 版解析；`--init-config` 模板必须仍能被 Go 版加载 |
| 命令行 | 短 / 长选项、默认值、数值上限（`200000000`）与 Go 保持一致 |
| HTTP API | 端点、参数、分页语义、错误码一致 |
| 状态文件 | PCST v1（magic / version / CRC32 / 小端记录）**双向互通**；改布局等于破坏兼容 |
| 日志 | 文本与等级一致，面板才能无差别读取 |

## 代码风格

| 约定 | 说明 |
| --- | --- |
| 告警 | C23 在 `-Wall -Wextra` 下不得产生新增告警 |
| 注释 | 中文注释，只在逻辑不自明处写；不要顺手重排无关代码 |
| 分层 | 保持 `src/<模块>.c\|h` 划分，不要把横跨模块的代码堆到 `app.c` |
| 可见性 | 内部辅助函数保持 `static`，跨文件一律走对应头文件 |
| 测试 | 按模块在 `tests/test_core.c` / `test_http.c` / `test_blocker.c` / `test_firewall*.c` 补用例 |

## 新增一个配置项

1. `src/config.c`：结构体、默认值、TOML 映射、校验；
2. `--init-config` 模板（与 Go 的 `defaultConfigTemplate` 对应），确认 Go 版仍可加载；
3. 使用方（`capture` / `detector` / `firewall` / `blocker` / `httpapi`）；
4. 热重载路径（`app.c` 的 reload 编排），确认该字段在原地应用范围内；
5. 测试：解析、非法值、模板往返；
6. 文档：`README.md` + 对应 `docs/*.md`。

## 测试要求

```bash
make clean && make        # 无新增告警
make test                 # 单元 / HTTP 集成 / CLI 冒烟
make STATIC=1             # 改了抓包、防火墙或 HTTP 层时
make STATIC=1 test        # 用 musl 静态工具链重跑
```

CI 会额外用 `gcc-14` 与 `musl-gcc` 各跑一遍测试，并用 `gcc-static.sh`、`zig-static.sh`
构建全架构产物、校验版本注入与「确实静态链接」。

## 调试

```bash
make DEBUG=1                 # 保留完整调试符号（不拆 .debug）
gdb ./bin/pcdn-detect        # 默认构建会通过 .gnu_debuglink 自动加载 .debug

make PIE=0                   # 个别老内核 / 需要固定加载地址时
```

| 手段 | 用途 |
| --- | --- |
| `pcdn-detect -T -c <配置>` | 配置校验，与热重载同一套逻辑 |
| `/dev/memory` 的 `threads` | 观察线程数（HTTP 每连接一线程，最坏 ≈ 并发连接数） |
| `rss_bytes` / `vm_bytes` | 实际内存占用，替代 Go 的堆统计 |
| `file` / `readelf` | 校验产物是否 `static-pie`、符号是否已拆分 |

排查崩溃时注意：旧 blocker / firewall 对象会保留到进程退出，避免并发 HTTP 请求持有悬空指针；
改动这段生命周期要一并考虑 reload 路径。

## 提交前

```bash
make clean && make && make test
git commit -s -m "fix(firewall): ..."
```

若改动涉及交叉编译工具链或 `script/`，同时验证 `./script/gcc-static.sh -t "arm64 amd64"`。
