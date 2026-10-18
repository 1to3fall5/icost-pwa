# iCost 记账 PWA（复刻版）

iOS/Android 记账 App「iCost」的纯前端复刻实现，可作为 PWA 安装到桌面/主屏并离线使用。

## 特性

- 暗黑主题优先（设置里可切浅色），底部 TabBar 为毛玻璃（backdrop-filter）
- 21 个页面：账本 / 资产 / 存钱 / 统计 / 记账 / 日历 / 搜索 / 明细 / 设置 / 分类 / 预算 / 账本管理 / 模板 / 周期账单 / 报销 / 借贷 / 资产明细 / 存钱明细 / 统计明细 / 导入导出 / 更多
- Service Worker 离线缓存（HTML network-first，静态资源 stale-while-revalidate）
- 零依赖、零构建：原生 HTML + CSS + ES Modules，Canvas 手绘图表，内联 SVG 图标
- 数据存 localStorage，无后端、无会员墙

## 部署（GitHub Pages）

两种方式二选一：

**A. 分支部署（最简单）**
Settings → Pages → Build and deployment → Source: `Deploy from a branch` → Branch `main` / Folder `/ (root)` → Save。

**B. Actions 部署**
Settings → Pages → Source: `GitHub Actions`，然后 push 即触发 `.github/workflows/pages.yml`。

> 注意：私有仓库的 GitHub Pages 需要 Pro/Team/Enterprise 计划。免费账号请使用公开仓库。
> Pages 站点本身无论如何都是公开可访问的（即使源码仓库是私有）。

站点地址：`https://<owner>.github.io/<repo>/`
（本项目全部使用相对路径，放在子路径下也能正常工作。）

## 本地预览

```bash
python -m http.server 8080
# 打开 http://localhost:8080
```

Service Worker 只在 https 或 localhost 下生效。

## 结构

```
index.html          入口（含 iOS 全屏 meta / manifest 链接）
manifest.json       PWA 清单（standalone / maskable icon）
sw.js               Service Worker
css/style.css       设计系统 + 全部组件样式
js/app.js           路由 / 导航 / TabBar / UI 工具
js/store.js         localStorage 数据层（含 XSS 净化）
js/charts.js        Canvas 图表（环图 / 柱图 / 折线 / 排行）
js/icons.js         内联 SVG 图标集
js/pages/*.js       21 个页面模块
assets/             PWA 图标（192 / 512 / 512-maskable / 180 / 1024）
```
