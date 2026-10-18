// 轻量 Canvas 图表（零依赖、暗黑主题）
import { fmtMoney } from './store.js';

// 高度优先取「容器」的布局高度（卡片格子给多少就画多高），拿不到才用调用方给的 fallback。
// 取容器而不是 canvas 自身：canvas 上一次被写死过 inline height，读自己会拿到旧值、尺寸就锁死了。
function setup(canvas, fallbackH) {
  const dpr = window.devicePixelRatio || 1;
  const parent = canvas.parentElement;
  const w = parent.clientWidth || 300;
  const h = Math.max(60, Math.round(parent.clientHeight || fallbackH || 150));
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
// opts: { height, color, fill（渐变面积）, padL, fmt(v) 刻度格式化 }
export function line(canvas, values, labels, opts = {}) {
  const { ctx, w, h } = setup(canvas, opts.height || 200);
  ctx.clearRect(0, 0, w, h);
  const padL = opts.padL ?? 34, padR = 8, padT = 16, padB = 24;
  const color = opts.color || '#ffd60a';
  const max = Math.max(...values, 1), min = Math.min(...values, 0);
  const X = (i) => padL + (i / Math.max(values.length - 1, 1)) * (w - padL - padR);
  const Y = (v) => padT + (1 - (v - min) / Math.max(max - min, 0.0001)) * (h - padT - padB);
  const tick = opts.fmt || ((v) => (v >= 1000 ? (v / 1000).toFixed(1) + 'k' : v.toFixed(2).replace(/(\.\d\d)0+$/, '$1')));
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
    ctx.fillText(tick(v), padL - 6, y + 3);
  }
  // x 轴标签
  ctx.textAlign = 'center';
  (labels || []).forEach((lb, i) => {
    const idx = Math.round((i / (labels.length - 1)) * (values.length - 1));
    ctx.fillText(lb, X(idx), h - 6);
  });
  // 面积填充（需在折线之前画，否则会盖住线）
  if (opts.fill && values.length > 1) {
    const g = ctx.createLinearGradient(0, padT, 0, h - padB);
    g.addColorStop(0, color + '55');
    g.addColorStop(1, color + '00');
    ctx.beginPath();
    ctx.moveTo(X(0), h - padB);
    values.forEach((v, i) => ctx.lineTo(X(i), Y(v)));
    ctx.lineTo(X(values.length - 1), h - padB);
    ctx.closePath();
    ctx.fillStyle = g;
    ctx.fill();
  }
  // 线
  const allZero = values.every((v) => v === 0);
  ctx.beginPath();
  values.forEach((v, i) => i ? ctx.lineTo(X(i), Y(v)) : ctx.moveTo(X(i), Y(v)));
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  if (allZero) ctx.setLineDash([4, 4]);
  ctx.stroke();
  ctx.setLineDash([]);
  // 端点
  const li = values.length - 1;
  ctx.beginPath();
  ctx.arc(X(li), Y(values[li]), 4, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(X(li), Y(values[li]), 2, 0, Math.PI * 2);
  ctx.fillStyle = '#000';
  ctx.fill();
}

// 多条折线（分类趋势对比）
// series: [{ name, color, values }]
export function multiLine(canvas, series, labels, opts = {}) {
  const { ctx, w, h } = setup(canvas, opts.height || 180);
  ctx.clearRect(0, 0, w, h);
  const padL = opts.padL ?? 34, padR = 8, padT = 14, padB = 22;
  const all = (series || []).flatMap((s) => s.values);
  const max = Math.max(...all, 1), min = 0;
  const X = (i, n) => padL + (i / Math.max(n - 1, 1)) * (w - padL - padR);
  const Y = (v) => padT + (1 - (v - min) / Math.max(max - min, 0.0001)) * (h - padT - padB);
  ctx.strokeStyle = 'rgba(255,255,255,.10)';
  ctx.fillStyle = '#636366';
  ctx.font = '10px -apple-system';
  for (let i = 0; i <= 3; i++) {
    const v = min + ((max - min) / 3) * i;
    const y = Y(v);
    ctx.setLineDash([3, 4]);
    ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(w - padR, y); ctx.stroke();
    ctx.setLineDash([]);
    ctx.textAlign = 'right';
    ctx.fillText(v >= 1000 ? (v / 1000).toFixed(1) + 'k' : v.toFixed(0), padL - 6, y + 3);
  }
  ctx.textAlign = 'center';
  (labels || []).forEach((lb, i) => {
    const idx = Math.round((i / (labels.length - 1)) * ((series[0]?.values.length || 1) - 1));
    ctx.fillText(lb, X(idx, series[0]?.values.length || 1), h - 6);
  });
  (series || []).forEach((s) => {
    const n = s.values.length;
    ctx.beginPath();
    s.values.forEach((v, i) => (i ? ctx.lineTo(X(i, n), Y(v)) : ctx.moveTo(X(i, n), Y(v))));
    ctx.strokeStyle = s.color || '#ff9f0a';
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.stroke();
    s.values.forEach((v, i) => {
      ctx.beginPath();
      ctx.arc(X(i, n), Y(v), 2.6, 0, Math.PI * 2);
      ctx.fillStyle = s.color || '#ff9f0a';
      ctx.fill();
    });
  });
}

// 收支双色柱（每个周期两根：支出 / 收入）
export function dualBars(canvas, exp, inc, labels, opts = {}) {
  const { ctx, w, h } = setup(canvas, opts.height || 180);
  ctx.clearRect(0, 0, w, h);
  const n = Math.max(exp.length, inc.length, 1);
  const padL = opts.padL ?? 34, padR = 6, padT = 12, padB = 22;
  const max = Math.max(...exp, ...inc, 1);
  const Y = (v) => padT + (1 - v / max) * (h - padT - padB);
  ctx.strokeStyle = 'rgba(255,255,255,.10)';
  ctx.fillStyle = '#636366';
  ctx.font = '10px -apple-system';
  for (let i = 0; i <= 3; i++) {
    const v = (max / 3) * i;
    const y = Y(v);
    ctx.setLineDash([3, 4]);
    ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(w - padR, y); ctx.stroke();
    ctx.setLineDash([]);
    ctx.textAlign = 'right';
    ctx.fillText(v >= 1000 ? (v / 1000).toFixed(1) + 'k' : v.toFixed(0), padL - 6, y + 3);
  }
  const slot = (w - padL - padR) / n;
  const bw = Math.max(3, Math.min(16, slot / 2 - 4));
  for (let i = 0; i < n; i++) {
    const cx = padL + slot * (i + 0.5);
    const x1 = cx - bw - 1.5, x2 = cx + 1.5;
    [[x1, exp[i] || 0, '#ff453a'], [x2, inc[i] || 0, '#30d158']].forEach(([x, v, c]) => {
      const y = Y(v);
      const bh = Math.max(v > 0 ? 2 : 0, (h - padB) - y);
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.roundRect(x, y, bw, bh, Math.min(4, bw / 2));
      ctx.fill();
    });
    if (labels && labels[i]) {
      ctx.fillStyle = '#636366';
      ctx.textAlign = 'center';
      ctx.fillText(labels[i], cx, h - 6);
    }
  }
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
