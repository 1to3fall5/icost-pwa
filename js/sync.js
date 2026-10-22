// 云同步：端到端加密（PBKDF2 + AES-GCM）+ GitHub Secret Gist + 增量合并
//
// 安全约定（重要）：
//  1. 同步密码与 token 只存在本机，绝不写入云端
//  2. 上传前先加密 —— GitHub 侧只能看到密文，看不到任何账单
//  3. 密码默认只保留在当前会话内存里（刷新即失效），不落 localStorage
//     —— 用户可显式开启「记住密码」才写入本机，这是自动同步能跨刷新工作的前提
//  4. Gist 创建为 secret（public:false），不进公开索引
//  5. 上传的 payload 会剔除 token / 密码，密钥绝不进自己的密文里
//
// 同步模型（弱一致 + 增量合并）：
//  云端 payload = { state, syncedAt, deviceId }
//  本机记录 baseSyncedAt = 上次同步时看到的云端 syncedAt
//  上传前若 cloud.syncedAt > baseSyncedAt，说明另一台设备先改过 → 冲突，交给用户选
//  合并按实体 id 取并集，同 id 比 updatedAt 取新；删除靠墓碑，避免已删账单复活
//
// 依赖：crypto.subtle —— 仅 https 或 localhost 下可用（GitHub Pages 满足）
import { S, save, pruneTombstones, TOMB_KEYS } from './store.js';

const API = 'https://api.github.com/gists';
const FILE = 'icost-sync.json';
const ITER = 150000;

// 参与合并的集合型字段（settings / currentBookId 不参与，始终保留本机）
const LIST_KEYS = ['books', 'accounts', 'bills', 'budgets', 'savings', 'templates', 'recurrings', 'loans', 'claims'];
const STATE_KEYS = [...LIST_KEYS, 'categories', 'settings', 'currentBookId', 'tombstones'];

// 会话内密码：刷新即失效，不写入设备存储
let sessionPassword = '';
const PW_KEY = 'icost.syncpw';   // 只有显式开启「记住密码」才会写这里
export const hasPassword = () => !!sessionPassword;
export function setPassword(pw) {
  sessionPassword = pw || '';
  // 已开启记住密码时，重设密码要同步刷新本机副本，否则下次启动用的是旧密码
  if (isRemembered()) {
    try {
      if (sessionPassword) localStorage.setItem(PW_KEY, sessionPassword);
      else localStorage.removeItem(PW_KEY);
    } catch {}
  }
}
export function clearPassword() { setPassword(''); }

export function isRemembered() {
  try { return !!localStorage.getItem(PW_KEY); } catch { return false; }
}
// 启动调用：把记住的密码取回会话，自动同步才能在不打扰用户的前提下工作
export function restorePassword() {
  try {
    const v = localStorage.getItem(PW_KEY);
    if (v) { sessionPassword = v; return true; }
  } catch {}
  return false;
}
export function rememberPassword(on) {
  try {
    if (on && sessionPassword) localStorage.setItem(PW_KEY, sessionPassword);
    else localStorage.removeItem(PW_KEY);
  } catch {}
  return isRemembered();
}

// ---------- base64（分块，避免大数组 spread 爆栈） ----------
function b64(buf) {
  const u = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < u.length; i += 8192) s += String.fromCharCode.apply(null, u.subarray(i, i + 8192));
  return btoa(s);
}
function unb64(s) {
  const bin = atob(s);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
}

// ---------- 本机同步配置 ----------
export function syncCfg() {
  const st = S();
  if (!st.settings) st.settings = {};
  if (!st.settings.sync) st.settings.sync = { token: '', gistId: '', lastSync: 0 };
  const c = st.settings.sync;
  if (!c.deviceId) { c.deviceId = 'd' + Math.random().toString(36).slice(2, 10); save(); }
  if (typeof c.baseSyncedAt !== 'number') c.baseSyncedAt = 0;
  if (typeof c.auto !== 'boolean') { c.auto = true; save(); }   // 自动同步默认开
  return c;
}
export function setSync(patch) { Object.assign(syncCfg(), patch); save(); }

// ---------- 加密 / 解密 ----------
async function deriveKey(pw, salt) {
  const base = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: ITER, hash: 'SHA-256' },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

async function encryptJSON(obj, pw) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(pw, salt);
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(obj)));
  return JSON.stringify({ v: 1, enc: 'aes-gcm', iter: ITER, salt: b64(salt), iv: b64(iv), ct: b64(ct) });
}

