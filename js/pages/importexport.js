// 账单导入导出：CSV / JSON 备份 + 恢复 + 危险区
import Icons from '../icons.js';
import { S, save, reset, catById, accById } from '../store.js';
import { go, UI } from '../app.js';
import {
  syncCfg, setSync, fetchRemote, pushPayload, applyState, mergeRemote,
  hasLocalChanges, hasPassword, setPassword, fmtTime,
  autoEnabled, setAuto, isRemembered, rememberPassword, runAutoSync,
} from '../sync.js';
import { parseCode } from './syncjoin.js';
import { uiMark } from '../uiicon.js';

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
  ${uiMark(o.icon, 'ci', !!o.danger)}
  <span class="cl${o.danger ? ' st2-danger' : ''}>${o.label}${o.sub ? `<span class="cell-sub">${o.sub}</span>` : ''}</span>
  <span class="arrow">${Icons.chevR}</span>
</div>`;

// 开关行：input 设为 disabled，点击统一由外层 .cell 接收，避免 label/input 各触发一次
const swRow = (o) => `<div class="cell" data-act="${o.act}">
  ${uiMark(o.icon, 'ci')}
  <span class="cl">${o.label}<span class="cell-sub">${o.sub}</span></span>
  <label class="switch"><input type="checkbox" ${o.on ? 'checked' : ''} disabled><i></i></label>
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

// 上传前先比对云端版本，避免默默覆盖掉另一台设备刚记的账
async function doPush() {
  try {
    if (!(await ensurePassword())) return;
    const cfg = syncCfg();
    if (cfg.gistId) {
      UI.toast('正在核对云端版本…', 3000);
      const remote = await fetchRemote();
      // 云端比本机基线新（留 2 秒容差，避免把本机刚传的当成别人改的）
      if (remote.syncedAt > (cfg.baseSyncedAt || 0) + 2000) {
        const pick = await UI.choose(
          `云端有更新的改动（${fmtTime(remote.syncedAt)}，共 ${remote.bills} 笔）`,
          [
            { label: '合并后上传', desc: '两边账单都保留，推荐' },
            { label: '覆盖云端', desc: '只用本机数据，会丢弃云端新改动', danger: true },
          ]);
        if (pick < 0) return;
        if (pick === 0) {
          applyState(mergeRemote(remote.state));
          UI.toast('已合并，正在上传…', 3000);
        } else {
          UI.toast('正在覆盖上传…', 3000);
        }
      }
    }
    const r = await pushPayload({
      // 云端文件被删过：必须让用户知情再重建，因为新地址只有这台设备知道
      onMissing: () => UI.confirm(
        '云端那个文件已经不存在了（可能你在 GitHub 上删了）。<br><br>'
        + '继续上传会用本机数据<b>重新建一个</b>，但新地址只有这台设备知道 —— '
        + '其他设备需要重新接入一次（生成新的接入链接，在那边点开）。',
        '重建并上传'),
    });
    UI.toast(`已上传 ${Math.max(1, Math.round(r.size / 1024))}KB 密文`);
    if (r.recreated) {
      await UI.confirm('已重建云端文件。<br><br>记得给其他设备<b>重新生成一次接入链接</b>，否则那边还在找旧地址。', '知道了');
    }
    go('importexport'); // 同 hash 会强制重渲染，刷新状态行
  } catch (e) { UI.toast('上传失败：' + e.message, 3200); }
}

// 恢复前先检查本机有没有没上传的改动，避免直接被覆盖掉
async function doPull() {
  try {
    if (!(await ensurePassword())) return;
    UI.toast('正在从云端拉取…', 3000);
    const remote = await fetchRemote();
    let next = remote.state;
    let merged = false;
    if (hasLocalChanges()) {
      const pick = await UI.choose(
        `云端 ${remote.bills} 笔（${fmtTime(remote.syncedAt)}），本机也有未上传的改动`,
        [
          { label: '合并', desc: '两边账单都保留，推荐' },
          { label: '覆盖本机', desc: '丢弃本机未上传的改动', danger: true },
        ]);
      if (pick < 0) return;
      if (pick === 0) { next = mergeRemote(remote.state); merged = true; }
    } else {
      const ok = await UI.confirm(
        `云端 ${remote.bills} 笔账单（${fmtTime(remote.syncedAt)}）\n将覆盖本机当前 ${S().bills.length} 笔，确认继续？`,
        '恢复');
      if (!ok) return;
    }
    applyState(next);
    setSync({ lastSync: Date.now(), baseSyncedAt: remote.syncedAt });
    UI.toast(merged ? '已合并云端数据' : '已从云端恢复');
    go('home');
  } catch (e) { UI.toast('拉取失败：' + e.message, 3200); }
}

