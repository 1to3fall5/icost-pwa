// 分类图标测试：内置图标覆盖度、降级首字、颜色注入安全、渲染 HTML 合法
// 跑法：node scripts/caticon-test.mjs
import { catMarkHTML, accMarkHTML, markInnerHTML, glyphOf, initialOf, setIconStyle, getIconStyle } from '../js/caticon.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('OK  ', name); }
  else { fail++; console.log('FAIL', name, extra); }
};
const eq = (name, a, b) => ok(name, a === b, `got=${JSON.stringify(a)} want=${JSON.stringify(b)}`);

// ---------- 内置分类必须都有图标 ----------
const EXPENSE = ['餐饮', '购物', '交通', '日用', '水果', '娱乐', '通讯', '住房', '医疗', '学习', '运动', '人情', '宠物', '美容', '孩子', '其他'];
const INCOME = ['工资', '奖金', '理财', '红包', '报销', '兼职', '二手', '礼金', '退款', '其他'];
EXPENSE.forEach((n) => ok(`内置支出分类有图标：${n}`, !!glyphOf(n, '', 'expense')));
INCOME.forEach((n) => ok(`内置收入分类有图标：${n}`, !!glyphOf(n, '', 'income')));

// 收入和支出都有「其他」，必须给出不同图标
ok('收入「其他」与支出「其他」图标不同', glyphOf('其他', '', 'income') !== glyphOf('其他', '', 'expense'));

// ---------- 默认二级分类能通过父级或映射命中 ----------
const SUBS = {
  '早餐': '餐饮', '午餐': '餐饮', '外卖': '餐饮', '服饰': '购物', '打车': '交通',
  '房租': '住房', '药品': '医疗', '书籍': '学习', '健身': '运动', '护肤': '美容',
  '奶粉': '孩子', '年终奖': '奖金', '基金': '理财', '闲鱼': '二手', '话费': '通讯',
};
Object.entries(SUBS).forEach(([sub, top]) => {
  eq(`二级「${sub}」继承「${top}」图标`, glyphOf(sub, top), glyphOf(top, '', 'expense'));
});
ok('只给二级名也能命中（SUB2TOP）', glyphOf('午餐', '') === glyphOf('餐饮', '', 'expense'));
ok('parent 优先于同名一级', glyphOf('红包', '人情') === glyphOf('人情', '', 'expense'));

// ---------- 降级：首字 ----------
eq('中文取首字', initialOf('餐饮'), '餐');
eq('英文取首字母大写', initialOf('coffee'), 'C');
eq('空名回退问号', initialOf(''), '?');
eq('空格被 trim', initialOf('  运动  '), '运');
const custom = catMarkHTML({ name: '自定义分类', color: '#ff9f0a' });
ok('无内置图标 → 首字徽章', custom.includes('ic-mono') && custom.includes('>自<'), custom);

// ---------- 颜色注入 ----------
ok('非法颜色被拒绝', !catMarkHTML({ name: '餐饮', color: 'red;background:url(x)' }).includes('red;'));
ok('非法颜色回退 #98989f', catMarkHTML({ name: '餐饮', color: 'javascript:alert(1)' }).includes('#98989f'));
ok('合法 6 位十六进制保留', catMarkHTML({ name: '餐饮', color: '#ff9f0a' }).includes('#ff9f0a'));
ok('合法 3 位十六进制保留', catMarkHTML({ name: '餐饮', color: '#f90' }).includes('#f90'));
const evil = catMarkHTML({ name: '<img src=x onerror=1>', color: '#fff' });
ok('分类名首字被转义', evil.includes('&lt;') && !evil.includes('<img'));

// ---------- 结构 ----------
setIconStyle('line');
const line = catMarkHTML({ name: '餐饮', color: '#ff9f0a', cls: 'bill-ic' });
ok('line 模式产出 ic-line', line.includes('ic-line') && line.includes('ic-mark'));
ok('line 模式带容器 class', line.includes('bill-ic'));
ok('line 模式是 svg path', line.includes('<path d="') && line.includes('</svg>'));
ok('line 模式不带 emoji', !/\p{Extended_Pictographic}/u.test(line));
ok('line 模式写 --c', line.includes('--c:#ff9f0a'));
ok('line 模式 stroke 用分类色', line.includes('stroke="#ff9f0a"'));