async function decryptJSON(text, pw) {
  let p;
  try { p = JSON.parse(text); } catch { throw new Error('云端数据不是合法 JSON'); }
  if (!p || p.enc !== 'aes-gcm') throw new Error('云端数据格式不支持（可能未加密或是旧版本）');
  let plain;
  try {
    const key = await deriveKey(pw, unb64(p.salt));
    plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(p.iv) }, key, unb64(p.ct));
  } catch { throw new Error('解密失败 —— 密码不对，或数据已损坏'); }
  return JSON.parse(new TextDecoder().decode(plain));
}

// ---------- GitHub Gist API ----------
async function gh(path, token, opts = {}) {
  let r;
  try {
    r = await fetch(API + path, {
      ...opts,
      headers: {
        Authorization: 'Bearer ' + token,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
      },
    });
  } catch {
    throw new Error('网络请求失败 —— 手机需能访问 api.github.com');
  }
  if (r.status === 401) throw new Error('token 无效或已过期（401）');
  if (r.status === 403) throw new Error('GitHub 拒绝请求（403）—— 可能是速率超限，稍后再试');
  if (r.status === 404) {
    const e = new Error('找不到该 Gist（404）—— 可能已被删除');
    e.status = 404;
    throw e;
  }
  if (!r.ok) throw new Error('GitHub 返回 ' + r.status);
  return r.json();
}

// ---------- 合并逻辑 ----------
const ts = (o) => Number((o && (o.updatedAt || o.created)) || 0);
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// 按 id 取并集，同 id 比 updatedAt 取新；传入墓碑则剔除「删除时间晚于最后修改」的条目
// keyOf 允许指定业务主键：claims 没有 id，只有 billId
function mergeList(localArr, remoteArr, tombs, keyOf = (x) => x.id, tombKeyOf = keyOf) {
  const byId = new Map();
  (localArr || []).forEach((x) => { const k = x && keyOf(x); if (k) byId.set(k, x); });
  (remoteArr || []).forEach((x) => {
    const k = x && keyOf(x);
    if (!k) return;
    const cur = byId.get(k);
    if (!cur || ts(x) > ts(cur)) byId.set(k, x);
  });
  (tombs || []).forEach((t) => {
    const k = t && tombKeyOf(t);       // 墓碑统一用 id（claims 的墓碑 id 即 billId）
    const item = byId.get(k);
    if (item && Number(t.deletedAt || 0) > ts(item)) byId.delete(k);
  });
  return [...byId.values()];
}

// claims 的主键是 billId：同一笔账单只应存在一条报销记录（status 是它的状态机）
const claimKey = (c) => c && c.billId;
// 墓碑统一用 id / deletedAt 两个字段表示，claims 的 id 里存的就是 billId。
// 之前这里按 billId 取键，而 addTombstone 写入的是 { id }，两边对不上，
// 导致所有报销墓碑在合并时被当成"无键"静默丢弃。
const TOMB_KEY_OF = { claims: (t) => t && t.id };

// 合并两端墓碑并去重（同主键保留更晚的删除时间）
function mergeTombs(a, b, keyOf = (t) => t && t.id) {
  const byId = new Map();
  [a, b].forEach((arr) => (arr || []).forEach((t) => {
    const k = keyOf(t);
    if (!k) return;
    const cur = byId.get(k);
    if (!cur || Number(t.deletedAt || 0) > Number(cur.deletedAt || 0)) byId.set(k, t);
  }));
  return [...byId.values()];
}

// 某组账单给某个账户贡献的净额（用于合并后重算余额）
function contribution(bills, accId) {
  let v = 0;
  (bills || []).forEach((b) => {
    const amt = Number(b.amount) || 0;
    if (b.type === 'income' && b.accountId === accId) v += amt;
    else if (b.type === 'expense' && b.accountId === accId) v -= amt;
    else if (b.type === 'transfer') {
      if (b.accountId === accId) v -= amt;
      if (b.toAccountId === accId) v += amt;
    }
  });
  return v;
}

/**
 * 把远端状态合并进本地，返回合并后的完整 state（不落盘，交给调用方决定）。
 * 关键点：账户余额不能简单"取新" —— 两端各自记账都会改余额。
 * 做法是先扣掉"本地账单的贡献"，再加上"合并后账单的贡献"，从而保住用户手设的基础余额。
 */
