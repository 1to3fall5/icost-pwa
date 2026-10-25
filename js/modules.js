// 模块清单 —— 单一数据源
//
// sw.js（离线预缓存）与 scripts/bundle.py（单文件打包）都从这里读，
// 新增 / 删除 JS 模块只改这一处，两边自动跟上。
// scripts/module-test.mjs 会校验这份清单与磁盘实际文件是否一致，漏改会被测试拦下。
//
// JS_CORE     js/ 下的核心模块
// PAGE_NAMES  js/pages/ 下的模块名（不含 .js）
// SHELL_EXTRA 非 JS 的离线资源（入口 / 样式 / manifest / 图标）

export const JS_CORE = [
  './js/app.js',
  './js/util.js',
  './js/store.js',
  './js/icons.js',
  './js/caticon.js',
  './js/seticon.js',
  './js/uiicon.js',
  './js/charts.js',
  './js/sync.js',
  './js/importers.js',
  './js/treemap.js',
  './js/dashboard.js',
];

export const PAGE_NAMES = [
  'home', 'asset', 'save', 'stats', 'record', 'calendar', 'search', 'detail',
  'settings', 'category', 'budget', 'books', 'templates', 'recurring', 'claim',
  'loan', 'assetdetail', 'savedetail', 'statsdetail', 'importexport', 'importcsv',
  'syncjoin', 'more',
  'index',   // 路由注册表，app.js 动态 import 它
];

export const SHELL_EXTRA = [
  './',
  './index.html',
  './manifest.json',
  './css/style.css',
  './assets/icon-192.png',
  './assets/icon-512.png',
  './assets/icon-maskable-512.png',
  './assets/icon-180.png',
];

export const PAGE_MODULES = PAGE_NAMES.map((p) => `./js/pages/${p}.js`);
export const PRECACHE = [...SHELL_EXTRA, ...JS_CORE, ...PAGE_MODULES];