setIconStyle('emoji');
eq('getIconStyle 跟随设置', getIconStyle(), 'emoji');
const emo = catMarkHTML({ name: '餐饮', icon: '🍜', color: '#ff9f0a', cls: 'bill-ic' });
ok('emoji 模式产出 ic-emoji', emo.includes('ic-emoji'));
ok('emoji 模式显示原 emoji', emo.includes('🍜'));
ok('emoji 模式不画 svg', !emo.includes('<path'));
setIconStyle('line');

// ---------- 特殊场景 ----------
const tr = catMarkHTML({ kind: 'transfer', color: '#0a84ff', cls: 'bill-ic' });
ok('转账走内置双向箭头（Tabler arrows-left-right）', tr.includes('<path d="M21 17l-18 0'));
['cash', 'online', 'bank', 'credit'].forEach((t) => {
  const h = accMarkHTML({ name: '账户', type: t, color: '#30d158', cls: 'ac-ic' });
  ok(`账户类型 ${t} 有内置图标`, h.includes('<path d="'), h.slice(0, 80));
});
ok('未知账户类型降级首字', accMarkHTML({ name: '我的钱包', type: 'weird', color: '#30d158' }).includes('>我<'));

// ---------- markInnerHTML（就地更新用） ----------
const inner = markInnerHTML({ name: '餐饮', color: '#ff9f0a' });
ok('markInner 不含 span 外壳', !inner.startsWith('<span'));
ok('markInner 是 svg', inner.startsWith('<svg'));

// ---------- 全量渲染不抛错 / 不产生 NaN / undefined ----------
let all = '';
[...EXPENSE, ...INCOME].forEach((n) => { all += catMarkHTML({ name: n, color: '#ff9f0a', type: 'expense', cls: 'bill-ic' }); });
all += catMarkHTML({});
all += catMarkHTML({ name: '', color: '' });
ok('全量渲染无 NaN', !all.includes('NaN'));
ok('全量渲染无 undefined', !all.includes('undefined'));
ok('空输入不抛错', catMarkHTML({}).includes('ic-mono'));


