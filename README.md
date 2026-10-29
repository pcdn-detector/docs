# pcdn-detector 文档

pcdn-detector 是面向家庭 / 小型网络的 PCDN 检测与阻断工具。本文档站线上地址：
<https://docs.pcdn.dev>。

它提供 Go / C 双实现检测内核与 LuCI 管理面板。

文档覆盖三个仓库：

| 仓库 | 说明 |
| --- | --- |
| [`pcdn-detector`](https://github.com/Womsxd/pcdn-detector) | Go 版检测内核，纯 Go / 无 CGO |
| [`pcdn-detector-c`](https://github.com/Womsxd/pcdn-detector-c) | C23 版检测内核，pthread + AF_PACKET |
| [`luci-app-pcdn-detector`](https://github.com/Womsxd/luci-app-pcdn-detector) | LuCI 管理面板，不含检测二进制 |

本站只包含文档；检测内核与面板的源码、Issue、Release 均在上述仓库维护。

## 技术栈

- [Astro](https://astro.build/) + [Starlight](https://starlight.astro.build/)
- Pagefind 站内搜索
- 静态构建，产物输出到 `dist/`

## 本地开发

建议 Node.js 22.23.4+（以依赖声明的 `engines` 为准）。

```bash
npm ci            # 按 lockfile 安装依赖
npm run dev       # 开发服务器，默认 http://localhost:4321
npm run build     # 生产构建，输出到 dist/
npm run preview   # 预览构建产物
```

`npm run dev` 使用 `astro dev --host`，会同时监听局域网地址，便于在容器或其它设备上预览。

## 目录结构

```text
.
├── public/
│   └── favicon.svg              # 站点图标
├── src/
│   ├── assets/                  # 文档内引用的图片（按需创建）
│   ├── content/
│   │   └── docs/                # 文档正文（Markdown / MDX）
│   │       ├── index.mdx        # 首页
│   │       ├── start/           # 开始使用
│   │       ├── deploy/          # 部署
│   │       ├── config/          # 配置
│   │       ├── features/        # 功能
│   │       ├── luci/            # LuCI 面板
│   │       ├── go/              # Go 实现专区
│   │       ├── c/               # C 实现专区
│   │       ├── dev/             # 开发专区
│   │       └── reference/       # 参考
│   ├── content.config.ts        # 内容集合定义
│   └── styles/custom.css        # 少量站点样式覆盖
├── astro.config.mjs             # 站点、侧边栏、编辑链接等配置
├── package.json
└── tsconfig.json
```

## 新增或修改文档

1. 在 `src/content/docs/<分区>/` 下新建 `.md`（或 `.mdx`）文件，路径即路由。
2. 补全 frontmatter：

   ```yaml
   ---
   title: 页面标题
   description: 一句话说明，用于 SEO 与搜索摘要
   ---
   ```

3. 在 `astro.config.mjs` 的 `sidebar` 中注册页面，否则不会出现在导航里。
4. 站内链接使用**绝对路径并带尾斜杠**，例如 `/config/detect/`；跨页锚点写成
   `/features/firewall/#全-udp-端口封禁`。
5. 图片放到 `src/assets/`，在 Markdown 中用相对路径引用。

## 写作约定

- **以源码为准**：命令、选项、默认值、HTTP 端点、日志文案必须与三个仓库的实际实现一致；
  行为变更时在同一个 PR 更新对应文档。
- **标注实现差异**：涉及 Go / C 差异时写明版本或实现，不要用同一句话覆盖两种行为。
- **配置模板**：`reference/config-template.md` 是整理版模板，实际生成结果以
  `pcdn-detect --init-config` 的输出为准；新增配置项时同步更新该页。
- **链接**：站内链接统一绝对路径，不写相对链接；避免只改文件名不补重定向。
- **术语**：首次出现给全称与简称，例如“全 UDP 端口封禁（全端口封禁）”。

## 相关仓库

- Go 版内核：<https://github.com/Womsxd/pcdn-detector>
- C 版内核：<https://github.com/Womsxd/pcdn-detector-c>
- LuCI 面板：<https://github.com/Womsxd/luci-app-pcdn-detector>
- 本文档站仓库：<https://github.com/pcdn-detector/docs>

## 部署

```bash
npm ci
npm run build
```
