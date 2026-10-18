// 微信 / 支付宝账单 CSV 导入
//
// 设计原则（踩过的坑，别改回去）：
//  1. 按表头名映射，绝不按下标硬取 —— 支付宝有 12 列（App 导出）与 16 列（网页导出）两套，
//     微信说明行 16 行、支付宝 4~24 行不等，任何"跳过 N 行取第 M 列"都会在版本差异下碎掉。
//  2. 编码必须自动判断 —— 微信 UTF-8（带 BOM），支付宝 GBK。用 fatal 严格解码来判定最可靠。
//  3. 导入的是历史流水，不改动账户余额 —— 余额里早就体现了这些消费，再扣一次就是重复记账。
//  4. 必须能重复导入 —— 靠平台 + 流水号做去重键。
import { S } from './store.js';

// ---- CSV 解析 ----
export function decodeText(buf) {
  const u8 = new Uint8Array(buf);
  if (u8[0] === 0xEF && u8[1] === 0xBB && u8[2] === 0xBF) {
    return new TextDecoder('utf-8').decode(u8.subarray(3));
  }
  // 严格解码：UTF-8 字节序列遇到 GBK 内容会抛错，这是区分两者最可靠的办法
  try { return new TextDecoder('utf-8', { fatal: true }).decode(u8); } catch {}
  try { return new TextDecoder('gbk').decode(u8); } catch {}
  return new TextDecoder('utf-8').decode(u8);
}

export function parseCSV(text) {
  const rows = [];
  let row = []; let cur = ''; let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else inQ = false; }
      else cur += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
    else if (c !== '\r') cur += c;
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  return rows.filter((r) => r.some((x) => String(x).trim() !== ''));
}

// ---- 表头定位与列映射 ----
// 说明行长度不定，只能靠"这一行同时像表头（含 收/支 和 金额）"来判断
export function findHeaderRow(rows) {
  const limit = Math.min(rows.length, 80);
  for (let i = 0; i < limit; i++) {
    const line = rows[i].map((x) => String(x).trim()).join('|');
    if (/收\s*\/\s*支/.test(line) && /金额/.test(line)) return i;
  }
  return -1;
}

const RULES = {
  time: ['交易时间', '付款时间', '交易创建时间', '发生时间'],
  party: ['交易对方', '对方账户', '对方'],
  product: ['商品说明', '商品名称', '商品'],
  inout: ['收/支', '收支', '收\/支'],
  amount: ['金额'],                    // 覆盖 金额(元) / 金额（元）/ 金额
  status: ['当前状态', '交易状态'],
  order: ['交易单号', '交易订单号', '交易号', '账务流水号'],
  method: ['收/付款方式', '支付方式'],
  kind: ['交易类型', '交易分类', '类型'],
  note: ['备注'],
};

export function mapColumns(header) {
  const h = header.map((x) => String(x).trim());
  const map = {};
  const find = (names) => {
    for (const n of names) { const i = h.indexOf(n); if (i >= 0) return i; }   // 精确优先
    for (const n of names) { const i = h.findIndex((x) => x.includes(n)); if (i >= 0) return i; }
    return -1;
  };
  Object.keys(RULES).forEach((k) => { map[k] = find(RULES[k]); });
  return map;
}

// ---- 来源识别 ----
export function detectSource(rows, headerIdx) {
  const head = (rows[headerIdx] || []).map((x) => String(x).trim()).join(',');
  // 微信有「交易单号 / 商户单号 / 当前状态」，支付宝有「交易订单号 / 商家订单号 / 交易状态」
  if (/商户单号|当前状态|零钱/.test(head)) return 'wechat';
  if (/商家订单号|交易状态|交易号|收\/付款方式/.test(head)) return 'alipay';
  const sample = rows.slice(headerIdx + 1, headerIdx + 6).map((r) => r.join(',')).join(' ');
  if (/¥|￥/.test(sample)) return 'wechat';       // 只有微信的金额带 ¥ 前缀
  return 'unknown';
}

// 微信里这几类是资金在自己账户间搬家，不是真实消费
const WX_TRANSFER = ['零钱提现', '零钱充值', '转入零钱通', '零钱通转出', '理财通', '信用卡还款'];
const SKIP_STATUS = /全额退款|已退款|退款成功|交易关闭|已关闭|已撤销|失败|已失败/;