export function mergeRemote(remote) {
  const st = S();
  const local = {
    books: st.books, accounts: st.accounts, bills: st.bills, budgets: st.budgets,
    savings: st.savings, templates: st.templates, recurrings: st.recurrings,
    loans: st.loans, claims: st.claims,
  };
  // 墓碑按集合分组，两端同类墓碑先合并（同主键保留更晚的删除时间），
  // 再交给 mergeList 判定「删除时间 > 最后修改时间」 -> 真删
  // claims 的墓碑同样以 billId 为键，否则去重会全部丢失
  const tombMap = {};
  TOMB_KEYS.forEach((k) => {
    tombMap[k] = mergeTombs(st.tombstones?.[k], remote?.tombstones?.[k], TOMB_KEY_OF[k] || ((t) => t && t.id));
  });

  const merged = {};
  LIST_KEYS.forEach((k) => {
    merged[k] = k === 'claims'
      ? mergeList(local[k], remote?.[k], tombMap[k], claimKey, TOMB_KEY_OF[k] || ((t) => t && t.id))
      : mergeList(local[k], remote?.[k], tombMap[k]);
  });

  // 孤儿报销回收：报销记录靠 billId 指向账单，账单一旦被删（含对端删的），
  // 留下的报销就会永远挂在"待报销"里、金额也算进总额。这里按合并后的账单集合清理。
  // 只清理、不写墓碑 —— 账单本身已有墓碑，下次合并没有账单就自然不成立。
  const billIds = new Set((merged.bills || []).map((b) => b.id));
  merged.claims = (merged.claims || []).filter((c) => c && billIds.has(c.billId));

  // 余额重算：先扣掉"该账户对象原来那一侧的账单贡献"，再加"合并后账单的贡献"。
  // 区分来源很关键 —— 若账户对象取自远端，它里面含的是远端账单的贡献，扣本地就会算错。
  merged.accounts = merged.accounts.map((a) => {
    const la = (st.accounts || []).find((x) => x.id === a.id);
    const ra = (remote?.accounts || []).find((x) => x.id === a.id);
    const fromRemote = !!ra && (!la || ts(ra) > ts(la));
    const baseContrib = contribution(fromRemote ? (remote.bills || []) : local.bills, a.id);
    return {
      ...a,
      balance: round2(round2(a.balance) - baseContrib + contribution(merged.bills, a.id)),
    };
  });

  // 分类是 {expense:[], income:[]} 结构，分别合并
  const cats = {};
  ['expense', 'income'].forEach((t) => { cats[t] = mergeList(st.categories?.[t], remote?.categories?.[t]); });

  return {
    ...merged,
    categories: cats,
    tombstones: tombMap,
    settings: st.settings,          // 保留本机设置（含 token / 同步配置）
    currentBookId: st.currentBookId,
  };
}

export function applyState(next) {
  if (!next || !Array.isArray(next.bills)) throw new Error('数据校验失败');
  const localSync = { ...syncCfg() };
  const st = S();
  STATE_KEYS.forEach((k) => { if (next[k] !== undefined) st[k] = next[k]; });
  if (!st.settings) st.settings = {};
  st.settings.sync = localSync;
  save();
}

// ---------- 拉取 / 上传 ----------
function buildPayload() {
  const st = S();
  // 脱敏：token 与密码只属于本机，不能进自己加密的 payload（否则等于把钥匙锁进保险箱）
  const sync = { ...(st.settings?.sync || {}) };
  delete sync.token;
  delete sync.password;
  const state = { ...st, settings: { ...st.settings, sync } };
  return { v: 2, state, syncedAt: Date.now(), deviceId: sync.deviceId };
}

// 兼容旧版本：早期上传的是裸 state，没有 syncedAt / deviceId 包装
function normalize(decrypted, gistUpdatedAt) {
  if (decrypted && decrypted.state && Array.isArray(decrypted.state.bills)) {
    return {
      state: decrypted.state,
      syncedAt: Number(decrypted.syncedAt) || Date.parse(gistUpdatedAt) || 0,
      deviceId: decrypted.deviceId || '',
    };
  }
  if (decrypted && Array.isArray(decrypted.bills)) {
    return { state: decrypted, syncedAt: Date.parse(gistUpdatedAt) || 0, deviceId: '' };
  }
  throw new Error('云端数据校验失败，不是有效的账本数据');
}

export async function fetchRemote() {
  const cfg = syncCfg();
  if (!cfg.token) throw new Error('请先填入 GitHub token');
  if (!cfg.gistId) throw new Error('本机还没有同步 Gist，请先点「上传」创建');
  if (!sessionPassword) throw new Error('请先填入同步密码');
  const g = await gh('/' + cfg.gistId, cfg.token, {});
  const file = g.files && g.files[FILE];
  if (!file) throw new Error('该 Gist 里没有 ' + FILE);
  const data = normalize(await decryptJSON(file.content, sessionPassword), g.updated_at);
  return { ...data, updatedAt: g.updated_at, bills: data.state.bills.length };
}

