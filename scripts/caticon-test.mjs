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
ok('转账走内置双向箭头', tr.includes('<path d="M4 8h13'));
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

console.log(`\n通过 ${pass} / 失败 ${fail}`);
process.exit(fail ? 1 : 0);
