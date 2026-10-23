// 微信 / 支付宝账单导入页：选文件 → 自动识别 → 预览确认 → 写入
import Icons from '../icons.js';
import { S, save, uid, catById, fmtMoney } from '../store.js';
import { go, UI } from '../app.js';
import { catMarkHTML, accMarkHTML } from '../caticon.js';
import { decodeText, parseStatement, parseXlsx, filterExisting, findSimilar, summarize } from '../importers.js';

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
  input.accept = '.csv,.txt,.xlsx,text/csv,text/plain';
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      if (/\.xls$/i.test(file.name)) throw new Error('不支持老的 .xls 格式，请用 Excel/WPS 另存为 .xlsx 或 CSV');
      const buf = await file.arrayBuffer();
      // 微信现在导出 xlsx（zip+XML），支付宝是 CSV（GBK）—— 按扩展名分流
      const parsed = /\.xlsx$/i.test(file.name)
        ? await parseXlsx(buf)
        : parseStatement(decodeText(buf));
      if (!parsed.rows.length) throw new Error('没解析出任何有效交易，请检查文件内容');
      const { fresh, dup } = filterExisting(parsed.rows);
      // 二次去重：本机手动记的账没有流水号，靠 金额+日期 找可疑重复
      const { unique, similar } = findSimilar(fresh, S().bills);
      draft = { ...parsed, fresh, dup, unique, similar, skipSimilar: true, accountId: defaultAccount(parsed.source) };
      go('importcsv');
    } catch (e) {
      UI.toast('解析失败：' + e.message, 4200);
    }
  });
  input.click();
}

// 开关行：input 设为 disabled，点击统一由外层 .cell 接收
const swRow = (o) => `<div class="cell" data-act="${o.act}">
  <span class="ci" style="background:${o.bg || 'var(--card2)'}">${o.icon}</span>
  <span class="cl">${o.label}<span class="cell-sub">${o.sub}</span></span>
  <label class="switch"><input type="checkbox" ${o.on ? 'checked' : ''} disabled><i></i></label>
</div>`;