// ---- 分类猜测 ----
// 顺序 = 优先级：越具体越靠前，避免"超市"把"水果"吃掉
const KEYWORDS = [
  ['住房', ['房租', '水费', '电费', '燃气', '物业', '供暖', '取暖', '水务', '自来水', '供电', '电力', '公寓']],
  ['通讯', ['话费', '流量', '中国移动', '中国联通', '中国电信', '宽带', '充值中心']],
  ['交通', ['滴滴', '打车', '出租车', '地铁', '公交', '高铁', '火车', '机票', '航空', '加油', '停车', '单车', '哈啰', '青桔', '摩拜', '12306', '出行', '深圳通', '顺风车', '高德', '随用随充']],
  ['餐饮', ['美团', '饿了么', '外卖', '餐饮', '美食', '咖啡', '瑞幸', '星巴克', '奶茶', '麦当劳', '肯德基', 'KFC', '食堂', '小吃', '烧烤', '火锅', ' food', '餐']],
  ['水果', ['水果', '生鲜', '菜市场', '买菜']],
  ['医疗', ['药', '医院', '门诊', '体检', '挂号', '诊所', '大药房', '药房', '医保', '健康']],
  ['学习', ['书店', '图书', '课程', '培训', '学费', '文具', '教育']],
  ['娱乐', ['电影', '影院', '游戏', 'KTV', 'K歌', '视频会员', '腾讯视频', '爱奇艺', '优酷', '哔哩', '网易云', '酷狗', 'QQ音乐', '音乐', 'Steam', '旅游', '酒店', '小黑盒']],
  ['运动', ['健身', '游泳', '羽毛球', '篮球', '足球', '运动']],
  ['美容', ['理发', '美发', '护肤', '化妆', '美甲', '美容']],
  ['宠物', ['宠物', '猫粮', '狗粮', '猫砂']],
  ['孩子', ['奶粉', '母婴', '玩具', '童装', '纸尿裤']],
  ['人情', ['红包', '转账', '礼物', '份子']],
  ['日用', ['日用品', '纸巾', '洗衣', '清洁', '家居']],
  ['购物', ['淘宝', '天猫', '京东', '拼多多', '唯品会', '超市', '便利店', '商城', '购物', '数码', '服饰', '服装', '货柜', '丰巢', '快递', 'eleven', '7-11', '全家', '罗森', '便利']],
];
const INCOME_KEYWORDS = [
  ['退款', ['退款', '退货']],
  ['工资', ['工资', '薪资', '劳务', '薪']],
  ['理财', ['利息', '基金', '收益', '理财']],
  ['红包', ['红包']],
  ['二手', ['闲鱼', '转转']],
  ['报销', ['报销']],
];

// 支付宝「交易分类」字段是官方已经分好的类，比关键词猜测准得多 —— 优先用它
// 实测取值：餐饮美食 交通出行 医疗健康 日用百货 信用借还 酒店旅游 商业服务 转账红包
//           收入 其他 退款 文化休闲 数码电器 爱车养车 住房物业 家居家装 生活服务 充值缴费
const ALI_CAT = {
  餐饮美食: '餐饮',
  交通出行: '交通',
  医疗健康: '医疗',
  日用百货: '日用',
  数码电器: '购物',
  家居家装: '购物',
  住房物业: '住房',
  爱车养车: '交通',
  酒店旅游: '娱乐',
  文化休闲: '娱乐',
  转账红包: '人情',
  退款: '退款',
  信用借还: 'skip',     // 花呗/借呗还款：钱只是在自己的账户间挪，消费早在付款那笔记过了
  // 下面这些太笼统，交给关键词按商品名细判
  充值缴费: '', 商业服务: '', 生活服务: '', 收入: '', 其他: '',
};

function findCat(type, name) {
  return (S().categories[type] || []).find((x) => x.name === name);
}

// 返回 {id} / {skip:true} / null（null 表示猜不出，交给兜底）
function guessCategory(text, type, kind) {
  if (kind && ALI_CAT[kind] !== undefined) {
    const mapped = ALI_CAT[kind];
    if (mapped === 'skip') return { skip: true };
    if (mapped) { const c = findCat(type, mapped); if (c) return { id: c.id }; }
  }
  const list = type === 'income' ? INCOME_KEYWORDS : KEYWORDS;
  for (const [name, words] of list) {
    if (words.some((w) => text.includes(w))) {
      const c = findCat(type, name);
      if (c) return { id: c.id };
    }
  }
  return null;   // 交给调用方兜底到「其他」
}

