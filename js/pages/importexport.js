// 账单导入导出：CSV / JSON 备份 + 恢复 + 危险区
import Icons from '../icons.js';
import { S, save, reset, catById, accById } from '../store.js';
import { go, UI } from '../app.js';

const TYPE_CN = { expense: '支出', income: '收入', transfer: '转账' };
const CLAIM_CN = { pending: '待报销', done: '已报销' };

function download(filename, text, mime) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;

function toCSV(bills) {
  const head = ['类型', '金额', '分类', '账户', '日期', '时间', '备注', '报销'];
  const rows = bills.map((b) => {
    const c = catById(b.categoryId);
    const a = accById(b.accountId);
    return [
      TYPE_CN[b.type] || b.type,
      (+b.amount || 0).toFixed(2),
      c?.name || '其他',
      a?.name || '',
      b.date || '',
      b.time || '',
      b.note || '',
      b.claim ? (CLAIM_CN[b.claim] || b.claim) : '',
    ];
  });
  // \ufeff BOM：保证 Excel 打开中文不乱码
  return '\ufeff' + [head, ...rows].map((r) => r.map(q).join(',')).join('\r\n');
}

function exportCSV() {
  const bills = S().bills;
  if (!bills.length) { UI.toast('暂无账单可导出'); return; }
  download('icost-bills.csv', toCSV(bills), 'text/csv;charset=utf-8');
  UI.toast(`已导出 ${bills.length} 笔账单`);
}

function exportJSON() {
  download('icost-backup.json', JSON.stringify(S(), null, 2), 'application/json');
  UI.toast('已导出 JSON 备份');
}

function isValidBackup(data) {
  return !!data && typeof data === 'object'
    && Array.isArray(data.bills) && Array.isArray(data.books)
    && Array.isArray(data.accounts)
    && data.categories && data.categories.expense && data.categories.income;
}

async function importJSON() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'application/json,.json';
  input.addEventListener('change', () => {
    const file = input.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      let data;
      try { data = JSON.parse(String(reader.result)); }
      catch { UI.toast('文件解析失败，请选择正确的 JSON 备份'); return; }
      if (!isValidBackup(data)) { UI.toast('备份格式校验失败，缺少必要字段'); return; }
      const ok = await UI.confirm(`将用备份覆盖当前数据（${data.bills.length} 笔账单），确认继续？`, '覆盖导入');
      if (!ok) return;
      const st = S();
      ['books', 'categories', 'accounts', 'bills', 'budgets', 'savings', 'templates', 'recurrings', 'loans', 'claims', 'settings', 'currentBookId']
        .forEach((k) => { if (data[k] !== undefined) st[k] = data[k]; });
      save();
      UI.toast('导入成功');
      go('home');
    };
    reader.onerror = () => UI.toast('读取文件失败');
    reader.readAsText(file, 'utf-8');
  });
  input.click();
}

async function clearAll() {
  const first = await UI.confirm('将清空全部数据（含账单、账本、分类、资产），且无法恢复。确定继续？', '继续');
  if (!first) return;
  const second = await UI.confirm('再次确认：立即删除本机所有数据？', '清空');
  if (!second) return;
  reset();
  UI.toast('已清空全部数据');
  go('home');
}

const row = (o) => `<div class="cell" data-act="${o.act}">
  <span class="ci" style="background:${o.bg || 'var(--card2)'}">${o.icon}</span>
  <span class="cl${o.danger ? ' st2-danger' : ''}">${o.label}${o.sub ? `<span class="cell-sub">${o.sub}</span>` : ''}</span>
  <span class="arrow">${Icons.chevR}</span>
</div>`;

export default {
  title: '导入导出',
  header: 'sub',
  async render() {
    const n = S().bills.length;
    return `
      <div class="st2-note">
        <div class="tt">📦 账单迁移说明</div>
        支持从微信 / 支付宝导出的账单迁移：先在对应 App 中申请账单邮件，得到 CSV 文件后，整理为本页导出的列格式
        （类型、金额、分类、账户、日期、时间、备注、报销），即可恢复。复刻版演示以 JSON 备份恢复为主。
      </div>

      <div class="sec-title">导出 · 共 ${n} 笔账单</div>
      <div class="cell-group">
        ${row({ icon: '📊', bg: 'rgba(48,209,88,.18)', label: '导出 CSV', sub: 'icost-bills.csv · Excel 可直接打开', act: 'csv' })}
        ${row({ icon: '🗂️', bg: 'rgba(10,132,255,.18)', label: '导出 JSON 备份', sub: 'icost-backup.json · 完整数据', act: 'json' })}
        ${row({ icon: '📈', bg: 'rgba(255,159,10,.18)', label: '导出 Excel', sub: '复刻版以 CSV 代替', act: 'excel' })}
      </div>

      <div class="sec-title">导入</div>
      <div class="cell-group">
        ${row({ icon: '📥', bg: 'rgba(191,90,242,.18)', label: '导入 JSON 备份', sub: '校验后覆盖当前数据', act: 'importjson' })}
        ${row({ icon: '📄', bg: 'rgba(100,210,255,.18)', label: '导入表格 CSV', sub: '微信 / 支付宝账单', act: 'importcsv' })}
      </div>

      <div class="sec-title">危险区</div>
      <div class="cell-group">
        ${row({ icon: '🗑️', bg: 'rgba(255,69,58,.18)', label: '清空全部数据', danger: true, act: 'clear' })}
      </div>

      <div class="st2-note">
        <div class="tt">💡 提示</div>
        导出文件保存在浏览器下载目录；iOS Safari 可能需要在「下载」中手动查看。建议每月导出一次 JSON 备份。
      </div>`;
  },
  mount(root) {
    root.querySelectorAll('[data-act]').forEach((el) => {
      el.addEventListener('click', () => {
        const act = el.dataset.act;
        if (act === 'csv') exportCSV();
        else if (act === 'json') exportJSON();
        else if (act === 'excel') UI.toast('复刻版以 CSV 代替');
        else if (act === 'importjson') importJSON();
        else if (act === 'importcsv') UI.toast('复刻版支持 JSON 备份恢复');
        else if (act === 'clear') clearAll();
      });
    });
  },
};
