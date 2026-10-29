// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

// https://astro.build/config
export default defineConfig({
	site: 'https://docs.pcdn.dev',
	integrations: [
		starlight({
			title: 'pcdn-detector 文档',
			description:
				'pcdn-detector 文档：面向家庭网络的 PCDN 检测与阻断工具，在 OpenWrt / Linux 路由器上检测并阻断 PCDN 行为，提供 Go / C 双实现与 LuCI 管理面板。',
			defaultLocale: 'root',
			locales: {
				root: { label: '简体中文', lang: 'zh-CN' },
			},
			lastUpdated: true,
			editLink: {
				baseUrl: 'https://github.com/pcdn-detector/docs/edit/main/',
			},
			favicon: '/favicon.svg',
			customCss: ['./src/styles/custom.css'],
			social: [
				{ icon: 'github', label: 'GitHub', href: 'https://github.com/pcdn-detector/docs' },
			],
			sidebar: [
				{
					label: '开始使用',
					items: [
						{ label: '项目概览', slug: 'start/overview' },
						{ label: '架构与仓库关系', slug: 'start/architecture' },
						{ label: '快速开始', slug: 'start/quickstart' },
					],
				},
				{
					label: '部署',
					items: [
						{ label: '选择后端实现', slug: 'deploy/choose' },
						{ label: '编译与交叉编译', slug: 'deploy/build' },
						{ label: '安装与开机自启', slug: 'deploy/install' },
					],
				},
				{
					label: '配置',
					items: [
						{ label: '配置总览', slug: 'config/overview' },
						{ label: '检测与抓包', slug: 'config/detect' },
						{ label: '内存与性能', slug: 'config/memory' },
						{ label: '黑白名单', slug: 'config/filter' },
						{ label: '日志、时区与隐私', slug: 'config/log' },
					],
				},
				{
					label: '功能',
					items: [
						{ label: '防火墙联动', slug: 'features/firewall' },
						{ label: 'UPnP 拦截', slug: 'features/upnp' },
						{ label: 'HTTP API', slug: 'features/http-api' },
					],
				},
				{
					label: 'LuCI 面板',
					items: [
						{ label: '安装与打包', slug: 'luci/install' },
						{ label: '界面使用与运维', slug: 'luci/usage' },
					],
				},
				{
					label: '实现专区',
					items: [
						{
							label: 'Go 版 pcdn-detector',
							items: [
								{ label: '实现概览', slug: 'go/overview' },
								{ label: '内存与性能细节', slug: 'go/memory-details' },
								{ label: '测试与自检', slug: 'go/testing' },
							],
						},
						{
							label: 'C 版 pcdn-detector-c',
							items: [
								{ label: '实现概览', slug: 'c/overview' },
								{ label: '构建体系详解', slug: 'c/build-details' },
								{ label: '运行时与传输层', slug: 'c/runtime' },
								{ label: '测试与自检', slug: 'c/testing' },
							],
						},
					],
				},
				{
					label: '开发专区',
					items: [
						{ label: '开发总览与贡献流程', slug: 'dev/overview' },
						{ label: 'Go 内核开发', slug: 'dev/go' },
						{ label: 'C 内核开发', slug: 'dev/c' },
						{ label: 'LuCI 前端开发', slug: 'dev/lua' },
					],
				},
				{
					label: '参考',
					items: [
						{ label: '命令行参数', slug: 'reference/cli' },
						{ label: '完整配置模板', slug: 'reference/config-template' },
						{ label: '常见问题', slug: 'reference/faq' },
					],
				},
			],
		}),
	],
	vite: {
		server: {
			// 允许通过 CNB / 容器提供的临时域名访问 dev server（如 *.cnb.run）。
			// 开头的点表示放行该域名及其所有子域，避免每次换前缀都要改配置。
			allowedHosts: true,
		},
	},
});