// ---- 主流程 ----
const pad = (s) => String(s).padStart(2, '0');

export function parseStatement(text) {
  return parseRows(parseCSV(text));
}

// rows 为二维数组（CSV 或 xlsx 都先归整成这个形状，后面的逻辑共用）
export function parseRows(rows) {
  const hi = findHeaderRow(rows);
  if (hi < 0) throw new Error('没找到表头行 —— 请确认这是微信/支付宝导出的账单文件（要选「用于个人对账」，不要选「用作证明材料」）');
  const map = mapColumns(rows[hi]);
  if (map.amount < 0 || map.inout < 0 || map.time < 0) {
    throw new Error('表头缺少「金额」「收/支」或时间列，无法解析');
  }
  const source = detectSource(rows, hi);
  const out = [];
  for (let i = hi + 1; i < rows.length; i++) {
    const row = rows[i];
    const get = (k) => (map[k] >= 0 ? String(row[map[k]] ?? '').trim() : '');
    // 微信 xlsx 版的时间是 Excel 序列号（46311.536…），CSV 版是字符串日期，两种都要吃
    // 必须先转成日期串再做后面的判断，否则序列号会被当成"不是日期"整行丢掉
    const tm = isExcelSerial(get('time')) ? excelSerialToStr(get('time')) : get('time');
    // 汇总行 / 分隔行：时间列不是日期就到此为止
    if (!/\d{4}[-\/年]\d{1,2}/.test(tm)) continue;
    const status = get('status');
    if (status && SKIP_STATUS.test(status)) continue;          // 退款、关闭的单子不记
    const kind = get('kind');
    if (source === 'wechat' && WX_TRANSFER.some((k) => kind.includes(k))) continue;
    const inout = get('inout');
    let type = null;
    if (inout.includes('支出')) type = 'expense';
    else if (inout.includes('收入')) type = 'income';
    if (!type) continue;                                        // 中性 / 不计收支
    const amount = Math.abs(parseFloat(get('amount').replace(/[¥￥,\s`']/g, '')));
    if (!isFinite(amount) || amount <= 0) continue;

    const dm = tm.match(/(\d{4})[-\/年](\d{1,2})[-\/月](\d{1,2})/);
    if (!dm) continue;
    const clock = tm.match(/(\d{1,2}):(\d{2})/);
    const party = get('party');
    const product = get('product');
    const note = [party, product, get('note')].filter((x) => x && x !== '/').join(' · ');
    // kind（微信红包 / 转账、支付宝的交易分类）也是重要线索，必须参与分类猜测
    const text = (kind + ' ' + party + ' ' + product).toLowerCase();
    const guess = guessCategory(text, type, kind);
    if (guess && guess.skip) continue;                            // 花呗还款这类资金搬家

    out.push({
      type,
      amount: Math.round(amount * 100) / 100,
      date: `${dm[1]}-${pad(dm[2])}-${pad(dm[3])}`,
      time: clock ? `${pad(clock[1])}:${clock[2]}` : '',
      note,
      categoryId: (guess && guess.id) || fallbackCat(type),
      importKey: `${source}:${get('order') || `${tm}|${amount}|${party}`}`,
      source,
      kind,
    });
  }
  return { source, rows: out, headerRow: hi, columns: map };
}

function fallbackCat(type) {
  const list = S().categories[type] || [];
  return (list.find((c) => c.name === '其他') || list[list.length - 1] || {}).id || null;
}

// ---------- xlsx（微信现在导出的是 xlsx，不是 CSV） ----------
// xlsx = zip 包 + XML。浏览器有原生 DecompressionStream 与 DOMParser，不用引第三方库。

// Excel 日期系统以 1899-12-30 为 0 天；25569 是 1970-01-01 对应的序列号
const isExcelSerial = (s) => /^\d{4,6}(\.\d+)?$/.test(String(s).trim());
export function excelSerialToStr(serial) {
  const n = Number(serial);
  if (!isFinite(n)) return String(serial);
  const d = new Date(Math.round((n - 25569) * 86400 * 1000));
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} `
    + `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
}

// 最小 ZIP 读取器：只解析 central directory，够用来取 xlsx 的两个 XML
async function readZipEntry(buf, want) {
  const dv = new DataView(buf);
  const u8 = new Uint8Array(buf);
  let eocd = -1;
  const floor = Math.max(0, u8.length - 65558);
  for (let i = u8.length - 22; i >= floor; i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('不是有效的 xlsx 文件');
  const count = dv.getUint16(eocd + 10, true);
  let off = dv.getUint32(eocd + 16, true);
  let hit = null;
  for (let i = 0; i < count; i++) {
    if (off + 46 > u8.length || dv.getUint32(off, true) !== 0x02014b50) break;
    const method = dv.getUint16(off + 10, true);
    const compSize = dv.getUint32(off + 20, true);
    const nameLen = dv.getUint16(off + 28, true);
    const extraLen = dv.getUint16(off + 30, true);
    const cmtLen = dv.getUint16(off + 32, true);
    const lhOff = dv.getUint32(off + 42, true);
    const name = new TextDecoder().decode(u8.subarray(off + 46, off + 46 + nameLen));
    if (name === want) hit = { method, compSize, lhOff };
    off += 46 + nameLen + extraLen + cmtLen;
    if (hit) break;
  }
  if (!hit) throw new Error('xlsx 里找不到 ' + want);
  const nameLen = dv.getUint16(hit.lhOff + 26, true);
  const extraLen = dv.getUint16(hit.lhOff + 28, true);
  const start = hit.lhOff + 30 + nameLen + extraLen;
  const data = u8.subarray(start, start + hit.compSize);
  if (hit.method === 0) return data;
  if (hit.method !== 8) throw new Error('不支持的压缩方式');
  if (typeof DecompressionStream !== 'function') {
    throw new Error('当前浏览器不支持解压 xlsx —— 请用 Excel/WPS 把账单另存为 CSV 再导入');
  }
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

const colIdx = (s) => {
  let n = 0;
  for (const ch of s) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
};
const localTag = (el, tag) => {
  for (const c of el.children) if ((c.localName || c.tagName) === tag) return c;
  return null;
};
// <si> 里可能带 <rPh>（拼音注释），必须只取 <t> 与 <r><t>，否则文本会被拼音污染
function siText(si) {
  let s = '';
  for (const c of si.children) {
    const tag = c.localName || c.tagName;
    if (tag === 't') s += c.textContent;
    else if (tag === 'r') { const t = localTag(c, 't'); if (t) s += t.textContent; }
  }
  return s;
}

export async function parseXlsx(buf) {
  const parseXML = (bytes) => {
    const doc = new DOMParser().parseFromString(new TextDecoder('utf-8').decode(bytes), 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) throw new Error('xlsx 内部 XML 解析失败');
    return doc;
  };
  const ssDoc = parseXML(await readZipEntry(buf, 'xl/sharedStrings.xml'));
  const ss = [...ssDoc.getElementsByTagName('si')].map(siText);

  const shDoc = parseXML(await readZipEntry(buf, 'xl/worksheets/sheet1.xml'));
  const out = [];
  for (const r of shDoc.getElementsByTagName('row')) {
    const arr = [];
    for (const c of r.getElementsByTagName('c')) {
      const idx = colIdx((c.getAttribute('r') || '').replace(/\d/g, ''));
      const t = c.getAttribute('t');
      let val = '';
      const v = localTag(c, 'v');
      if (t === 's') val = (v && ss[+v.textContent] !== undefined) ? ss[+v.textContent] : '';
      else if (t === 'inlineStr') { const is = localTag(c, 'is'); if (is) val = siText(is); }
      else if (v) val = v.textContent;
      while (arr.length < idx) arr.push('');
      arr[idx] = val;
    }
    if (arr.some((x) => String(x).trim() !== '')) out.push(arr);
  }
  return parseRows(out);
}

// 已存在（同平台同流水号）的挑出来，避免重复导入记两遍
export function filterExisting(rows) {
  const seen = new Set(S().bills.map((b) => b.importKey).filter(Boolean));
  const fresh = []; let dup = 0;
  rows.forEach((r) => { if (seen.has(r.importKey)) dup++; else { seen.add(r.importKey); fresh.push(r); } });
  return { fresh, dup };
}

export function summarize(rows) {
  const exp = rows.filter((r) => r.type === 'expense');
  const inc = rows.filter((r) => r.type === 'income');
  const sum = (a) => a.reduce((s, r) => s + r.amount, 0);
  const dates = rows.map((r) => r.date).sort();
  return {
    count: rows.length,
    expenseCount: exp.length, incomeCount: inc.length,
    expenseSum: sum(exp), incomeSum: sum(inc),
    from: dates[0] || '', to: dates[dates.length - 1] || '',
  };
}
