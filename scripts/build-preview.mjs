/**
 * 生成「分类图标预览」静态页（零 JavaScript）。
 *
 * 为什么是零 JS：之前这页靠内联 <script> 在浏览器里渲染，部分预览环境
 * （WebView / 面板内嵌）不执行内联脚本，结果所有格子都是空灰块。
 * 现在改成构建期就把 4 档风格 × 31 项 × 4 尺寸全部渲染成 SVG 内联进 HTML，
 * 风格切换改用纯 CSS 的 radio + :checked 兄弟选择器，不依赖任何脚本。
 *
 * 用法：node scripts/build-preview.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { catMarkHTML } from '../js/caticon.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * 解析默认分类清单：直接读 js/store.js（App 侧唯一数据源），
 * 避免依赖本脚本自己产出的 HTML —— 否则第二次运行就解析不到东西了。
 */
function parseItems() {
  const src = readFileSync(join(root, 'js/store.js'), 'utf8');
  const block = (name) => {
    const i = src.indexOf(`const ${name} = [`);
    if (i < 0) throw new Error(`store.js 里找不到 ${name}`);
    const j = src.indexOf('\n];', i);
    return src.slice(i, j);
  };
  const cat = (name, type) => {
    const out = [];
    const re = /\['([^']+)',\s*'([^']*)',\s*'(#[0-9a-fA-F]{6})'/g;
    let m;
    while ((m = re.exec(block(name)))) out.push({ name: m[1], icon: m[2], color: m[3], kind: '', type });
    return out;
  };
  // 账户：acc('名字','emoji','#色','type'
  const accs = [];
  const are = /acc\('([^']+)',\s*'[^']*',\s*'(#[0-9a-fA-F]{6})',\s*'([^']+)'/g;
  let a;
  while ((a = are.exec(src))) accs.push({ name: a[1], icon: '', color: a[2], kind: a[3] });

  return [
    { title: '支出', items: cat('EXPENSE', 'expense') },
    { title: '收入', items: cat('INCOME', 'income') },
    { title: '账户 / 转账', items: [...accs, { name: '转账', icon: '🔄', color: '#0a84ff', kind: 'transfer', type: '' }] },
    // 库里没有的分类 → 应降级成首字
    { title: '自定义分类（降级首字）', items: [
      { name: '自定义分类', icon: '', color: '#98989f', kind: '', type: 'expense' },
      { name: 'Coffee', icon: '', color: '#0a84ff', kind: '', type: 'expense' },
    ] },
  ];
}

const SIZES = [
  { px: 52, r: 26 },
  { px: 38, r: 19 },
  { px: 26, r: 8 },
  { px: 18, r: 5 },
];

const STYLES = [
  { key: 'line', label: '线性' },
  { key: 'filled', label: '实心' },
  { key: 'tint', label: '统一彩底' },
  { key: 'illust', label: '彩色插画' },
  { key: 'emoji', label: 'Emoji 圆底' },
];

const groups = parseItems();
const total = groups.reduce((n, g) => n + g.items.length, 0);
if (total === 0) throw new Error('解析不到分类条目，检查 docs/分类图标预览.html');

/** catMarkHTML 生成的 <span> 里要么是 <svg>，要么是 emoji 文本（emoji 档） */
const render = (o) => {
  const span = catMarkHTML(o);
  const svg = /<svg[\s\S]*?<\/svg>/.exec(span);
  if (svg) return { kind: 'svg', html: svg[0] };
  const inner = /^<span[^>]*>([\s\S]*?)<\/span>$/.exec(span);
  return { kind: 'text', html: inner ? inner[1] : '' };
};

/** 每个分类每档风格只渲染一次 SVG，4 个尺寸列复用（减少约 75% 体积） */
const defs = [];
let sid = 0;
const skinOf = (k) => (k === 'emoji' ? 'ic-emoji' : k === 'illust' ? 'ic-illust' : k === 'tint' ? 'ic-tint' : k === 'filled' ? 'ic-fill' : 'ic-line');

