// 一键接入页：设备 A 生成的链接点开后落到这里，自动完成配置 + 拉取
// 用户只需要做两件事：输一次密码、点一下确认
import { S } from '../store.js';
import { go, UI } from '../app.js';
import {
  syncCfg, setSync, fetchRemote, applyState, mergeRemote,
  hasLocalChanges, hasPassword, setPassword, fmtTime, setAuto,
} from '../sync.js';

// 同步码 -> {token, gistId}（导出以便测试编码/解码往返）
export function parseCode(code) {
  const raw = decodeURIComponent(atob(String(code).trim().replace(/^icost1\./, '')));
  const [token, gistId] = raw.split('|');
  if (!token || !gistId) throw new Error('同步码内容不完整');
  return { token, gistId };
}

async function ensurePassword() {
  if (hasPassword()) return true;
  const pw = await UI.prompt('输入设备 A 的同步密码', '两端必须填完全相同的密码才能解开数据', '', 'password');
  if (!pw) return false;
  setPassword(pw);
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
    const fail = (text) => {
      card.innerHTML = `<div class="join-ico">⚠️</div>
        <div class="join-h">接入失败</div>
        <div class="join-p">${text}</div>
        <button class="join-btn" id="join-back">返回</button>`;
      card.querySelector('#join-back').addEventListener('click', () => go('importexport'));
    };

    // 1) 解析链接里的配置
    let pair;
    try {
      if (!params.c) throw new Error('链接里没有配置数据，可能复制时截断了');
      pair = parseCode(params.c);
    } catch (e) { fail(e.message || '链接解析失败'); return; }

    setSync({ token: pair.token, gistId: pair.gistId });
    msg.textContent = '已写入本机配置，正在读取云端…';

    // 2) 要密码才解得开
    if (!(await ensurePassword())) { fail('没有密码无法解密云端数据'); return; }

    // 3) 读云端
    let remote;
    try {
      remote = await fetchRemote();
    } catch (e) {
      const hint = /密码|解密/.test(e.message) ? `${e.message}<br><br>两端密码必须完全一致。` : e.message;
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
