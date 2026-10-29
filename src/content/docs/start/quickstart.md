---
title: 快速开始
description: 十分钟内在 OpenWrt 路由器上跑通 PCDN 检测，或纯命令行方式运行。
---

## 前置条件

- 一台 OpenWrt 21.02+ / Lean LEDE / ImmortalWrt 或普通 Linux 路由器，**root 权限**
  （抓包需要 `CAP_NET_RAW`）。
- 一个**能看到设备真实 MAC 的 LAN 侧网桥接口**，通常是 `br-lan`。用 `ip link` 或
  `uci get network.lan.device` 确认。
- 知道设备架构，用于选二进制：

  ```bash
  opkg print-architecture      # opkg 系统，如 mipsel_24kc
  apk --print-arch             # apk 系统（25.12+）
  uname -m                     # 兜底
  ```

## 路线 A：用 LuCI 面板（推荐）

适合已经在用 OpenWrt 的用户：后续改配置、看日志、升级二进制都可以在网页上完成。

1. **安装面板**（随固件编译，或本地打包后安装）：

   ```bash
   cd openwrt
   git clone https://github.com/Womsxd/luci-app-pcdn-detector.git package/luci-app-pcdn-detector
   ./scripts/feeds update -a && ./scripts/feeds install -a
   make menuconfig            # LuCI → Applications → luci-app-pcdn-detector
   make package/luci-app-pcdn-detector/compile V=s
   ```

   产物在 `bin/packages/<arch>/`（`.ipk` 或 `.apk`，由构建树决定）。手动机器安装步骤见
   [安装与打包](/luci/install/)。

2. **安装检测二进制**：进入 **服务 → PCDN 检测 → 下载/更新**，选择「更新源」（GitHub / CNB）
   与「版本」（Go / C），点安装。或手动上传：

   ```bash
   scp pcdn-detect-mipsle root@192.168.1.1:/usr/bin/pcdn-detect
   ssh root@192.168.1.1 'chmod +x /usr/bin/pcdn-detect && /usr/bin/pcdn-detect -v'
   ```

3. **初始化并启动**：
   - **概览**页确认「程序路径」下有可执行文件；
   - **配置编辑**页确认 `[capture] interface = "br-lan"`，按需调整阈值后保存（保存前会自动
     `pcdn-detect -T` 校验，失败不写盘）；
   - 回到概览点「启动」，再到**日志**页观察告警。

   想同时看到告警与解封记录，先把 `[log] level` 改成 `info`（默认 `warn` 只输出警告与错误）。

## 路线 B：纯命令行

适合没有 LuCI 的 Linux 路由器，或想先验证效果。

1. **准备二进制**：从仓库 Release / CI 下载对应架构的文件，或自行编译（见
   [编译与交叉编译](/deploy/build/)）。

   ```bash
   scp bin/pcdn-detect-mipsle root@192.168.1.1:/usr/bin/pcdn-detect
   ssh root@192.168.1.1 'chmod +x /usr/bin/pcdn-detect'
   ```

2. **生成并校验配置**：

   ```bash
   mkdir -p /etc/pcdn-detect
   pcdn-detect --init-config /etc/pcdn-detect      # 生成默认模板，不覆盖已有文件
   vi /etc/pcdn-detect/pcdn-detect.toml            # 至少填 [capture] interface
   pcdn-detect -T -c /etc/pcdn-detect/pcdn-detect.toml   # 通过返回 0
   ```

3. **前台试跑**（观察几分钟再转后台）：

   ```bash
   pcdn-detect -c /etc/pcdn-detect/pcdn-detect.toml -i br-lan -n 20 -t 60s
   ```

   含义：监听 `br-lan`，60 秒内某设备同一端口出现 20 个不同远端公网 IP 即告警。

4. **转为常驻服务**：按 [安装与开机自启](/deploy/install/) 配置 procd 脚本。

## 首次运行检查清单

| 检查项 | 期望结果 |
| --- | --- |
| `pcdn-detect -v` | 输出 `0.0.1-beta.2+<git 短哈希>` 之类的版本号 |
| `pcdn-detect -T -c <配置>` | 返回 0，无报错 |
| 启动日志（`level = "info"`） | 出现「开始监听网卡 br-lan：触发阈值=20，时长=1m0s…」 |
| 有设备跑 PCDN 时 | 出现「疑似产生PCDN行为」，并列出相关 IP |
| 启用防火墙后 | 出现「已封禁 …」，行为结束后「已解封 …」 |

:::tip[阈值怎么定]
默认 `threshold = 20` / `window = 60s` 适合普通家庭网络。误报多就调高阈值或延长窗口；漏检就
反向调整。建议先只开日志观察一两天，再启用自动封禁。
:::

## 下一步

- 需要自动封禁：[防火墙联动](/features/firewall/)
- 只想监测特定设备：[黑白名单](/config/filter/)
- 内存吃紧：[内存与性能](/config/memory/)
- 想让面板显示实时统计：[HTTP API](/features/http-api/)