// ---------- Tabler 图标（多段 path） ----------
const multi = catMarkHTML({ name: '餐饮', color: '#ff9f0a' });
ok('多段 path 被拆成多个 <path>', (multi.match(/<path /g) || []).length >= 3, multi.slice(0, 120));
ok('多段 path 用 | 分隔且未被合并', !multi.includes('|'));
ok('过滤了 Tabler 的空白占位 path', !multi.includes('M0 0h24v24H0z'));
ok('线宽交给 CSS（不在 SVG 上写死）', !multi.includes('stroke-width='));
// 每个内置图标都至少有一段有效 path
[...EXPENSE, ...INCOME].forEach((n) => {
  const h = catMarkHTML({ name: n, color: '#ff9f0a', type: 'expense' });
  const ps = (h.match(/<path d="/g) || []).length;
  ok(`${n} 至少一段 path`, ps >= 1);
});

// ---------- 实心（filled）风格 ----------
setIconStyle('filled');
eq('风格切换到 filled', getIconStyle(), 'filled');
// 内置 31 个图标在实心模式下必须全部命中（不能有任何一个掉成首字）
const ALLCAT = [...EXPENSE, ...INCOME];
ALLCAT.forEach((n) => {
  const t = n === '其他' || ['工资', '奖金', '理财', '红包', '报销', '兼职', '二手', '礼金', '退款'].includes(n) ? 'income' : 'expense';
  const h = catMarkHTML({ name: n, color: '#ff9f0a', type: t });
  ok(`实心：${n} 有内置图标（非首字）`, !h.includes('ic-mono') && h.includes('<path '), h.slice(0, 100));
});
['transfer', 'cash', 'online', 'bank', 'credit'].forEach((k) => {
  const h = accMarkHTML({ type: k, name: 'x', color: '#ff9f0a' });
  ok(`实心：账户类型 ${k} 有内置图标`, !h.includes('ic-mono') && h.includes('<path '));
});
// 实心 SVG 必须是 fill=颜色 + 无 stroke（否则画不出来）
const solidHTML = catMarkHTML({ name: '餐饮', color: '#ff9f0a' });
ok('实心用 fill 上色', solidHTML.includes('fill="#ff9f0a"'), solidHTML.slice(0, 140));
ok('实心不掉 stroke 属性（避免重复 fill 冲突）', !solidHTML.includes('stroke="'), solidHTML.slice(0, 140));
ok('实心不带 stroke-width', !solidHTML.includes('stroke-width'));
ok('实心容器 class 为 ic-fill', solidHTML.includes('ic-fill') && !solidHTML.includes('ic-line'));
ok('实心过滤空白占位 path', !solidHTML.includes('M0 0h24v24H0z'));
// 实心与线性必须是两套不同的 path
setIconStyle('line');
const lineD = catMarkHTML({ name: '餐饮', color: '#ff9f0a' });
setIconStyle('filled');
ok('实心与线性 path 不同', catMarkHTML({ name: '餐饮', color: '#ff9f0a' }) !== lineD);
// 收入/支出「其他」在实心下仍然不同
ok('实心：收入/支出「其他」不同',
  catMarkHTML({ name: '其他', type: 'income', color: '#f0a' }) !== catMarkHTML({ name: '其他', type: 'expense', color: '#f0a' }));
// 实心下自定义分类仍降级首字，且首字用 fill="none" 外壳 + text 自带 fill
const solidMono = catMarkHTML({ name: '自定义XX', color: '#0af' });
ok('实心：自定义分类降级首字', solidMono.includes('ic-mono') && solidMono.includes('<text'));
ok('实心：首字外壳 fill="none"', solidMono.includes('fill="none"') && solidMono.includes('fill="#0af"'));
// ---------- 彩色插画（illust）风格 ----------
setIconStyle('illust');
eq('风格切换到 illust', getIconStyle(), 'illust');
// 内置 31 个图标在插画模式下必须全部命中（不能有任何一个掉成首字）
ALLCAT.forEach((n) => {
  const t = n === '其他' || ['工资', '奖金', '理财', '红包', '报销', '兼职', '二手', '礼金', '退款'].includes(n) ? 'income' : 'expense';
  const h = catMarkHTML({ name: n, color: '#ff9f0a', type: t });
  ok(`插画：${n} 有内置图标（非首字）`, !h.includes('ic-mono') && h.includes('<path '), h.slice(0, 100));
});
['transfer', 'cash', 'online', 'bank', 'credit'].forEach((k) => {
  const h = accMarkHTML({ type: k, name: 'x', color: '#ff9f0a' });
  ok(`插画：账户类型 ${k} 有内置图标`, !h.includes('ic-mono') && h.includes('<path '));
});
const illHTML = catMarkHTML({ name: '餐饮', color: '#ff9f0a' });
ok('插画用 32 网格 viewBox', illHTML.includes('viewBox="0 0 32 32"'), illHTML.slice(0, 160));
ok('插画自带配色（不套分类色）',
  /<path d="[^"]+" fill="#[0-9a-fA-F]{6}"/.test(illHTML) && !illHTML.includes('fill="#ff9f0a"'), illHTML.slice(0, 200));
ok('插画容器 class 为 ic-illust',
  illHTML.includes('ic-illust') && !illHTML.includes('ic-line') && !illHTML.includes('ic-fill'));
ok('插画不带 stroke', !illHTML.includes('stroke="'), illHTML.slice(0, 160));
const illPaths = (illHTML.match(/<path /g) || []).length;
ok('插画每段 path 都自带 fill', illPaths >= 1 && illPaths === (illHTML.match(/ fill="#/g) || []).length, illHTML.slice(0, 200));
// 三套风格必须互不相同
setIconStyle('line');
const illLine = catMarkHTML({ name: '餐饮', color: '#ff9f0a' });
setIconStyle('filled');
const illFill = catMarkHTML({ name: '餐饮', color: '#ff9f0a' });
setIconStyle('illust');
const illSelf = catMarkHTML({ name: '餐饮', color: '#ff9f0a' });
ok('插画与线性、实心都不同', illSelf !== illLine && illSelf !== illFill);
ok('插画：收入/支出「其他」不同',
  catMarkHTML({ name: '其他', type: 'income', color: '#f0a' }) !== catMarkHTML({ name: '其他', type: 'expense', color: '#f0a' }));
// 插画下自定义分类仍降级首字
const illMono = catMarkHTML({ name: '自定义XX', color: '#0af' });
ok('插画：自定义分类降级首字', illMono.includes('ic-mono') && illMono.includes('<text'));
ok('插画：首字外壳 fill="none"', illMono.includes('fill="none"') && illMono.includes('fill="#0af"'));

// 非法风格回落
setIconStyle('weird');
eq('非法风格回落 line', getIconStyle(), 'line');

console.log(`\n通过 ${pass} / 失败 ${fail}`);
process.exit(fail ? 1 : 0);