async function setToken() {
  const cur = syncCfg().token;
  const v = await UI.prompt(
    'GitHub token',
    '只勾选 gist 权限；留空并确定则清除',
    cur ? '(已配置，重填会覆盖)' : '', 'password');
  if (v === null) return;                     // 取消：什么都不做
  // 注意：UI.prompt 取消返回 null，确定返回 trim 后的字符串（可能是空串 = 用户明确要清除）
  const next = String(v).trim();
  setSync({ token: next });
  UI.toast(next ? 'token 已保存' : 'token 已清除');
  go('importexport');
}

async function setPw() {
  const pw = await UI.prompt('同步密码', isRemembered() ? '已在本机记住，重设会同步更新' : '仅保留在当前会话，刷新后需重填', '', 'password');
  if (!pw) return;
  setPassword(pw);
  UI.toast(isRemembered() ? '密码已更新并保存' : '密码已设置（仅本次会话有效）');
  go('importexport');
}

// 只清 token，保留 Gist 地址和账单 —— 换设备、怀疑泄露时用这一项
async function clearToken() {
  const ok = await UI.confirm(
    '从本机删除 GitHub token。<br><br>'
    + '同步地址和账单都会保留，但自动同步会暂停，直到重新填入 token。'
    + '<br><br>如果怀疑泄露，记得同时去 GitHub 设置里吊销这个 token。',
    '清除 token');
  if (!ok) return;
  setSync({ token: '' });
  UI.toast('token 已清除');
  go('importexport');
}

// 开启「记住密码」是自动同步能跨刷新工作的前提，但代价是密码落本机存储 —— 必须让用户知情
async function toggleRemember() {
  if (isRemembered()) {
    rememberPassword(false);
    UI.toast('已忘记密码，刷新后需重新输入');
    go('importexport');
    return;
  }
  if (!(await ensurePassword())) return;
  const ok = await UI.confirm(
    '密码将以明文保存在本机浏览器中。<br><br>'
    + '云端数据仍是密文，别人拿到你的账目也解不开；'
    + '但能操作这台设备浏览器的人，有可能读出这个密码。<br><br>'
    + '公私混用的电脑不建议开启。',
    '记住密码');
  if (!ok) return;
  rememberPassword(true);
  UI.toast('已记住 —— 刷新后自动同步照常工作');
  go('importexport');
}

// 同步码：只打包 Gist ID。
// 早先版本把 token 一起编码进去（"一键接入"更方便），代价是这段码 ≈ 一个可写你全部 Gist 的凭证，
// 只要粘过聊天窗口就算泄露。现在 token 不进码、不进链接，目标设备上手动粘一次即可。
function syncCode() {
  const c = syncCfg();
  if (!c.gistId) return null;
  return 'icost2.' + btoa(encodeURIComponent(c.gistId));
}

// 一键接入链接：把同步码塞进 URL，另一台设备点开就自动配好，只差输一次密码
function joinLink() {
  const code = syncCode();
  if (!code) return null;
  return location.origin + location.pathname + '#/syncjoin?c=' + encodeURIComponent(code);
}

async function copyCode() {
  const code = syncCode();
  if (!code) { UI.toast('请先成功上传一次，再生成同步码'); return; }
  try {
    await navigator.clipboard.writeText(code);
    UI.toast('同步码已复制 —— 到另一台设备粘贴', 3200);
  } catch {
    await UI.prompt('手动复制这段同步码', '', code);
  }
}

async function copyLink() {
  const url = joinLink();
  if (!url) { UI.toast('请先成功上传一次，再生成接入链接'); return; }
  try {
    await navigator.clipboard.writeText(url);
    UI.toast('接入链接已复制 —— 在另一台设备打开即可', 3600);
  } catch {
    await UI.prompt('手动复制这段链接（在另一台设备打开）', '', url);
  }
}

