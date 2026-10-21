// 贷款和分期：贷款列表 / 还款进度 / 记一笔还款
import { S, cats, addBill, uid, fmtMoney, save } from '../store.js';
import { esc } from '../util.js';
import { UI } from '../app.js';

const today = () => new Date().toISOString().slice(0, 10);

function refresh() {
  const screen = document.getElementById('screen');
  Promise.resolve(mod.render()).then((html) => {
    screen.innerHTML = html;
    mod.mount(screen);
  });
}

function tipCard() {
  return `
  <div class="card">
    <div class="card-title-row"><span class="badge-ic" style="background:#0a84ff22">💰</span><span class="card-title">功能说明</span></div>
    <div class="ln-tip">
      <div class="ln-tip-row"><b>贷款记录</b>记录房贷、车贷等长期贷款，按月跟踪还款进度。</div>
      <div class="ln-tip-row"><b>消费分期</b>大额消费分期，记录每期金额与剩余期数。</div>
      <div class="ln-tip-row"><b>账单分期</b>信用卡账单分期，随时查看已还比例。</div>
    </div>
  </div>`;
}

function loanCard(l) {
  const months = +l.months || 0;
  const paid = +l.paid || 0;
  const left = Math.max(0, months - paid);
  const paidAmt = Math.min(paid * (+l.monthAmount || 0), +l.total || 0);
  const pct = months ? Math.min(100, (paid / months) * 100) : 0;
  const color = l.done ? 'var(--green)' : 'var(--blue)';
  return `
  <div class="card ln-card" data-loan="${l.id}">
    <div class="row1">
      <span class="nm">${esc(l.name)}${l.done ? '<span class="ad-badge-done">已还清</span>' : ''}</span>
      <button class="ln-pay" data-pay="${l.id}">记一笔还款</button>
    </div>
    <div class="progress"><i style="width:${pct}%;background:${color}"></i></div>
    <div class="ln-meta">
      <span>已还 ¥${fmtMoney(paidAmt)} / ¥${fmtMoney(l.total)}</span>
      <span>剩余 ${left} 期</span>
    </div>
    <div class="ln-meta" style="margin-top:6px">
      <span>月供 ¥${fmtMoney(l.monthAmount)} · 共 ${months} 期 · 已还 ${paid} 期</span>
      <span>${l.startDate || ''}</span>
    </div>
  </div>`;
}

// 记一笔还款：生成支出账单（分类「其他」）并推进期数
async function payOnce(l) {
  if ((+l.paid || 0) >= (+l.months || 0)) return UI.toast('该贷款已还清 ✓');
  const accs = S().accounts.filter((a) => !a.archived && !a.hidden);
  if (!accs.length) return UI.toast('请先在资产页添加一个账户');
  const cat = cats('expense').find((c) => c.name === '其他') || cats('expense')[0];
  const next = (+l.paid || 0) + 1;
  addBill({
    type: 'expense',
    amount: +l.monthAmount || 0,
    categoryId: cat?.id || '',
    accountId: accs[0].id,
    date: today(),
    note: `${l.name} 第 ${next}/${l.months} 期还款`,
  });
  l.paid = next;
  if (l.paid >= (+l.months || 0)) l.done = true;
  save();
  UI.toast(l.done ? '已还清，恭喜 🎉' : `已记录第 ${next} 期还款 ✓`);
  refresh();
}

async function newLoan() {
  const name = await UI.prompt('贷款名称', '如：房贷 / 车贷 / 手机分期');
  if (!name) return;
  const total = parseFloat(await UI.prompt('贷款总额', '0.00', '', 'number'));
  if (!(total > 0)) return UI.toast('请输入正确的总额');
  const months = parseInt(await UI.prompt('总期数', '如：24', '12', 'number'), 10);
  if (!(months > 0)) return UI.toast('请输入正确的期数');
  const monthAmount = parseFloat(await UI.prompt('每期还款金额', '0.00', (total / months).toFixed(2), 'number'));
  if (!(monthAmount > 0)) return UI.toast('请输入正确的月供');
  const startDate = (await UI.prompt('开始日期', '', today(), 'date')) || today();
  S().loans.push({ id: uid(), name, total, months, monthAmount, startDate, paid: 0, done: false });
  save();
  UI.toast('已添加贷款 ✓');
  refresh();
}

const mod = {
  header: 'sub',
  title: '贷款和分期',

  render() {
    const list = S().loans || [];
    return `
      ${tipCard()}
      <div class="sec-title">我的贷款</div>
      ${list.length ? list.map(loanCard).join('') : `<div class="empty-tip">暂无数据 · 添加一笔贷款开始记录</div>`}
      <button class="ln-add" data-act="add">+ 新建贷款</button>`;
  },

  mount(root) {
    root.querySelectorAll('[data-pay]').forEach((b) =>
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        const l = (S().loans || []).find((x) => x.id === b.dataset.pay);
        if (l) payOnce(l);
      }));

    root.querySelectorAll('[data-loan]').forEach((el) =>
      el.addEventListener('click', async () => {
        const l = (S().loans || []).find((x) => x.id === el.dataset.loan);
        if (!l) return;
        const pick = await UI.sheet(l.name, [
          { label: '记一笔还款', icon: '💸', onClick: () => payOnce(l) },
          { label: '删除贷款', icon: '🗑️', onClick: async () => {
            const ok = await UI.confirm(`删除「${l.name}」？已记录的还款账单会保留`, '删除');
            if (!ok) return;
            S().loans = S().loans.filter((x) => x.id !== l.id);
            save();
            UI.toast('已删除');
            refresh();
          } },
        ]);
        pick?.onClick?.();
      }));

    root.querySelector('[data-act="add"]')?.addEventListener('click', newLoan);
  },
};

export default mod;
