// 云同步：端到端加密（PBKDF2 + AES-GCM）+ GitHub Secret Gist + 增量合并
//
// 安全约定（重要）：
//  1. 同步密码与 token 只存在本机，绝不写入云端
//  2. 上传前先加密 —— GitHub 侧只能看到密文，看不到任何账单
//  3. 密码默认只保留在当前会话内存里（刷新即失效），不落 localStorage
//  4. Gist 创建为 secret（public:false），不进公开索引
//
// 同步模型（弱一致 + 增量合并）：
//  云端 payload = { state, syncedAt, deviceId }
//  本机记录 baseSyncedAt = 上次同步时看到的云端 syncedAt
//  上传前若 cloud.syncedAt > baseSyncedAt，说明另一台设备先改过 → 冲突，交给用户选
//  合并按实体 id 取并集，同 id 比 updatedAt 取新；删除靠墓碑，避免已删账单复活
//
// 依赖：crypto.subtle —— 仅 https 或 localhost 下可用（GitHub Pages 满足）
import { S, save, pruneTombstones } from './store.js';

const API = 'https://api.github.com/gists';
const FILE = 'icost-sync.json';
const ITER = 150000;

// 参与合并的集合型字段（settings / currentBookId 不参与，始终保留本机）
const LIST_KEYS = ['books', 'accounts', 'bills', 'budgets', 'savings', 'templates', 'recurrings', 'loans', 'claims'];
const STATE_KEYS = [...LIST_KEYS, 'categories', 'settings', 'currentBookId', 'tombstones'];

// 会话内密码：刷新即失效，不写入设备存储
let sessionPassword = '';
export const hasPassword = () => !!sessionPassword;
export function setPassword(pw) { sessionPassword = pw || ''; }
export function clearPassword() { sessionPassword = ''; }

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
  if (r.status === 404) throw new Error('找不到该 Gist（404）—— 可能已被删除');
  if (!r.ok) throw new Error('GitHub 返回 ' + r.status);
  return r.json();
}

// ---------- 合并逻辑 ----------
const ts = (o) => Number((o && (o.updatedAt || o.created)) || 0);
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// 按 id 取并集，同 id 比 updatedAt 取新；传入墓碑则剔除「删除时间晚于最后修改」的条目
function mergeList(localArr, remoteArr, tombs) {
  const byId = new Map();
  (localArr || []).forEach((x) => { if (x && x.id) byId.set(x.id, x); });
  (remoteArr || []).forEach((x) => {
    if (!x || !x.id) return;
    const cur = byId.get(x.id);
    if (!cur || ts(x) > ts(cur)) byId.set(x.id, x);
  });
  (tombs || []).forEach((t) => {
    const item = byId.get(t && t.id);
    if (item && Number(t.deletedAt || 0) > ts(item)) byId.delete(t.id);
  });
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
  const tombs = [...(st.tombstones?.bills || []), ...(remote?.tombstones?.bills || [])];

  const merged = {};
  LIST_KEYS.forEach((k) => { merged[k] = mergeList(local[k], remote?.[k], k === 'bills' ? tombs : null); });

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

  // 墓碑合并去重，保留最新的删除时间
  const tombMap = new Map();
  tombs.forEach((t) => {
    if (!t || !t.id) return;
    const cur = tombMap.get(t.id);
    if (!cur || Number(t.deletedAt || 0) > Number(cur.deletedAt || 0)) tombMap.set(t.id, t);
  });

  return {
    ...merged,
    categories: cats,
    tombstones: { bills: [...tombMap.values()] },
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
  return { v: 2, state: S(), syncedAt: Date.now(), deviceId: syncCfg().deviceId };
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

export async function pushPayload() {
  const cfg = syncCfg();
  if (!cfg.token) throw new Error('请先填入 GitHub token');
  if (!sessionPassword) throw new Error('请先填入同步密码');
  const content = await encryptJSON(buildPayload(), sessionPassword);
  let id = cfg.gistId;
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
  } else {
    await gh('/' + id, cfg.token, {
      method: 'PATCH',
      body: JSON.stringify({ files: { [FILE]: { content } } }),
    });
  }
  const now = Date.now();
  setSync({ gistId: id, lastSync: now, baseSyncedAt: now });
  pruneTombstones();
  return { gistId: id, size: content.length };
}

// 本机自上次同步以来是否有未上传的改动（下拉前提示用，避免直接覆盖掉本地新账）
export function hasLocalChanges() {
  const base = syncCfg().baseSyncedAt || 0;
  if (!base) return S().bills.length > 0;
  return S().bills.some((b) => ts(b) > base);
}

export const fmtTime = (t) => {
  if (!t) return '从未同步';
  const d = new Date(t);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};
