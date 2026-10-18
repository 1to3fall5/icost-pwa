// 存钱计划 新建（?mode=）/ 详情（?id=）
import { S, save, uid, fmtMoney } from '../store.js';
import { go, back, UI } from '../app.js';
import { MODES, savedOf, periodNo, nextAmount, targetOf, defaultName, punch } from './save.js';

const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// 各存钱法规则说明
const DESC = {
  fixed: '每期以<b>固定金额</b>存入，坚持打卡，积少成多。',
  flexible: '不设固定金额，<b>想存就存</b>，随时打卡记录一笔。',
  week52: '<b>第 n 周存 10×n 元</b>：第 1 周存 10 元、第 2 周存 20 元……坚持 52 周，全年累计 <b>13,780 元</b>。',
  day365: '<b>第 n 天存 0.1×n 元</b>（可选阶梯递增）：第 1 天 0.1 元、第 2 天 0.2 元……坚持 365 天累计 <b>6,679.5 元</b>。',
};

const pctOf = (p) => (p.target > 0 ? Math.min(100, (savedOf(p) / p.target) * 100) : 0);

// ---- 进度环 ----
function ringHTML(p) {
  const pct = pctOf(p);
  const C = (2 * Math.PI * 52).toFixed(2);
  const off = (C * (1 - pct / 100)).toFixed(2);
  return `<div class="sv-ring-wrap">
    <svg class="sv-ring" viewBox="0 0 120 120">
      <circle class="bg" cx="60" cy="60" r="52"></circle>
      <circle class="fg" cx="60" cy="60" r="52" stroke-dasharray="${C}" stroke-dashoffset="${off}"
        style="stroke:${pct >= 100 ? 'var(--green)' : 'var(--blue)'}"></circle>
    </svg>
    <div class="sv-ring-center">
      <div class="sv-ring-amount">${Math.round(pct)}%</div>
      <div class="sv-ring-sub">已存 ¥${fmtMoney(savedOf(p))}</div>
    </div>
  </div>`;
}

// ---- 详情主体（打卡 / 编辑后局部重渲染） ----
function bodyHTML(p) {
  const meta = MODES[p.mode] || MODES.fixed;
  const saved = savedOf(p);
  const recs = (p.records || []).slice().reverse();
  const nx = nextAmount(p);
  const done = p.target > 0 && saved >= p.target;
  return `
    ${done ? `<div class="sv-done">🎉 目标达成！已累计存入 ¥${fmtMoney(saved)}</div>` : ''}
    ${ringHTML(p)}
    <div class="cell-group">
      <div class="cell"><span class="cl cell-title">模式</span><span class="cv">${meta.label}</span></div>
      <div class="cell"><span class="cl cell-title">开始日期</span><span class="cv">${p.startDate}</span></div>
      <div class="cell"><span class="cl cell-title">目标金额</span><span class="cv">¥${fmtMoney(p.target)}</span></div>
      ${nx ? `<div class="cell"><span class="cl cell-title">本期建议</span><span class="cv">¥${fmtMoney(nx)}</span></div>` : ''}
      <div class="cell"><span class="cl cell-title">已打卡</span><span class="cv">${(p.records || []).length} 次 · 共 ¥${fmtMoney(saved)}</span></div>
      ${p.note ? `<div class="cell"><span class="cl cell-title">备注</span><span class="cv">${p.note}</span></div>` : ''}
    </div>
    <div class="sec-title">打卡记录（${recs.length}）</div>
    <div class="cell-group">
      ${recs.length
        ? recs.map((r) => `<div class="sv-rec"><span class="d">${r.date}</span><span class="a">+¥${fmtMoney(r.amount)}</span></div>`).join('')
        : '<div class="sv-rec"><span class="d">暂无打卡记录</span></div>'}
    </div>
    <button class="sv-big" data-act="add">存入一笔${nx && p.mode !== 'flexible' ? ` ¥${fmtMoney(nx)}` : ''}</button>
    <div style="display:flex;gap:10px;margin-top:12px">
      <button class="form-input" data-act="edit" style="flex:1;text-align:center;background:var(--card2)">编辑</button>
      <button class="form-input" data-act="del" style="flex:1;text-align:center;background:rgba(255,69,58,.14);color:var(--red)">删除计划</button>
    </div>`;
}

