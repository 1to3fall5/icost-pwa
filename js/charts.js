// 轻量 Canvas 图表（零依赖、暗黑主题）
import { fmtMoney } from './store.js';

function setup(canvas, h) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.parentElement.clientWidth || 300;
  canvas.width = w * dpr; canvas.height = h * dpr;
  canvas.style.height = h + 'px';
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  return { ctx, w, h };
}

// 环形图（支出分类详情）
export function donut(canvas, items, centerLabel, centerValue) {
  const { ctx, w, h } = setup(canvas, 240);
  const cx = w / 2, cy = h / 2, r = Math.min(w, h) / 2 - 14, lw = 34;
  ctx.clearRect(0, 0, w, h);
  const total = items.reduce((s, i) => s + i.value, 0);
  if (total <= 0) {
    ctx.beginPath(); ctx.arc(cx, cy, r - lw / 2, 0, Math.PI * 2);
    ctx.strokeStyle = '#3a3a3c'; ctx.lineWidth = lw; ctx.stroke();
  } else {
    let a = -Math.PI / 2;
    const palette = items.length ? null : ['#3a3a3c'];
    items.forEach((it, idx) => {
      const ang = (it.value / total) * Math.PI * 2;
      ctx.beginPath();
      ctx.arc(cx, cy, r - lw / 2, a + 0.012, a + ang - 0.012);
      ctx.strokeStyle = it.color || palette[(idx % palette.length)];
      ctx.lineWidth = lw;
      ctx.lineCap = 'butt';
      ctx.stroke();
      a += ang;
    });
  }
  ctx.fillStyle = '#98989f';
  ctx.font = '12px -apple-system, "PingFang SC"';
  ctx.textAlign = 'center';
  ctx.fillText(centerLabel, cx, cy - 12);
  ctx.fillStyle = '#fff';
  ctx.font = '800 24px -apple-system, "PingFang SC"';
  ctx.fillText(centerValue, cx, cy + 16);
}

// 竖条图（每日支出统计图）
export function bars(canvas, values, opts = {}) {
  const { ctx, w, h } = setup(canvas, opts.height || 150);
  ctx.clearRect(0, 0, w, h);
  const n = values.length || 1;
  const gap = 3, bw = Math.max(2, Math.min(10, (w / n) - gap));
  const max = Math.max(...values, 0.01);
  values.forEach((v, i) => {
    const x = (i + 0.5) * (w / n) - bw / 2;
    const bh = Math.max(2, (v / max) * (h - 14));
    ctx.fillStyle = opts.color || (v > 0 ? '#5a5a5e' : '#3a3a3c');
    const y = h - bh;
    ctx.beginPath();
    ctx.roundRect(x, y, bw, bh, bw / 2);
    ctx.fill();
  });
}

// 折线趋势图（净资产走势）
export function line(canvas, values, labels) {
  const { ctx, w, h } = setup(canvas, 200);
  ctx.clearRect(0, 0, w, h);
  const padL = 34, padR = 8, padT = 16, padB = 24;
  const max = Math.max(...values, 1), min = Math.min(...values, 0);
  const X = (i) => padL + (i / Math.max(values.length - 1, 1)) * (w - padL - padR);
  const Y = (v) => padT + (1 - (v - min) / Math.max(max - min, 0.0001)) * (h - padT - padB);
  // 网格虚线 + y 轴刻度
  ctx.strokeStyle = 'rgba(255,255,255,.12)';
  ctx.fillStyle = '#636366';
  ctx.font = '10px -apple-system';
  ctx.lineWidth = 1;
  const steps = 5;
  for (let i = 0; i <= steps; i++) {
    const v = min + ((max - min) / steps) * i;
    const y = Y(v);
    ctx.setLineDash([3, 4]);
    ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(w - padR, y); ctx.stroke();
    ctx.setLineDash([]);
    ctx.textAlign = 'right';
    ctx.fillText(v >= 1000 ? (v / 1000).toFixed(1) + 'k' : v.toFixed(2).replace(/(\.\d\d)0+$/, '$1'), padL - 6, y + 3);
  }
  // x 轴标签
  ctx.textAlign = 'center';
  (labels || []).forEach((lb, i) => {
    const idx = Math.round((i / (labels.length - 1)) * (values.length - 1));
    ctx.fillText(lb, X(idx), h - 6);
  });
  // 线
  const allZero = values.every((v) => v === 0);
  ctx.beginPath();
  values.forEach((v, i) => i ? ctx.lineTo(X(i), Y(v)) : ctx.moveTo(X(i), Y(v)));
  ctx.strokeStyle = '#ffd60a';
  ctx.lineWidth = 2;
  if (allZero) ctx.setLineDash([4, 4]);
  ctx.stroke();
  ctx.setLineDash([]);
  // 端点
  const li = values.length - 1;
  ctx.beginPath();
  ctx.arc(X(li), Y(values[li]), 4, 0, Math.PI * 2);
  ctx.fillStyle = '#ffd60a';
  ctx.fill();
  ctx.beginPath();
  ctx.arc(X(li), Y(values[li]), 2, 0, Math.PI * 2);
  ctx.fillStyle = '#000';
  ctx.fill();
}

// 横向占比列表渲染辅助
export function rankList(el, items, total) {
  el.innerHTML = items.map((it) => `
    <div class="bill-row" data-cat="${it.id}">
      <div class="bill-ic" style="background:${it.color}22">${it.icon || ''}</div>
      <div class="bill-main">
        <div class="bill-cat">${it.name}</div>
        <div class="rank-bar" style="height:4px;border-radius:2px;background:#2c2c2e;margin-top:6px;overflow:hidden">
          <i style="display:block;height:100%;width:${total ? Math.max(2, (it.value / total) * 100) : 0}%;background:${it.color};border-radius:2px"></i>
        </div>
      </div>
      <div style="text-align:right">
        <div class="bill-amt">¥${fmtMoney(it.value)}</div>
        <div style="font-size:11px;color:#636366;margin-top:2px">${total ? ((it.value / total) * 100).toFixed(1) : '0.0'}%</div>
      </div>
    </div>`).join('');
}
