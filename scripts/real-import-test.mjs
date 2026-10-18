// 用真实账单文件做端到端验证（微信 xlsx / 支付宝 CSV-GBK）
// Node 没有 DOMParser，这里自带一个够用的 XML stub，把 xlsx 链路完整跑通
import { readFileSync, writeSync } from 'node:fs';

const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
};

// ---- 最小 XML -> 类 DOM 树 ----
function parseXML(text) {
  const mk = (name) => ({ localName: name, children: [], attrs: {}, _text: '' });
  const root = mk('#root');
  const stack = [root];
  const re = /<\?[^>]*\?>|<!--[\s\S]*?-->|<\/([A-Za-z0-9_:.]+)\s*>|<([A-Za-z0-9_:.]+)((?:\s+[A-Za-z0-9_:.]+="[^"]*")*)\s*(\/?)>|([^<]+)/g;
  let m;
  while ((m = re.exec(text))) {
    if (m[1]) { if (stack.length > 1) stack.pop(); }
    else if (m[2]) {
      const node = mk(m[2].includes(':') ? m[2].split(':')[1] : m[2]);
      const ar = /([A-Za-z0-9_:.]+)="([^"]*)"/g; let a;
      while ((a = ar.exec(m[3] || ''))) node.attrs[a[1]] = a[2];
      stack[stack.length - 1].children.push(node);
      if (!m[4]) stack.push(node);
    } else if (m[5] !== undefined && stack.length) {
      stack[stack.length - 1]._text += m[5];
    }
  }
  const walk = (n, fn) => { n.children.forEach((c) => { fn(c); walk(c, fn); }); };
  const enhance = (n) => {
    Object.defineProperty(n, 'textContent', {
      get() { return n._text + n.children.map((c) => c.textContent).join(''); },
    });
    n.getElementsByTagName = (tag) => { const out = []; walk(n, (c) => { if (c.localName === tag) out.push(c); }); return out; };
    n.getAttribute = (k) => (k in n.attrs ? n.attrs[k] : null);
  };
  enhance(root);          // root 本身也要有这些方法，importers.js 会对它调 getElementsByTagName
  walk(root, enhance);
  return root;
}
globalThis.DOMParser = class {
  parseFromString(t) { return parseXML(t); }
};

const store = await import('../js/store.js');
const imp = await import('../js/importers.js');
store.load();

let pass = 0; let fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; writeSync(1, 'PASS ' + name + '\n'); }
  else { fail++; writeSync(1, 'FAIL ' + name + (extra ? '  -> ' + extra : '') + '\n'); }
};
const ab = (p) => { const b = readFileSync(p); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };

// 真实账单含个人隐私，不入库。用法：ICOST_BILL_DIR=<账单目录> node scripts/real-import-test.mjs
const DIR = process.env.ICOST_BILL_DIR || '';
if (!DIR) {
  writeSync(1, 'SKIP 未设置 ICOST_BILL_DIR，跳过真实文件测试\n');
  process.exit(0);
}

// ================= 支付宝 CSV（GBK，12 列） =================
const aliBuf = ab(DIR + '支付宝交易明细(20260101-20261001).csv');
const aliText = imp.decodeText(aliBuf);
ok('支付宝 GBK 解码出中文表头', aliText.includes('交易分类') && aliText.includes('收/支'));
const ali = imp.parseStatement(aliText);
ok('识别为支付宝', ali.source === 'alipay', ali.source);
ok('表头定位正确', ali.headerRow > 0, String(ali.headerRow));
const asum = imp.summarize(ali.rows);
writeSync(1, `     支付宝：解析 ${ali.rows.length} 笔（支出 ${asum.expenseCount} 笔 ¥${asum.expenseSum.toFixed(2)}，`
  + `收入 ${asum.incomeCount} 笔 ¥${asum.incomeSum.toFixed(2)}），${asum.from} ~ ${asum.to}\n`);
ok('支付宝解析出足够多的交易', ali.rows.length >= 100 && ali.rows.length <= 140, String(ali.rows.length));
ok('金额合计为正数', asum.expenseSum > 1000, asum.expenseSum.toFixed(2));

// 逐条校验：所有结果都必须是合法账单
ok('全部有日期', ali.rows.every((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.date)));
ok('全部有正金额', ali.rows.every((r) => r.amount > 0));
ok('全部有分类', ali.rows.every((r) => !!r.categoryId));
ok('全部有去重键', ali.rows.every((r) => !!r.importKey));
ok('没有不计收支混入', !ali.rows.some((r) => !r.type));

// 关键过滤：花呗还款（信用借还，不计收支）不能进来
const hasHuabei = ali.rows.some((r) => r.kind === '信用借还');
ok('花呗还款被排除', !hasHuabei);
// 交易关闭不能进来
ok('交易关闭被排除', !ali.rows.some((r) => r.kind && r.kind.includes('关闭')));

