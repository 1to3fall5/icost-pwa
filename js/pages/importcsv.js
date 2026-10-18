// 微信 / 支付宝账单导入页：选文件 → 自动识别 → 预览确认 → 写入
import Icons from '../icons.js';
import { S, save, uid, catById, fmtMoney } from '../store.js';
import { go, UI } from '../app.js';
import { decodeText, parseStatement, filterExisting, summarize } from '../importers.js';

let draft = null;   // 解析结果（页面级临时状态，离开即弃）

const SRC_CN = { wechat: '微信', alipay: '支付宝', unknown: '未知来源' };

function defaultAccount(source) {
  const list = S().accounts.filter((a) => !a.archived);
  const want = source === 'wechat' ? '微信' : source === 'alipay' ? '支付宝' : '';
  const hit = list.find((a) => a.name.includes(want));
  return (hit || list[0] || {}).id || '';
}

async function pickFile() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.csv,.txt,text/csv,text/plain';
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      const text = decodeText(await file.arrayBuffer());
      const parsed = parseStatement(text);
      if (!parsed.rows.length) throw new Error('没解析出任何有效交易，请检查文件内容');
      const { fresh, dup } = filterExisting(parsed.rows);
      draft = { ...parsed, fresh, dup, accountId: defaultAccount(parsed.source) };
      go('importcsv');
    } catch (e) {
      UI.toast('解析失败：' + e.message, 4200);
    }
  });
  input.click();
}

function previewRows() {
  const show = draft.fresh.slice(0, 12);
  return show.map((r) => {
    const c = catById(r.categoryId);
    return `<div class="cell">
      <span class="ci" style="background:${(c && c.color) || '#2c2c2e'}">${(c && c.icon) || '🧾'}</span>
      <span class="cl">${(c && c.name) || '其他'}<span class="cell-sub">${r.date} ${r.time} ${r.note || '—'}</span></span>
      <span class="cv">${r.type === 'expense' ? '-' : '+'}${fmtMoney(r.amount)}</span>
    </div>`;
  }).join('');
}

export default {
  title: '导入账单',
  header: 'sub',
  async render() {
    if (!draft) {
      return `
        <div class="st2-note">
          <div class="tt">先从 App 里导出账单</div>
          <b>微信</b>：我 → 服务 → 钱包 → 账单 → 右上角「常见问题」→ 下载账单 → 选
          <b>用于个人对账</b> → 填邮箱，收到压缩包用解压码解开，得到 CSV。<br><br>
          <b>支付宝</b>：我的 → 账单 → 右上角 → 开具交易流水证明 → <b>用于个人对账</b>；
          或电脑网页版「服务大厅 → 自助服务 → 交易记录」导出。<br><br>
          <span style="color:var(--orange,#ff9f0a)">注意：选「用作证明材料」导出的是带公章的 PDF，解析不了 —— 必须选「用于个人对账」。</span>
        </div>

        <div class="sec-title">选择文件</div>
        <div class="cell-group">
          <div class="cell" data-act="pick">
            <span class="ci" style="background:rgba(48,209,88,.18)">📄</span>
            <span class="cl">选择账单 CSV<span class="cell-sub">自动识别微信 / 支付宝，自动判断 UTF-8 或 GBK 编码</span></span>
            <span class="arrow">${Icons.chevR}</span>
          </div>
        </div>

        <div class="st2-note">
          <div class="tt">💡 会怎么处理</div>
          只导入<b>支出和收入</b>，退款与已关闭的交易会跳过；微信的零钱提现、信用卡还款这类「自己账户间转账」不算消费，也会跳过。
          同一份账单重复导入不会记两遍。
        </div>`;
    }

    const s = summarize(draft.fresh);
    const acc = S().accounts.find((a) => a.id === draft.accountId);
    return `
      <div class="st2-note">
        <div class="tt">✅ 识别为${SRC_CN[draft.source]}账单</div>
        可导入 <b>${draft.fresh.length}</b> 笔 · 支出 ${s.expenseCount} 笔 ¥${fmtMoney(s.expenseSum)}
        · 收入 ${s.incomeCount} 笔 ¥${fmtMoney(s.incomeSum)}<br>
        时间范围：${s.from} ~ ${s.to}
        ${draft.dup ? `<br><span style="color:var(--orange,#ff9f0a)">另有 ${draft.dup} 笔已存在，将自动跳过</span>` : ''}
      </div>

      <div class="sec-title">导入设置</div>
      <div class="cell-group">
        <div class="cell" data-act="account">
          <span class="ci" style="background:${(acc && acc.color) || '#2c2c2e'}">${(acc && acc.icon) || '💳'}</span>
          <span class="cl">导入到账户<span class="cell-sub">点此更换</span></span>
          <span class="cv">${(acc && acc.name) || '未选择'}</span>
        </div>
      </div>

      <div class="sec-title">前 ${Math.min(12, draft.fresh.length)} 笔预览${draft.fresh.length > 12 ? `（共 ${draft.fresh.length} 笔）` : ''}</div>
      <div class="cell-group">${previewRows()}</div>

      <div style="padding:16px 8px 0">
        <button class="join-btn" data-act="do">确认导入 ${draft.fresh.length} 笔</button>
        <button class="join-btn" data-act="again" style="margin-top:10px;background:var(--card3);color:var(--text)">重新选择文件</button>
      </div>

      <div class="st2-note" style="margin-top:16px">
        <div class="tt">不会改动账户余额</div>
        导入的是历史流水，你的余额里早就体现了这些消费 —— 再扣一次就是重复记账。
        如果这些是尚未记过的新账，导入后请手动调整对应账户余额。
      </div>`;
  },
  mount(root) {
    root.querySelectorAll('[data-act]').forEach((el) => {
      el.addEventListener('click', async () => {
        const act = el.dataset.act;
        if (act === 'pick' || act === 'again') { draft = null; if (act === 'again') go('importcsv'); pickFile(); }
        else if (act === 'account') {
          const list = S().accounts.filter((a) => !a.archived);
          const pick = await UI.sheet('导入到哪个账户', list.map((a) => ({
            label: a.name, value: '', icon: a.icon, color: a.color, id: a.id,
          })));
          if (pick) { draft.accountId = pick.id; go('importcsv'); }
        } else if (act === 'do') {
          if (!draft.accountId) { UI.toast('先选一个账户'); return; }
          const st = S();
          const now = Date.now();
          draft.fresh.forEach((r, i) => {
            st.bills.push({
              id: uid(), bookId: st.currentBookId, created: now + i, updatedAt: now + i,
              type: r.type, amount: r.amount, date: r.date, time: r.time,
              note: r.note, categoryId: r.categoryId, accountId: draft.accountId,
              images: [], tags: [], importKey: r.importKey,
            });
          });
          save();
          const n = draft.fresh.length;
          draft = null;
          UI.toast(`已导入 ${n} 笔账单`);
          go('home');
        }
      });
    });
  },
};