const panels = STYLES.map((st) => {
  const rows = groups.map((g) => {
    const items = g.items.map((it) => {
      const id = 'i' + sid++;
      const r = render({ name: it.name, color: it.color, kind: it.kind, icon: it.icon, type: it.type || '', style: st.key });
      if (!r.html) return '';
      let body;
      if (r.kind === 'svg') {
        // <svg viewBox="..." attr>inner</svg>  ->  <symbol id viewBox="..." attr>inner</symbol>
        defs.push(r.html.replace(/^<svg/, `<symbol id="${id}"`).replace(/<\/svg>$/, '</symbol>'));
        body = `<svg viewBox="0 0 24 24"><use href="#${id}"/></svg>`;
      } else {
        body = `<span class="em">${r.html}</span>`;
      }
      const cells = SIZES.map((sz) =>
        `<div class="mk ${skinOf(st.key)}" style="--c:${it.color};width:${sz.px}px;height:${sz.px}px;border-radius:${sz.r}px">${body}</div>`
      ).join('');
      return `<div class="row"><b>${it.name}</b>${cells}</div>`;
    }).join('');
    return `<h2>${g.title}</h2>${items}`;
  }).join('');
  return `<section class="panel" id="p-${st.key}">${rows}</section>`;
}).join('\n');

// input 必须是 body 的顶层子元素，才能和 .panel 构成兄弟关系用 `~` 控制显示
const inputs = STYLES.map((st, i) =>
  `<input type="radio" name="st" id="s-${st.key}"${i === 0 ? ' checked' : ''}>`
).join('');
const tabs = STYLES.map((st) =>
  `<label for="s-${st.key}">${st.label}</label>`
).join('');

const showRules = STYLES.map((st) => `#s-${st.key}:checked ~ #p-${st.key}{display:block}`).join('\n');
const tabRules = STYLES.map((st) => `#s-${st.key}:checked ~ .tabs label[for="s-${st.key}"]{background:#0a84ff;color:#fff;border-color:#0a84ff}`).join('\n');

const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>分类图标预览（四档风格）</title>
<style>
*{box-sizing:border-box}
body{background:#08080a;color:#e9e9ec;font:14px/1.5 -apple-system,"PingFang SC",sans-serif;margin:0;padding:24px}
h1{font-size:15px;font-weight:500;margin:0 0 4px}
p.note{font-size:12px;color:#636366;margin:0 0 12px;max-width:760px}
h2{font-size:14px;font-weight:500;color:#98989f;margin:22px 0 10px}
.row{display:grid;grid-template-columns:76px repeat(4,1fr);align-items:center;gap:12px;padding:8px 10px;border-radius:10px}
.row:nth-child(odd){background:#161618}
.row b{font-weight:500}
.cell{display:flex;align-items:center;gap:8px}
.mk{background:#2c2c2e;display:flex;align-items:center;justify-content:center;flex:0 0 auto}
.mk svg{width:62%;height:62%;stroke-width:2}
.mk.ic-fill svg{width:56%;height:56%;stroke:none}
.mk.ic-illust svg{width:60%;height:60%;stroke:none}
.mk.ic-illust{background:color-mix(in srgb,var(--c,#98989f) 16%,#f2f2f7)}
.mk.ic-emoji{background:color-mix(in srgb,var(--c,#98989f) 22%,#1c1c1e)}
.mk.ic-tint{background:#0a84ff}
.mk.ic-tint svg{width:56%;height:56%;stroke:none;color:#fff}
.mk .em{line-height:1}
.row>.mk:nth-child(2) .em{font-size:32px}
.row>.mk:nth-child(3) .em{font-size:23px}
.row>.mk:nth-child(4) .em{font-size:15px}
.row>.mk:nth-child(5) .em{font-size:11px}
.defs{position:absolute;width:0;height:0;overflow:hidden}
/* 纯 CSS 风格切换：不依赖任何 JavaScript */
.tabs{display:flex;gap:8px;margin:10px 0 14px;flex-wrap:wrap}
.tabs label{background:#1c1c1e;color:#98989f;border:1px solid #2c2c2e;border-radius:8px;padding:5px 14px;font-size:13px;cursor:pointer;user-select:none}
body>input[name="st"]{position:absolute;opacity:0;pointer-events:none}
.panel{display:none}
${showRules}
${tabRules}
</style>
${inputs}
<h1>分类图标预览</h1>
<div class="tabs">${tabs}</div>
<p class="note">图标来源：Tabler Icons v3.49.0 outline + filled（MIT）、Fluent Emoji Flat（Microsoft，MIT）。四列分别为 52 / 38 / 26 / 18 px 容器。纯静态页面，不含 JavaScript。</p>
<svg class="defs" xmlns="http://www.w3.org/2000/svg">${defs.join('')}</svg>
${panels}
`;

const out = join(root, 'docs/分类图标预览.html');
writeFileSync(out, html, 'utf8');
console.log(`OK  ${total} 项 × ${STYLES.length} 档  ->  docs/分类图标预览.html`);
console.log(`    symbol ${defs.length} 个，页面 ${(html.length / 1024).toFixed(1)} KB`);
