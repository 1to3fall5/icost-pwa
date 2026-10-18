// 微信 / 支付宝账单解析测试：用贴近真实格式的样例，覆盖编码、表头定位、列映射、过滤、去重、分类猜测
import { writeSync } from 'node:fs';

const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
};

const store = await import('../js/store.js');
const imp = await import('../js/importers.js');
store.load();

let pass = 0; let fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; writeSync(1, 'PASS ' + name + '\n'); }
  else { fail++; writeSync(1, 'FAIL ' + name + (extra ? '  -> ' + extra : '') + '\n'); }
};

// ---------------- 微信（UTF-8 + BOM，前 16 行说明） ----------------
const wxHead = Array.from({ length: 16 }, (_, i) => `说明行${i}`);
const wx = [
  ...wxHead,
  '----------------------微信支付账单明细列表--------------------',
  '交易时间,交易类型,交易对方,商品,收/支,金额(元),支付方式,当前状态,交易单号,商户单号,备注',
  '2026/9/1 09:10:36,商户消费,手机充值50元,手机话费,支出,¥45.00,零钱,支付成功,W001,M001,/',
  '2026/8/31 20:45:21,微信红包,吴丽,/,收入,¥20.00,/,已存入零钱,W002,/,/',
  '2026/8/30 19:28:11,零钱提现,/,提现,/,¥100.00,XX银行(1234),提现已到账,W003,/,/',
  '2026/8/29 12:00:00,商户消费,麦当劳,午餐,支出,¥35.50,零钱,已全额退款,W004,/,/',
  '2026/8/28 12:00:00,扫二维码付款,滴滴出行,打车,支出,¥23.00,零钱,支付成功,W005,/,/',
  '2026/8/27 12:00:00,转账,张三,/,支出,¥200.00,零钱,支付成功,W006,/,/',
].join('\r\n');

const wxBuf = Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]), Buffer.from(wx, 'utf-8')]);
const wxText = imp.decodeText(wxBuf.buffer.slice(wxBuf.byteOffset, wxBuf.byteOffset + wxBuf.byteLength));
const wxRes = imp.parseStatement(wxText);

ok('微信 BOM 被正确处理', !wxText.startsWith('\uFEFF'));
ok('微信来源识别正确', wxRes.source === 'wechat', wxRes.source);
ok('微信表头定位在第 17 行', wxRes.headerRow === 17, String(wxRes.headerRow));
ok('微信金额列映射成功', wxRes.columns.amount >= 0);

const wxIds = wxRes.rows.map((r) => r.importKey);
ok('微信共 4 笔有效（跳过提现/退款）', wxRes.rows.length === 4, JSON.stringify(wxIds));
ok('跳过零钱提现', !wxIds.some((k) => k.includes('W003')));
ok('跳过已全额退款', !wxIds.some((k) => k.includes('W004')));

const w1 = wxRes.rows.find((r) => r.importKey.includes('W001'));
ok('微信金额去掉 ¥ 符号', w1 && w1.amount === 45, String(w1 && w1.amount));
ok('微信日期格式转换正确', w1 && w1.date === '2026-09-01', w1 && w1.date);
ok('微信时间提取正确', w1 && w1.time === '09:10', w1 && w1.time);
ok('话费 -> 通讯分类', w1 && store.catById(w1.categoryId)?.name === '通讯', store.catById(w1?.categoryId)?.name);

const w2 = wxRes.rows.find((r) => r.importKey.includes('W002'));
ok('微信红包 -> 收入', w2 && w2.type === 'income', w2 && w2.type);
ok('红包 -> 红包分类', w2 && store.catById(w2.categoryId)?.name === '红包', store.catById(w2?.categoryId)?.name);

const w5 = wxRes.rows.find((r) => r.importKey.includes('W005'));
ok('滴滴 -> 交通分类', w5 && store.catById(w5.categoryId)?.name === '交通', store.catById(w5?.categoryId)?.name);