// 想彻底重来时用的出口：只清本机的接入信息，云端文件不动，账单数据也不动
async function resetSync() {
  const ok = await UI.confirm(
    '清除本机的 token 与同步地址，回到"还没接入"的状态。<br><br>'
    + '<b>本机账单不会丢</b>，云端那个文件也不会被删除。之后可以用同步码/接入链接重新接上。',
    '清除');
  if (!ok) return;
  setSync({ token: '', gistId: '', baseSyncedAt: 0, lastSync: 0, lastError: '' });
  rememberPassword(false);
  UI.toast('已清除同步配置');
  go('importexport');
}

async function pasteCode() {
  const code = await UI.prompt('粘贴另一台设备的同步码', '', '', 'text');
  if (!code) return;
  let pair;
  try {
    pair = parseCode(code);
  } catch { UI.toast('同步码解析失败，请检查是否完整'); return; }
  setSync(pair.gistId ? { gistId: pair.gistId } : {});
  // 旧版码里自带 token，可直接用；新版码不含 token，需要本机已有或现填
  if (pair.token) setSync({ token: pair.token });
  if (!syncCfg().token) {
    UI.toast('已写入同步地址，还需填入 token 才能读取云端', 3600);
    await setToken();
    return;
  }
  UI.toast('已接入，输入密码后点「从云端恢复」', 3000);
  go('importexport');
}