// 分类映射：支付宝官方分类要落到我们的分类上
const catOf = (r) => store.catById(r.categoryId)?.name;
const medical = ali.rows.filter((r) => r.kind === '医疗健康');
ok('医疗健康 -> 医疗', medical.length > 0 && medical.every((r) => catOf(r) === '医疗'),
  medical.slice(0, 3).map(catOf).join(','));
const food = ali.rows.filter((r) => r.kind === '餐饮美食');
ok('餐饮美食 -> 餐饮', food.length > 0 && food.every((r) => catOf(r) === '餐饮'),
  food.slice(0, 3).map(catOf).join(','));
const transit = ali.rows.filter((r) => r.kind === '交通出行' || r.kind === '充值缴费');
ok('深圳通充值 -> 交通（关键词兜底）',
  transit.filter((r) => (r.note || '').includes('深圳通')).every((r) => catOf(r) === '交通'),
  transit.filter((r) => (r.note || '').includes('深圳通')).slice(0, 3).map(catOf).join(','));
const income = ali.rows.filter((r) => r.type === 'income');
ok('收入笔数合理', income.length >= 5 && income.length <= 10, String(income.length));

// ================= 微信 xlsx =================
const wxBuf = ab(DIR + '微信支付账单流水文件(20260101-20261018)_20261018154201.xlsx');
ok('Excel 序列号换算正确', imp.excelSerialToStr('46311.53616898148').startsWith('2026-10-16 12:52'),
  imp.excelSerialToStr('46311.53616898148'));
const wx = await imp.parseXlsx(wxBuf);
ok('识别为微信', wx.source === 'wechat', wx.source);
const wsum = imp.summarize(wx.rows);
writeSync(1, `     微信：解析 ${wx.rows.length} 笔（支出 ${wsum.expenseCount} 笔 ¥${wsum.expenseSum.toFixed(2)}，`
  + `收入 ${wsum.incomeCount} 笔 ¥${wsum.incomeSum.toFixed(2)}），${wsum.from} ~ ${wsum.to}\n`);
ok('微信解析出足够多的交易', wx.rows.length >= 300, String(wx.rows.length));
ok('微信日期在 2026 年内', wx.rows.every((r) => r.date.startsWith('2026-')), wx.rows[0] && wx.rows[0].date);
ok('微信时间带时分', wx.rows.filter((r) => /^\d{2}:\d{2}$/.test(r.time)).length > wx.rows.length * 0.9);
ok('微信金额为正', wx.rows.every((r) => r.amount > 0));
ok('微信全部有分类', wx.rows.every((r) => !!r.categoryId));
ok('微信全部有去重键', wx.rows.every((r) => !!r.importKey));
ok('已全额退款被排除', !wx.rows.some((r) => (r.kind || '').includes('已全额退款')));

// 抽样看分类是否合理（只打印分类名，不打印交易对手，保护隐私）
const dist = {};
wx.rows.forEach((r) => { const n = catOf(r); dist[n] = (dist[n] || 0) + 1; });
writeSync(1, '     微信分类分布：' + Object.entries(dist).sort((a, b) => b[1] - a[1])
  .map(([k, v]) => `${k}:${v}`).join('  ') + '\n');
ok('微信绝大多数落在合理分类', Object.keys(dist).length >= 3 && Object.keys(dist).length <= 16,
  String(Object.keys(dist).length));

// ================= 真实数据上的模糊去重 =================
// 模拟用户此前手动记过其中 20 笔（金额+日期相同，没有流水号），看能不能认出来
{
  const picked = [];
  const seen = new Set();
  for (const r of wx.rows) {
    const k = `${r.type}|${r.amount}|${r.date}`;
    if (seen.has(k)) continue;                     // 只挑金额日期互不相同的，结果才可预测
    seen.add(k); picked.push(r);
    if (picked.length >= 20) break;
  }
  const manual = picked.map((r, i) => ({ id: 'm' + i, type: r.type, amount: r.amount, date: r.date, note: '手动记的' }));
  const sim = imp.findSimilar(wx.rows, manual);
  writeSync(1, `     模糊去重：本机已手动记 ${manual.length} 笔，导入 ${wx.rows.length} 笔 -> `
    + `识别重复 ${sim.similar.length} 笔，实际导入 ${sim.unique.length} 笔\n`);
  ok('真实数据上能认出手动记过的账', sim.similar.length === manual.length,
    `${sim.similar.length}/${manual.length}`);
  ok('其余的不误伤', sim.unique.length === wx.rows.length - manual.length);
}

// ================= 去重（两个文件各导两次） =================
store.S().bills = [];
const a1 = imp.filterExisting(ali.rows);
ok('首次导入无重复', a1.dup === 0 && a1.fresh.length === ali.rows.length);
store.S().bills = a1.fresh.map((r, i) => ({ id: 'a' + i, importKey: r.importKey }));
const a2 = imp.filterExisting(ali.rows);
ok('二次导入全部识别为重复', a2.dup === ali.rows.length && a2.fresh.length === 0,
  `dup=${a2.dup} fresh=${a2.fresh.length}`);

writeSync(1, `\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