const w6 = wxRes.rows.find((r) => r.importKey.includes('W006'));
ok('转账 -> 人情分类', w6 && store.catById(w6.categoryId)?.name === '人情', store.catById(w6?.categoryId)?.name);

// ---------------- 支付宝 16 列（网页版导出，前 4 行说明） ----------------
const ali = [
  '支付宝交易明细',
  '账号：[test@example.com]',
  '起始日期：[2026-09-01] 终止日期：[2026-09-30]',
  '--------------------交易记录明细列表--------------------',
  '交易号,商家订单号,交易创建时间,付款时间,最近修改时间,交易来源地,类型,交易对方,商品名称,金额(元),收/支,交易状态,服务费(元),成功退款(元),备注,资金状态',
  'A001,B001,2026-09-01 12:00:00,2026-09-01 12:00:00,2026-09-01 12:00:00,支付宝网站,即时到账交易,美团外卖,午餐,32.50,支出,交易成功,0.00,0.00,,已支出',
  'A002,B002,2026-09-02 08:00:00,2026-09-02 08:00:00,2026-09-02 08:00:00,支付宝网站,即时到账,淘宝,衣服,128.00,支出,交易关闭,0.00,0.00,,已支出',
  'A003,B003,2026-09-03 08:00:00,2026-09-03 08:00:00,2026-09-03 08:00:00,支付宝网站,转账,某公司,工资,5000.00,收入,交易成功,0.00,0.00,,已收入',
  'A004,B004,2026-09-04 08:00:00,2026-09-04 08:00:00,2026-09-04 08:00:00,支付宝网站,充值,余额宝,转入,1000.00,不计收支,交易成功,0.00,0.00,,已收入',
].join('\r\n');

const aliRes = imp.parseStatement(ali);
ok('支付宝来源识别正确', aliRes.source === 'alipay', aliRes.source);
ok('支付宝 16 列表头定位正确', aliRes.headerRow === 4, String(aliRes.headerRow));

const aliIds = aliRes.rows.map((r) => r.importKey);
ok('支付宝共 2 笔有效（跳过关闭/不计收支）', aliRes.rows.length === 2, JSON.stringify(aliIds));
ok('跳过交易关闭', !aliIds.some((k) => k.includes('A002')));
ok('跳过不计收支', !aliIds.some((k) => k.includes('A004')));

const a1 = aliRes.rows.find((r) => r.importKey.includes('A001'));
ok('支付宝纯数字金额解析', a1 && a1.amount === 32.5, String(a1 && a1.amount));
ok('美团外卖 -> 餐饮', a1 && store.catById(a1.categoryId)?.name === '餐饮', store.catById(a1?.categoryId)?.name);

const a3 = aliRes.rows.find((r) => r.importKey.includes('A003'));
ok('工资 -> 收入', a3 && a3.type === 'income');
ok('工资 -> 工资分类', a3 && store.catById(a3.categoryId)?.name === '工资', store.catById(a3?.categoryId)?.name);

// ---------------- 支付宝新版 12 列（App 导出） ----------------
const ali2 = [
  ...Array.from({ length: 24 }, (_, i) => `说明${i}`),
  '交易时间,交易分类,交易对方,对方账号,商品说明,收/支,金额,收/付款方式,交易状态,交易订单号,商家订单号,备注',
  '2026-09-05 10:00:00,餐饮美食,海底捞,d****@x.com,火锅,支出,268.00,余额宝,交易成功,C001,D001,',
  '2026-09-06 10:00:00,充值提现,余额宝,,,不计收支,1000.00,余额,交易成功,C002,D002,',
].join('\n');
const ali2Res = imp.parseStatement(ali2);
ok('支付宝 12 列也能解析', ali2Res.source === 'alipay' && ali2Res.rows.length === 1,
  `${ali2Res.source}/${ali2Res.rows.length}`);