function syncSection() {
  const c = syncCfg();
  const ready = !!c.token && !!c.gistId;
  const remembered = isRemembered();
  const autoOn = !!c.auto;
  return `
    <div class="sec-title">云同步 · 端到端加密</div>
    <div class="st2-note">
      <div class="tt">${uiMark('shield-lock', 'badge-ic')}你的数据怎么被保护</div>
      上传前用你的密码在本机完成 <b>AES-GCM</b> 加密，GitHub 上只存密文 —— 没有密码谁也解不开，包括 GitHub 自己。
      密码只留存在当前会话内存里，不写入设备。
      <div style="margin-top:8px">token 存在本机 localStorage（网页无法使用更安全的 HttpOnly 存储），
      它不进云端密文、也不进同步码和接入链接。<b>建议新建 classic token 时只勾选 gist 一项</b>，
      怀疑泄露就到 GitHub 设置里吊销，再点上面的「清除本机 token」。</div>
    </div>

    <div class="cell-group">
      ${row({ icon: 'lock', label: 'GitHub token', sub: c.token ? '已配置 · 点击可重填或清除' : '未配置 · 点此填入（只需 gist 权限）', act: 'sync-token' })}
      ${row({ icon: 'lock', label: '同步密码', sub: hasPassword() ? '本次会话已设置 · 点击可重设' : '未设置 · 点此设置（刷新后需重填）', act: 'sync-pw' })}
    </div>

    <div class="sec-title">自动同步</div>
    <div class="cell-group">
      ${swRow({ icon: 'refresh', label: '自动同步', sub: autoOn ? '已开启 · 记完账自动上传，进 App 自动拉取' : '已关闭 · 只能手动点上传 / 恢复', act: 'sync-auto', on: autoOn })}
      ${swRow({ icon: 'pin', label: '在本机记住密码', sub: remembered ? '已记住 · 刷新页面后自动同步照常' : '未记住 · 刷新后需重填密码，自动同步会暂停', act: 'sync-remember', on: remembered })}
    </div>

    <div class="st2-note">
      <div class="tt">${uiMark('refresh', 'badge-ic')}${autoOn ? '自动同步已开启' : '自动同步已关闭'}</div>
      记完账 4 秒后自动上传，打开 App 时自动拉取；两端都改过就自动合并，不会再互相覆盖。
      ${autoOn && !hasPassword() ? '<div style="margin-top:6px;color:var(--orange,#ff9f0a)">本次会话还没密码 —— 填一次密码后自动同步才会真正开始</div>' : ''}
      ${autoOn && !remembered ? '<div style="margin-top:6px;color:var(--orange,#ff9f0a)">没记住密码的话，刷新页面后自动同步会暂停，直到你重新输入</div>' : ''}
    </div>

    <div class="sec-title">手动操作</div>
    <div class="cell-group">
      ${row({ icon: 'export', label: '上传到云端', sub: '立即同步一次（自动同步开着时一般不用点）', act: 'sync-push' })}
      ${row({ icon: 'import_', label: '从云端恢复', sub: '强制拉取并合并，可指定合并或覆盖', act: 'sync-pull' })}
    </div>

    <div class="sec-title">另一台设备怎么接入</div>
    <div class="cell-group">
      ${row({ icon: 'link', label: '生成接入链接', sub: '只含 Gist 地址；那边再粘一次 token 和密码', act: 'sync-link' })}
      ${row({ icon: 'copy', label: '复制同步码', sub: '备选：手动复制一段码，那边粘贴', act: 'sync-code' })}
      ${row({ icon: 'file-import', label: '粘贴同步码', sub: '如果那边给的是同步码，粘到这里', act: 'sync-code-in' })}
      ${ready ? row({ icon: 'trash', label: '清除本机同步配置', sub: '只清 token 与地址，不碰账单和云端文件', act: 'sync-reset' }) : ''}
      ${c.token ? row({ icon: 'lock', label: '清除本机 token', sub: '换设备 / 怀疑泄露时先清掉这一项', act: 'sync-token-clear' }) : ''}
    </div>

    <div class="st2-note">
      <div class="tt">${uiMark('link', 'badge-ic')}接入链接怎么用</div>
      复制后发到另一台设备（微信「文件传输助手」最方便），在那台设备上点开链接 —— Gist 地址会自动配好，
      再投入一次同步密码、填一次 token，选「合并两端」就完成了。
      <div style="margin-top:6px">链接与同步码都<b>不含 token</b>，就算不小心转发出去，也只暴露一个加密 Gist 的地址。</div>
    </div>

    <div class="st2-note">
      <div class="tt">${ready ? uiMark('check', 'badge-ic') : uiMark('warn', 'badge-ic', true)}${ready ? '已接入同步' : '尚未接入'}</div>
      上次同步：${fmtTime(c.lastSync)}${c.gistId ? ` · Gist ${c.gistId.slice(0, 8)}…` : ''}
      ${ready && autoEnabled() ? '<div style="margin-top:6px;color:var(--green,#30d158)">自动同步运行中</div>' : ''}
      ${c.lastError ? `<div style="margin-top:6px;color:#ff453a">上次同步失败：${c.lastError}</div>` : ''}
      ${ready && !autoOn && hasLocalChanges() ? '<div style="margin-top:6px;color:var(--orange,#ff9f0a)">本机有未上传的改动，换设备前记得先上传</div>' : ''}
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
        <div class="tt">${uiMark('archive', 'badge-ic')}把微信 / 支付宝的账倒进来</div>
        点下面的「导入微信 / 支付宝账单」，选 App 导出的 CSV 就行 —— 自动识别来源、自动判断编码、
        自动猜分类，还能重复导入不记重。
      </div>

      <div class="sec-title">导出 · 共 ${n} 笔账单</div>
      <div class="cell-group">
        ${row({ icon: 'file-export', label: '导出 CSV', sub: 'icost-bills.csv · Excel 可直接打开', act: 'csv' })}
        ${row({ icon: 'file-text', label: '导出 JSON 备份', sub: 'icost-backup.json · 完整数据', act: 'json' })}
        ${row({ icon: 'calc', label: '导出 Excel', sub: '复刻版以 CSV 代替', act: 'excel' })}
      </div>

      <div class="sec-title">导入</div>
      <div class="cell-group">
        ${row({ icon: 'file-import', label: '导入 JSON 备份', sub: '校验后覆盖当前数据', act: 'importjson' })}
        ${row({ icon: 'wechat', label: '导入微信 / 支付宝账单', sub: '选 App 导出的 CSV，自动识别并猜分类', act: 'importcsv' })}
      </div>

      ${syncSection()}

      <div class="sec-title">危险区</div>
      <div class="cell-group">
        ${row({ icon: 'trash', label: '清空全部数据', danger: true, act: 'clear' })}
      </div>

      <div class="st2-note">
        <div class="tt">${uiMark('info-circle', 'badge-ic')}提示</div>
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
        else if (act === 'importcsv') go('importcsv');
        else if (act === 'clear') clearAll();
        // 云同步
        else if (act === 'sync-token') setToken();
        else if (act === 'sync-token-clear') clearToken();
        else if (act === 'sync-pw') setPw();
        else if (act === 'sync-push') doPush();
        else if (act === 'sync-pull') doPull();
        else if (act === 'sync-link') copyLink();
        else if (act === 'sync-code') copyCode();
        else if (act === 'sync-code-in') pasteCode();
        else if (act === 'sync-auto') { setAuto(!syncCfg().auto); if (syncCfg().auto) runAutoSync({ force: true }); go('importexport'); }
        else if (act === 'sync-remember') toggleRemember();
        else if (act === 'sync-reset') resetSync();
      });
    });
  },
};