function previewRows() {
  const show = (draft.skipSimilar ? draft.unique : draft.fresh).slice(0, 12);
  return show.map((r) => {
    const c = catById(r.categoryId);
    return `<div class="cell">
      ${catMarkHTML({ name: (c && c.name) || '', parent: c && c.parent, icon: (c && c.icon) || '🧾', color: (c && c.color) || '#98989f', type: c && c.type, cls: 'ci' })}
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
          <b>用于个人对账</b>，得到 <b>.xlsx</b> 文件（也可解压 CSV）。<br><br>
          <b>支付宝</b>：我的 → 账单 → 右上角 → 开具交易流水证明 → <b>用于个人对账</b>；
          或电脑网页版「服务大厅 → 自助服务 → 交易记录」导出。<br><br>
          <span style="color:var(--orange,#ff9f0a)">注意：选「用作证明材料」导出的是带公章的 PDF，解析不了 —— 必须选「用于个人对账」。</span>
        </div>

        <div class="sec-title">选择文件</div>
        <div class="cell-group">
          <div class="cell" data-act="pick">
            <span class="ci" style="background:rgba(48,209,88,.18)">📄</span>
            <span class="cl">选择账单文件<span class="cell-sub">支持 .xlsx 与 .csv，自动识别微信 / 支付宝，自动判断 UTF-8 或 GBK</span></span>
            <span class="arrow">${Icons.chevR}</span>
          </div>
        </div>

        <div class="st2-note">
          <div class="tt">🧹 重复的两笔不会记成四笔</div>
          <b>同一份账单导两次</b>：靠微信/支付宝的交易单号识别，自动跳过。<br>
          <b>和你手动记过的账撞了</b>：按「金额 + 日期」比对，标记为疑似重复并默认跳过，你也可以在下面对照后选择全部导入。<br><br>
          <span style="color:var(--orange,#ff9f0a)">导入前先等自动同步完成（打开 App 约 2 秒），这样本机拿到的是全部设备的最新账，去重才准。</span>
        </div>`;
    }

    const use = draft.skipSimilar ? draft.unique : draft.fresh;
    const s = summarize(use);
    const acc = S().accounts.find((a) => a.id === draft.accountId);
    return `
      <div class="st2-note">
        <div class="tt">✅ 识别为${SRC_CN[draft.source]}账单</div>
        实际导入 <b>${use.length}</b> 笔 · 支出 ${s.expenseCount} 笔 ¥${fmtMoney(s.expenseSum)}
        · 收入 ${s.incomeCount} 笔 ¥${fmtMoney(s.incomeSum)}<br>
        时间范围：${s.from} ~ ${s.to}
        ${draft.dup ? `<br><span style="color:var(--orange,#ff9f0a)">已导入过 ${draft.dup} 笔（流水号相同），自动跳过</span>` : ''}
        ${draft.similar.length ? `<br><span style="color:var(--orange,#ff9f0a)">疑似重复 ${draft.similar.length} 笔（金额+日期与本机已有的账撞了），默认跳过</span>` : ''}
      </div>

      <div class="sec-title">导入设置</div>
      <div class="cell-group">
        <div class="cell" data-act="account">
          ${accMarkHTML({ name: acc && acc.name, icon: (acc && acc.icon) || '💳', color: (acc && acc.color) || '#98989f', type: acc && acc.type, cls: 'ci' })}
          <span class="cl">导入到账户<span class="cell-sub">点此更换</span></span>
          <span class="cv">${(acc && acc.name) || '未选择'}</span>
        </div>
        ${draft.similar.length ? swRow({
          icon: '🧹', bg: 'rgba(255,159,10,.18)',
          label: '跳过疑似重复',
          sub: `${draft.similar.length} 笔与本机已有账金额、日期都相同，关掉则全部导入`,
          act: 'toggle-skip', on: draft.skipSimilar,
        }) : ''}
      </div>

      ${draft.similar.length ? `
      <div class="sec-title">疑似重复对照（前 5 笔）</div>
      <div class="cell-group">
        ${draft.similar.slice(0, 5).map((x) => `<div class="cell">
          <span class="ci" style="background:rgba(255,159,10,.18)">⚠️</span>
          <span class="cl">${x.bill.date} ¥${fmtMoney(x.bill.amount)}<span class="cell-sub">本机已有：${x.match.note || x.match.date} · ¥${fmtMoney(x.match.amount)}</span></span>
          <span class="cv">${x.bill.note || '—'}</span>
        </div>`).join('')}
      </div>` : ''}

      <div class="sec-title">前 ${Math.min(12, use.length)} 笔预览${use.length > 12 ? `（共 ${use.length} 笔）` : ''}</div>
      <div class="cell-group">${previewRows()}</div>

      <div style="padding:16px 8px 0">
        <button class="join-btn" data-act="do">确认导入 ${use.length} 笔</button>
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
        } else if (act === 'toggle-skip') {
          draft.skipSimilar = !draft.skipSimilar; go('importcsv');
        } else if (act === 'do') {
          if (!draft.accountId) { UI.toast('先选一个账户'); return; }
          const st = S();
          const now = Date.now();
          const use = draft.skipSimilar ? draft.unique : draft.fresh;
          use.forEach((r, i) => {
            st.bills.push({
              id: uid(), bookId: st.currentBookId, created: now + i, updatedAt: now + i,
              type: r.type, amount: r.amount, date: r.date, time: r.time,
              note: r.note, categoryId: r.categoryId, accountId: draft.accountId,
              images: [], tags: [], importKey: r.importKey,
            });
          });
          save();
          const n = use.length;
          const skipped = draft.fresh.length - use.length;
          draft = null;
          UI.toast(skipped ? `已导入 ${n} 笔，跳过 ${skipped} 笔重复` : `已导入 ${n} 笔账单`);
          go('home');
        }
      });
    });
  },
};
