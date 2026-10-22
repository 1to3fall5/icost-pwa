// 一键接入页：设备 A 生成的链接点开后落到这里，自动完成配置 + 拉取
// 用户只需要做两件事：输一次密码、点一下确认
import { S } from '../store.js';
import { go, UI } from '../app.js';
import {
  syncCfg, setSync, fetchRemote, applyState, mergeRemote,
  hasLocalChanges, hasPassword, setPassword, fmtTime, setAuto,
} from '../sync.js';

// 同步码 -> {token, gistId}
// v2（icost2.）：只带 gistId，token 由用户在目标设备手动填一次。
//   原因：token 一旦塞进链接，分享/粘贴的过程（微信、剪贴板、聊天记录）就是一次明文泄露，
//   而 token 的权限虽小，仍能读写该账号下所有 Gist。
// v1（icost1.）：旧码里带 token，仍然接受 —— 否则老用户手里的码会直接失效。
//   解出来的 token 只是"本次导入用"，不会随着接入链接再次外传。
export function parseCode(code) {
  const s = String(code).trim();
  const raw = decodeURIComponent(atob(s.replace(/^icost[12]\./, '')));
  const parts = raw.split('|');
  const gistId = parts.length > 1 ? parts[1] : parts[0];
  const token = parts.length > 1 ? parts[0] : '';
  if (!gistId) throw new Error('同步码内容不完整');
  return { token, gistId };
}

async function ensurePassword() {
  if (hasPassword()) return true;
  const pw = await UI.prompt('输入设备 A 的同步密码', '两端必须填完全相同的密码才能解开数据', '', 'password');
  if (!pw) return false;
  setPassword(pw);
  return true;
}

// v2 码里没有 token，需要用户手动补一次。返回 false 表示用户取消。
async function ensureToken(parsedToken) {
  if (parsedToken) { setSync({ token: parsedToken }); return true; }
  if (syncCfg().token) return true;          // 本机已经有 token（之前接过），直接复用
  const tk = await UI.prompt(
    '填入 GitHub token',
    '只需勾选 gist 权限；为了安全，接入链接里不再携带 token',
    '', 'password');
  if (!tk) return false;
  setSync({ token: String(tk).trim() });
  return true;
}

export default {
  title: '接入同步',
  header: 'none',
  async render(params) {
    return `<div class="join-wrap">
      <div class="join-card" id="join-card">
        <div class="join-ico">🔗</div>
        <div class="join-h">正在接入…</div>
        <div class="join-p" id="join-msg">读取链接中的配置</div>
      </div>
    </div>`;
  },
  async mount(root, params) {
    const card = root.querySelector('#join-card');
    const msg = root.querySelector('#join-msg');
    // 安全：接口错误信息（HTTP 状态、GitHub 返回体、云端校验失败说明）属于不可信文本，
    // 拼接进 innerHTML 等于给自己开一个存储型 XSS 的口子。这里结构写死，文本一律走 textContent。
    const fail = (text) => {
      card.innerHTML = `<div class="join-ico">⚠️</div>
        <div class="join-h">接入失败</div>
        <div class="join-p" id="join-err"></div>
        <button class="join-btn" id="join-back">返回</button>`;
      const errEl = card.querySelector('#join-err');
      if (errEl) errEl.textContent = String(text ?? '');
      card.querySelector('#join-back').addEventListener('click', () => go('importexport'));
    };

    // 1) 解析链接里的配置
    let pair;
    try {
      if (!params.c) throw new Error('链接里没有配置数据，可能复制时截断了');
      pair = parseCode(params.c);
    } catch (e) { fail(e.message || '链接解析失败'); return; }

    setSync({ gistId: pair.gistId });
    if (!(await ensureToken(pair.token))) { fail('没有 token 无法访问云端 Gist'); return; }
    msg.textContent = '已写入本机配置，正在读取云端…';

    // 2) 要密码才解得开
    if (!(await ensurePassword())) { fail('没有密码无法解密云端数据'); return; }

    // 3) 读云端
    let remote;
    try {
      remote = await fetchRemote();
    } catch (e) {
      const hint = /密码|解密/.test(e.message) ? `${e.message}\n\n两端密码必须完全一致。` : e.message;
      fail(hint);
      return;
    }

    const localCount = S().bills.length;
    const dirty = hasLocalChanges();

    // 4) 让用户选：合并 / 覆盖
    const pick = dirty
      ? await UI.choose(
        `云端 ${remote.bills} 笔（${fmtTime(remote.syncedAt)}），本机也有 ${localCount} 笔未上传的账`,
        [
          { label: '合并两端', desc: '两边的账都留下，推荐' },
          { label: '只要云端的', desc: `丢弃本机这 ${localCount} 笔`, danger: true },
        ])
      : await UI.confirm(
        `云端共 ${remote.bills} 笔账单，更新于 ${fmtTime(remote.syncedAt)}。\n确认接入这份数据？`,
        '接入')
        ? 0 : -1;
    if (pick < 0) { fail('已取消，本机数据没有改动'); return; }

    applyState(pick === 0 ? mergeRemote(remote.state) : remote.state);
    setSync({ lastSync: Date.now(), baseSyncedAt: remote.syncedAt, lastError: '' });
    setAuto(true);
    UI.toast('接入成功，已开始自动同步');
    go('home');
  },
};
