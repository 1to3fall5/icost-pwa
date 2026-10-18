// 云同步：端到端加密（PBKDF2 + AES-GCM）+ GitHub Secret Gist
//
// 安全约定（重要）：
//  1. 同步密码与 token 只存在本机，绝不写入云端
//  2. 上传前先加密 —— GitHub 侧只能看到密文，看不到任何账单
//  3. 密码默认只保留在当前会话内存里（刷新即失效），不落 localStorage
//  4. Gist 创建为 secret（public:false），不进公开索引
//
// 依赖：crypto.subtle —— 仅 https 或 localhost 下可用（GitHub Pages 满足）
import { S, save } from './store.js';

const API = 'https://api.github.com/gists';
const FILE = 'icost-sync.json';
const ITER = 150000;
const STATE_KEYS = [
  'books', 'categories', 'accounts', 'bills', 'budgets', 'savings',
  'templates', 'recurrings', 'loans', 'claims', 'settings', 'currentBookId',
];

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
  return st.settings.sync;
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

export async function encryptState(pw) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(pw, salt);
  const plain = new TextEncoder().encode(JSON.stringify(S()));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plain);
  return JSON.stringify({
    v: 1, enc: 'aes-gcm', iter: ITER,
    salt: b64(salt), iv: b64(iv), ct: b64(ct),
  });
}

export async function decryptState(text, pw) {
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

// ---------- 对外的两个动作 ----------
export async function pushSync() {
  const cfg = syncCfg();
  if (!cfg.token) throw new Error('请先填入 GitHub token');
  if (!sessionPassword) throw new Error('请先填入同步密码');
  const content = await encryptState(sessionPassword);
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
  setSync({ gistId: id, lastSync: Date.now() });
  return { gistId: id, size: content.length };
}

export async function pullSync() {
  const cfg = syncCfg();
  if (!cfg.token) throw new Error('请先填入 GitHub token');
  if (!cfg.gistId) throw new Error('本机还没有同步 Gist，请先点「上传」创建');
  if (!sessionPassword) throw new Error('请先填入同步密码');
  const g = await gh('/' + cfg.gistId, cfg.token, {});
  const file = g.files && g.files[FILE];
  if (!file) throw new Error('该 Gist 里没有 ' + FILE);
  const state = await decryptState(file.content, sessionPassword);
  return { state, updatedAt: g.updated_at, bills: Array.isArray(state.bills) ? state.bills.length : 0 };
}

// 用远端数据覆盖本机。注意：本机 token / 密码配置不跟随云端，避免被空配置冲掉
export function applyRemote(remote) {
  if (!remote || !Array.isArray(remote.bills)) throw new Error('远端数据校验失败');
  const localSync = { ...syncCfg() };
  const st = S();
  STATE_KEYS.forEach((k) => { if (remote[k] !== undefined) st[k] = remote[k]; });
  if (!st.settings) st.settings = {};
  st.settings.sync = localSync;
  save();
}

export const fmtTime = (ts) => {
  if (!ts) return '从未同步';
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};
