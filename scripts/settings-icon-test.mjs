// UI 图标测试：界面图标必须统一彩底 + 白色 SVG，不能退回彩色 emoji
// 跑法：node scripts/settings-icon-test.mjs
// 只引 js/seticon.js（无 DOM 依赖），settings.js 只做源码静态检查
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { setIconHTML } from '../js/seticon.js';
import { hasIcon, uiIcon, uiMark } from '../js/uiicon.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(join(root, 'js/pages/settings.js'), 'utf8');

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('OK  ', name); }
  else { fail++; console.log('FAIL', name, extra); }
};
const eq = (name, a, b) => ok(name, a === b, `got=${JSON.stringify(a)} want=${JSON.stringify(b)}`);

// 1) 不再有「emoji + 各自底色」的写法（旧格式：icon: '⚡', bg: 'rgba(...)'）
const legacy = src.match(/icon: '[^']*', bg: '[^']*'/g) || [];
ok('设置项不再用「emoji + 各自底色」', legacy.length === 0, legacy.slice(0, 3).join(' | '));

// 2) 渲染出来的图标必须是 SVG，且墨色交给 CSS
const svg = setIconHTML('bolt');
ok('表内名字渲染成 SVG', svg.startsWith('<svg') && svg.includes('<path '), svg.slice(0, 120));
ok('墨色用 currentColor（由 CSS 统一给白）', svg.includes('stroke="currentColor"'), svg.slice(0, 160));
ok('不写死颜色', !/#fff|#ffffff|#[0-9a-f]{6}/i.test(svg), svg.slice(0, 160));
ok('过滤 Tabler 占位 path', !svg.includes('M0 0h24v24H0z'));
ok('24 网格', svg.includes('viewBox="0 0 24 24"'));

// 3) 表里查不到的名字（emoji / 空）必须原样返回，不能崩
eq('未知名字回退原样', setIconHTML('🎉'), '🎉');
eq('空值回退空', setIconHTML(''), '');
eq('undefined 不抛错', typeof setIconHTML(undefined), 'string');

// 4) 设置页实际用到的图标名，绝大多数都要能在表里查到
const used = [...new Set([...src.matchAll(/icon: '([^']+)'/g)].map((m) => m[1]))];
const hit = used.filter(hasIcon);
const miss = used.filter((n) => !hasIcon(n));
ok('用到的图标名大多命中表', hit.length >= 20, `命中 ${hit.length} / 共 ${used.length}`);
ok('未命中的只剩 sheet 里的 emoji/符号', miss.every((m) => !/^[a-z][a-z_-]*$/.test(m)),
  `未命中: ${miss.join(', ')}`);
console.log(`    命中 ${hit.length} 个：${hit.join(' ')}`);
console.log(`    回退 ${miss.length} 个：${miss.join(' ')}`);

// 5) 全项目扫描：所有页面 / 弹层里写死的图标名必须都能查到，
//    拼错名字会静默退化成 emoji —— 这条就是拦它的（emoji 名除外）
const { readdirSync, statSync } = await import('node:fs');
const walk = (dir) => readdirSync(dir).flatMap((f) => {
  const p = join(dir, f);
  return statSync(p).isDirectory() ? walk(p) : (p.endsWith('.js') ? [p] : []);
});
const files = walk(join(root, 'js')).filter((f) => !f.endsWith('caticon.js') && !f.endsWith('store.js'));
const names = new Set();
for (const f of files) {
  const code = readFileSync(f, 'utf8');
  for (const m of code.matchAll(/icon: '([^']+)'/g)) names.add(m[1]);
  for (const m of code.matchAll(/uiMark\('([^']+)'/g)) names.add(m[1]);
  for (const m of code.matchAll(/uiIcon\('([^']+)'/g)) names.add(m[1]);
  for (const m of code.matchAll(/cardHead\('([^']+)'/g)) names.add(m[1]);
}
const bad = [...names].filter((n) => /^[a-z][a-z_-]*$/.test(n) && !hasIcon(n));
ok('全项目图标名都能查到（拼错会退化成 emoji）', bad.length === 0, `查不到: ${bad.join(', ')}`);
console.log(`    共扫描 ${files.length} 个模块、${names.size} 个图标名`);

// 6) uiMark 必须自带彩底外壳，且墨色交给 CSS
const mark = uiMark('trash', 'ci', true);
ok('uiMark 带彩底外壳', mark.includes('class="ci ui-ic ui-ic-danger"'), mark.slice(0, 80));
ok('uiMark 内是 SVG', mark.includes('<svg'), mark.slice(0, 120));
ok('uiMark 不写死颜色', !/#fff|#[0-9a-f]{6}/i.test(mark), mark.slice(0, 160));
ok('空图标名不渲染空壳', uiMark('', 'ci') === '');

console.log(`\n通过 ${pass} / 失败 ${fail}`);
process.exit(fail ? 1 : 0);
