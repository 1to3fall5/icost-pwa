/**
 * 固定支出 + 可支配金额
 *
 * 这套东西解决的是「记账之外更有用的那件事」：
 *   每月收入 − 固定支出（停车费、水电、房租…）＝ 可分配
 *   可分配 里再划出一块「每月可用额度」（计划要花的）
 *   剩下的 ＝ 这个月大概能存多少
 *
 * 固定支出之所以要从账单里单拎出来，是因为它「每月都会发生、金额基本不变」——
 * 它不参与「我这个月还剩多少能花」的判断，只参与「我已经花掉多少」。
 * 一旦和日常消费混在一起，数字就没法指导消费决策了。
 *
 * 归集：给每项固定支出配 keywords，导入的账单备注命中即算「本月已缴」，
 * 这样不用手动勾，也不用再记一遍（导入的账才是真金白银的流水）。
 */
import { S, curBook, bookBills, monthOf, today, round2 } from './store.js';

export const CYCLES = [['month', '每月'], ['quarter', '每季'], ['year', '每年']];
export const CYCLE_LABEL = { month: '每月', quarter: '每季', year: '每年' };

/** 任意周期 → 每月摊多少（季度 /3，年 /12，保留两位） */
export const monthAmount = (f) => {
  const a = Number(f?.amount) || 0;
  if (f?.cycle === 'quarter') return round2(a / 3);
  if (f?.cycle === 'year') return round2(a / 12);
  return round2(a);
};

/** 生效中的固定支出项（active 缺省为 true，兼容老数据） */
export const activeFixed = () => (S().fixedCosts || []).filter((f) => f && f.active !== false);

/** 账单备注命中任一词即归到该项；大小写不敏感 */
export function matchFixed(f, bill) {
  const words = (f?.keywords || []).filter(Boolean).map((w) => String(w).trim().toLowerCase()).filter(Boolean);
  if (!words.length) return false;
  const text = String(bill?.note || '').toLowerCase();
  return words.some((w) => text.includes(w));
}

const sum = (arr) => arr.reduce((s, x) => s + (Number(x) || 0), 0);

/**
 * 某月的固定支出逐项状态。
 * 注意：一笔账单只归到第一个命中的固定项（按列表顺序），
 * 否则「水电」和「电力」两个词同时命中同一笔，金额会被算两遍。
 */
export function fixedItems(ym, bills) {
  const list = bills || (curBook() ? bookBills(curBook().id, ym) : []);
  const expense = list.filter((b) => b.type === 'expense');
  const taken = new Set();     // 已归集的账单 id
  return activeFixed().map((f) => {
    const plan = monthAmount(f);
    const hits = expense.filter((b) => !taken.has(b.id) && matchFixed(f, b));
    hits.forEach((b) => taken.add(b.id));
    const paid = round2(sum(hits.map((b) => b.amount)));
    return {
      item: f,
      plan,
      paid,
      // 差 1 元以内算已缴（水电每月都会浮动几毛）
      state: paid <= 0 ? 'unpaid' : (plan - paid > 1 ? 'partial' : 'paid'),
    };
  });
}

/**
 * 某月汇总。所有数字都 round2，避免 0.1+0.2 那类浮点尾巴出现在界面上。
 * 口径：
 *   income      本月收入（工资等）
 *   fixedPlan   固定支出月摊合计
 *   fixedPaid   其中已缴（按计划封顶，多缴的部分算回浮动支出）
 *   flex        浮动支出 = 本月总支出 − 固定已缴（两者相加 = 本月总支出）
 *   allocatable 可分配 = 收入 − 固定支出
 *   cap         每月可用额度（没设则默认 = 可分配）
 *   left        还能花 = 额度 − 浮动支出
 *   expectSave  预计可存 = 可分配 − 额度
 *   actualSave  实际存下 = 收入 − 本月总支出
 */
export function monthly(ym = monthOf(today()), bookId = null) {
  const bid = bookId || (curBook() ? curBook().id : null);
  const list = bid ? bookBills(bid, ym) : S().bills.filter((b) => b.date.startsWith(ym));
  const income = round2(sum(list.filter((b) => b.type === 'income').map((b) => b.amount)));
  const expense = round2(sum(list.filter((b) => b.type === 'expense').map((b) => b.amount)));

  const items = fixedItems(ym, list);
  const fixedPlan = round2(sum(items.map((i) => i.plan)));
  const matched = round2(sum(items.map((i) => i.paid)));
  // 已缴按计划封顶：某项月摊 300、实付 380，多出的 80 仍算浮动支出
  const fixedPaid = round2(sum(items.map((i) => Math.min(i.paid, i.plan))));
  // 用「封顶后的已缴」而不是实际归集额去减，否则超缴的那部分会从「固定」和「浮动」里同时消失，
  // 导致 fixedPaid + flex ≠ 本月总支出
  const flex = round2(Math.max(0, expense - fixedPaid));

  const allocatable = round2(income - fixedPlan);
  const capRaw = Number(S().settings?.spendCap) || 0;
  const cap = capRaw > 0 ? round2(capRaw) : Math.max(0, allocatable);

  return {
    ym,
    income,
    expense,
    fixedPlan,
    fixedPaid,
    flex,
    items,
    allocatable,
    cap,
    capIsDefault: capRaw <= 0,
    left: round2(cap - flex),
    expectSave: round2(allocatable - cap),
    actualSave: round2(income - expense),
    unpaid: items.filter((i) => i.state !== 'paid'),
  };
}

// ---- 增删改（页面层别自己拼对象，updatedAt 丢了同步会看不见改动） ----
export function addFixed(data) {
  const now = Date.now();
  const f = {
    id: 'fx' + now.toString(36) + Math.random().toString(36).slice(2, 5),
    name: '', amount: 0, cycle: 'month', categoryId: '', keywords: [],
    active: true, note: '', created: now, updatedAt: now, ...data,
  };
  S().fixedCosts.push(f);
  return f;
}
export function updateFixed(id, patch) {
  const f = (S().fixedCosts || []).find((x) => x.id === id);
  if (f) Object.assign(f, patch, { updatedAt: Date.now() });
  return f;
}
export function removeFixed(id) {
  const arr = S().fixedCosts || [];
  const i = arr.findIndex((x) => x.id === id);
  if (i < 0) return null;
  const [gone] = arr.splice(i, 1);
  return gone;
}