ok('12 列表头定位在第 25 行', ali2Res.headerRow === 24, String(ali2Res.headerRow));
ok('火锅 -> 餐饮', store.catById(ali2Res.rows[0]?.categoryId)?.name === '餐饮',
  store.catById(ali2Res.rows[0]?.categoryId)?.name);

// ---------------- 编码：GBK 分支 ----------------
// "中文" 的 GBK 字节 D6 D0 CE C4，UTF-8 严格解码会失败，必须落到 GBK
const gbkBytes = new Uint8Array([0xD6, 0xD0, 0xCE, 0xC4]);
ok('GBK 字节能被正确解码', imp.decodeText(gbkBytes.buffer) === '中文', imp.decodeText(gbkBytes.buffer));

// ---------------- 去重 ----------------
store.S().bills = [{ id: 'x', importKey: 'wechat:W001', type: 'expense', amount: 45, date: '2026-09-01' }];
const { fresh, dup } = imp.filterExisting(wxRes.rows);
ok('重复导入时识别出 1 笔已存在', dup === 1, String(dup));
ok('剩余 3 笔可导入', fresh.length === 3, String(fresh.length));
const again = imp.filterExisting(wxRes.rows.concat(wxRes.rows));
ok('同一次内重复也会被去重', again.fresh.length === 3, String(again.fresh.length));

// ---------------- 汇总 ----------------
const s = imp.summarize(wxRes.rows);
ok('汇总笔数正确', s.count === 4, String(s.count));
ok('汇总时间范围正确', s.from === '2026-08-27' && s.to === '2026-09-01', `${s.from}~${s.to}`);

// ---------------- 模糊去重（手动记账 vs 导入的账） ----------------
store.S().bills = [
  { id: 'm1', type: 'expense', amount: 45, date: '2026-09-01', note: '手动记的' },      // 无 importKey
  { id: 'm2', type: 'expense', amount: 30, date: '2026-09-02', note: '咖啡' },
  { id: 'm3', type: 'income', amount: 45, date: '2026-09-01', note: '收入' },
];
const toImport = [
  { type: 'expense', amount: 45, date: '2026-09-01', note: '微信导入' },   // 撞 m1
  { type: 'expense', amount: 45, date: '2026-09-05', note: '另一天' },     // 日期不同，不算
  { type: 'expense', amount: 50, date: '2026-09-01', note: '金额不同' },   // 金额不同，不算
  { type: 'expense', amount: 30, date: '2026-09-02', note: '咖啡A' },      // 撞 m2
  { type: 'expense', amount: 30, date: '2026-09-02', note: '咖啡B' },      // m2 已用掉，这笔保留
  { type: 'income', amount: 45, date: '2026-09-01', note: '收入撞' },      // 撞 m3
];
const sim = imp.findSimilar(toImport, store.S().bills);
ok('识别出 3 笔疑似重复', sim.similar.length === 3, String(sim.similar.length));
ok('疑似重复对上了正确的本机账',
  sim.similar.map((x) => x.match.id).sort().join(',') === 'm1,m2,m3',
  sim.similar.map((x) => x.match.id).join(','));
ok('剩下的 3 笔保留', sim.unique.length === 3, String(sim.unique.length));
ok('同一天两杯同价咖啡只抵掉一杯',
  sim.unique.filter((r) => r.amount === 30).length === 1,
  String(sim.unique.filter((r) => r.amount === 30).length));
ok('收入与支出不互撞',
  !sim.similar.some((x) => x.bill.type !== x.match.type));
ok('日期容差生效（1 天内也算）',
  imp.findSimilar([{ type: 'expense', amount: 45, date: '2026-09-02' }], store.S().bills, 1).similar.length === 1);
ok('没有本机账时不误判', imp.findSimilar(toImport, []).similar.length === 0);

// ---------------- 坏输入 ----------------
let threw = false;
try { imp.parseStatement('随便一段文字\n没有表头'); } catch { threw = true; }
ok('无表头时明确报错', threw);

writeSync(1, `\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