// opts.onMissing：云端 Gist 被删时回调，让调用方决定是否重建。
// 自动同步不传（静默记录错误，绝不偷偷重建），只有用户手动点上传才重建 ——
// 否则两台设备各自重建一个，数据就分裂了。
export async function pushPayload(opts = {}) {
  const cfg = syncCfg();
  if (!cfg.token) throw new Error('请先填入 GitHub token');
  if (!sessionPassword) throw new Error('请先填入同步密码');
  const content = await encryptJSON(buildPayload(), sessionPassword);
  let id = cfg.gistId;
  let recreated = false;
  if (id) {
    try {
      await gh('/' + id, cfg.token, {
        method: 'PATCH',
        body: JSON.stringify({ files: { [FILE]: { content } } }),
      });
    } catch (e) {
      if (e.status !== 404) throw e;
      const allow = opts.onMissing ? await opts.onMissing() : false;
      if (!allow) throw e;                 // 不让重建就把错误交上去，由调用方提示
      id = '';
      recreated = true;
    }
  }
  if (!id) {
    const g = await gh('', cfg.token, {
      method: 'POST',
      body: JSON.stringify({
        description: 'iCost 记账同步数据（端到端加密）',
        public: false,
        files: { [FILE]: { content } },
      }),
    });
    id = g.id;
  }
  const now = Date.now();
  setSync({ gistId: id, lastSync: now, baseSyncedAt: now });
  pruneTombstones();
  return { gistId: id, size: content.length, recreated };
}

// 本机自上次同步以来是否有未上传的改动（下拉前提示用，避免直接覆盖掉本地新账）
// 账单 / 账户 / 分类 … 任一集合有更新的条目都算，删除（墓碑）也算
export function hasLocalChanges() {
  const base = syncCfg().baseSyncedAt || 0;
  const st = S();
  if (!base) return st.bills.length > 0;
  const listDirty = LIST_KEYS.some((k) => (st[k] || []).some((x) => ts(x) > base));
  // 删除也是一种改动：任何集合的墓碑晚于基线，都必须推送，否则对端会把这条拉回来
  const tombDirty = TOMB_KEYS.some((k) =>
    (st.tombstones?.[k] || []).some((t) => Number(t.deletedAt || 0) > base));
  return listDirty || tombDirty;
}

// ---------- 自动同步 ----------
// 触发：数据保存后 debounce 4s 推一次；回到前台/启动时拉一次。
// 全程静默：拉到新数据才提示，网络失败只在状态行留痕，不弹窗打断记账。
const MIN_GAP = 20000;          // 两次同步最小间隔，避免疯狂打 API
let busy = false;
let timer = null;
let lastRun = 0;
const hooks = [];
export const onAutoSync = (fn) => { hooks.push(fn); };

// 自动同步的成立条件：开关打开 + token 就绪 + 已建 Gist + 密码在手（没密码解不开也加不了密）
export function autoEnabled() {
  if (!sessionPassword) return false;
  const c = syncCfg();
  return !!c.auto && !!c.token && !!c.gistId;
}
export function setAuto(on) { setSync({ auto: !!on }); }

export function scheduleAutoPush(delay = 4000) {
  if (busy || !autoEnabled()) return;
  clearTimeout(timer);
  timer = setTimeout(runAutoSync, delay);
}

// 静默拉取并合并，返回新增的账单条数
async function silentPull() {
  const cfg = syncCfg();
  const remote = await fetchRemote();
  if (remote.syncedAt <= (cfg.baseSyncedAt || 0) + 2000) return 0;   // 云端没有比本机更新的东西
  const before = S().bills.length;
  applyState(mergeRemote(remote.state));
  setSync({ baseSyncedAt: remote.syncedAt, lastSync: Date.now(), lastError: '' });
  return S().bills.length - before;
}

// force: 跳过节流立即执行 —— 用户主动触发时必须用它，否则点了没反应
export async function runAutoSync(opts = {}) {
  if (busy || !autoEnabled()) return;
  const gap = Date.now() - lastRun;
  if (!opts.force && gap < MIN_GAP) { scheduleAutoPush(MIN_GAP - gap); return; }
  busy = true;
  lastRun = Date.now();
  let added = 0; let pushed = false; let err = '';
  try {
    added = await silentPull();
    if (added > 0 || hasLocalChanges()) { await pushPayload(); pushed = true; }
  } catch (e) {
    err = e.message || String(e);
    try { setSync({ lastError: err }); } catch {}
  } finally {
    busy = false;
    hooks.forEach((fn) => { try { fn({ added, pushed, err }); } catch {} });
    if (err && hasLocalChanges()) scheduleAutoPush(MIN_GAP);   // 失败后重试，但保持间隔
  }
}

export const fmtTime = (t) => {
  if (!t) return '从未同步';
  const d = new Date(t);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};
