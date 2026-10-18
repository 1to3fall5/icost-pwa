// 账单导入导出：CSV / JSON 备份 + 恢复 + 危险区
import Icons from '../icons.js';
import { S, save, reset, catById, accById } from '../store.js';
import { go, UI } from '../app.js';
import {
  syncCfg, setSync, pushSync, pullSync, applyRemote,
  hasPassword, setPassword, fmtTime,
} from '../sync.js';

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

// ================= 云同步（端到端加密 + GitHub Secret Gist） =================
const ghTokenUrl = 'https://github.com/settings/tokens/new';

async function ensurePassword() {
  if (hasPassword()) return true;
  const pw = await UI.prompt('同步密码', '用于加密上传的数据，遗忘无法恢复', '', 'password');
  if (!pw) return false;
  if (pw.length < 4) { UI.toast('密码太短了'); return false; }
  setPassword(pw);
  return true;
}

async function doPush() {
  try {
    if (!(await ensurePassword())) return;
    UI.toast('正在加密并上传…', 3000);
    const r = await pushSync();
    UI.toast(`已上传 ${Math.max(1, Math.round(r.size / 1024))}KB 密文`);
    go('importexport'); // 同 hash 会强制重渲染，刷新状态行
  } catch (e) { UI.toast('上传失败：' + e.message, 3200); }
}

async function doPull() {
  try {
    if (!(await ensurePassword())) return;
    UI.toast('正在从云端拉取…', 3000);
    const r = await pullSync();
    const ok = await UI.confirm(
      `云端 ${r.bills} 笔账单（更新于 ${r.updatedAt}）\n将覆盖本机当前 ${S().bills.length} 笔，确认继续？`,
      '覆盖本机');
    if (!ok) return;
    applyRemote(r.state);
    setSync({ lastSync: Date.now() });
    UI.toast('已从云端恢复');
    go('home');
  } catch (e) { UI.toast('拉取失败：' + e.message, 3200); }
}

async function setToken() {
  const cur = syncCfg().token;
  const v = await UI.prompt('GitHub token', '只需勾选 gist 权限；留空则清除', cur ? '(已配置，重填会覆盖)' : '', 'password');
  if (v === null) return;
  setSync({ token: String(v).trim() });
  UI.toast(v ? 'token 已保存' : 'token 已清除');
  go('importexport');
}

async function setPw() {
  const pw = await UI.prompt('同步密码', '仅保留在当前会话，刷新后需重填', '', 'password');
  if (!pw) return;
  setPassword(pw);
  UI.toast('密码已设置（仅本次会话有效）');
  go('importexport');
}

// 同步码：把 token + Gist ID 打包成一段字符串，另一台设备粘贴即可接入
async function copyCode() {
  const c = syncCfg();
  if (!c.token || !c.gistId) { UI.toast('请先成功上传一次，再生成同步码'); return; }
  const code = 'icost1.' + btoa(encodeURIComponent(c.token + '|' + c.gistId));
  try {
    await navigator.clipboard.writeText(code);
    UI.toast('同步码已复制 —— 到另一台设备粘贴', 3200);
  } catch {
    await UI.prompt('手动复制这段同步码', '', code);
  }
}

async function pasteCode() {
  const code = await UI.prompt('粘贴另一台设备的同步码', '', '', 'text');
  if (!code) return;
  try {
    const raw = decodeURIComponent(atob(String(code).trim().replace(/^icost1\./, '')));
    const [token, gistId] = raw.split('|');
    if (!token || !gistId) throw new Error('bad');
    setSync({ token, gistId });
    UI.toast('已接入，输入密码后点「从云端恢复」', 3000);
    go('importexport');
  } catch { UI.toast('同步码解析失败，请检查是否完整'); }
}

function syncSection() {
  const c = syncCfg();
  const ready = !!c.token && !!c.gistId;
  return `
    <div class="sec-title">云同步 · 端到端加密</div>
    <div class="st2-note">
      <div class="tt">🔐 你的数据怎么被保护</div>
      上传前用你的密码在本机完成 <b>AES-GCM</b> 加密，GitHub 上只存密文 —— 没有密码谁也解不开，包括 GitHub 自己。
      密码只留存在当前会话内存里，不写入设备；token 存在本机 localStorage。
    </div>

    <div class="cell-group">
      ${row({ icon: '🔑', bg: 'rgba(10,132,255,.18)', label: 'GitHub token', sub: c.token ? '已配置 · 点击可重填或清除' : '未配置 · 点此填入（只需 gist 权限）', act: 'sync-token' })}
      ${row({ icon: '🔒', bg: 'rgba(255,159,10,.18)', label: '同步密码', sub: hasPassword() ? '本次会话已设置 · 点击可重设' : '未设置 · 点此设置（刷新后需重填）', act: 'sync-pw' })}
    </div>

    <div class="cell-group">
      ${row({ icon: '⬆️', bg: 'rgba(48,209,88,.18)', label: '上传到云端', sub: '用本机数据覆盖云端（首次会创建私密 Gist）', act: 'sync-push' })}
      ${row({ icon: '⬇️', bg: 'rgba(191,90,242,.18)', label: '从云端恢复', sub: '用云端数据覆盖本机', act: 'sync-pull' })}
    </div>

    <div class="cell-group">
      ${row({ icon: '📋', bg: 'rgba(100,210,255,.18)', label: '复制同步码', sub: '给另一台设备粘贴接入（不含密码）', act: 'sync-code' })}
      ${row({ icon: '📥', bg: 'rgba(100,210,255,.18)', label: '粘贴同步码', sub: '本机接入已有的同步', act: 'sync-code-in' })}
    </div>

    <div class="st2-note">
      <div class="tt">${ready ? '✅ 已接入同步' : '⚠️ 尚未接入'}</div>
      上次同步：${fmtTime(c.lastSync)}${c.gistId ? ` · Gist ${c.gistId.slice(0, 8)}…` : ''}
      ${c.token ? '' : `<div style="margin-top:8px">还没有 token？到 <b>${ghTokenUrl}</b> 新建 <b>Classic</b> token，只勾选 <b>gist</b> 一项即可（Fine-grained 不支持 Gist）。</div>`}
    </div>`;
}

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

      ${syncSection()}

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
        // 云同步
        else if (act === 'sync-token') setToken();
        else if (act === 'sync-pw') setPw();
        else if (act === 'sync-push') doPush();
        else if (act === 'sync-pull') doPull();
        else if (act === 'sync-code') copyCode();
        else if (act === 'sync-code-in') pasteCode();
      });
    });
  },
};