// ---- 新建表单 ----
function formHTML(mode) {
  const tg = targetOf(mode);
  return `
    <div class="sv-desc">${DESC[mode]}</div>
    <div class="form-group">
      <label class="form-label">计划名称</label>
      <input class="form-input" id="sd-name" value="${defaultName(mode)}" placeholder="输入计划名称">
    </div>
    <div class="form-group">
      <label class="form-label">目标金额${mode === 'week52' || mode === 'day365' ? '（已按规则算出，可修改）' : ''}</label>
      <input class="form-input" id="sd-target" type="number" inputmode="decimal" value="${tg || ''}" placeholder="输入目标金额">
    </div>
    ${mode === 'fixed' || mode === 'flexible'
      ? `<div class="form-group">
          <label class="form-label">每期金额${mode === 'flexible' ? '（建议值，打卡时可修改）' : ''}</label>
          <input class="form-input" id="sd-per" type="number" inputmode="decimal" placeholder="输入每期金额">
        </div>`
      : ''}
    <div class="form-group">
      <label class="form-label">开始日期</label>
      <input class="form-input" id="sd-start" type="date" value="${todayStr()}">
    </div>
    <div class="form-group">
      <label class="form-label">备注（可选）</label>
      <input class="form-input" id="sd-note" placeholder="输入备注">
    </div>`;
}

export default {
  header: 'sub',
  title: (params) =>
    params.mode ? '新建存钱计划' : S().savings.find((x) => x.id === params.id)?.name || '存钱计划',
  navRight: (params) =>
    params.mode ? `<button class="nb-btn text" data-act="sd-save">保存</button>` : '',
  render(params) {
    if (params.mode) {
      const mode = MODES[params.mode] ? params.mode : 'fixed';
      return formHTML(mode);
    }
    const p = S().savings.find((x) => x.id === params.id);
    if (!p) return `<div class="empty-tip">计划不存在或已删除</div>`;
    return `<div id="sd-body">${bodyHTML(p)}</div>`;
  },
  mount(root, params) {
    // ---------- 新建 ----------
    if (params.mode) {
      document.querySelector('#navbar [data-act="sd-save"]')?.addEventListener('click', () => {
        const name = root.querySelector('#sd-name').value.trim();
        const target = parseFloat(root.querySelector('#sd-target').value);
        const per = parseFloat(root.querySelector('#sd-per')?.value || 0);
        const startDate = root.querySelector('#sd-start').value;
        const note = root.querySelector('#sd-note').value.trim();
        if (!name) return UI.toast('请输入计划名称');
        if (!target || target <= 0) return UI.toast('请输入目标金额');
        if (params.mode === 'fixed' && (!per || per <= 0)) return UI.toast('请输入每期金额');
        S().savings.push({
          id: uid(), mode: params.mode, name, target,
          startDate: startDate || todayStr(), perAmount: per || 0, note, records: [],
        });
        save();
        UI.toast('创建成功 ✓');
        go('save');
      });
      return;
    }
    // ---------- 详情 ----------
    const p = S().savings.find((x) => x.id === params.id);
    if (!p) return;
    const rerender = () => {
      const cur = S().savings.find((x) => x.id === params.id);
      const box = root.querySelector('#sd-body');
      if (cur && box) box.innerHTML = bodyHTML(cur);
    };
    root.addEventListener('click', async (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (!act) return;
      const cur = S().savings.find((x) => x.id === params.id);
      if (!cur) return;
      if (act === 'add') {
        if (await punch(cur)) rerender();
      } else if (act === 'edit') {
        const nm = await UI.prompt('计划名称', '输入名称', cur.name);
        if (nm === null) return;
        const tg = await UI.prompt('目标金额', '输入目标金额', String(cur.target), 'number');
        if (tg === null) return;
        if (nm) cur.name = nm;
        if (parseFloat(tg) > 0) cur.target = parseFloat(tg);
        save();
        rerender();
        UI.toast('已保存 ✓');
      } else if (act === 'del') {
        const ok = await UI.confirm('删除该存钱计划？打卡记录将一并删除', '删除');
        if (!ok) return;
        S().savings = S().savings.filter((x) => x.id !== params.id);
        save();
        UI.toast('已删除');
        back();
      }
    });
  },
};
