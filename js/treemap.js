// 方块占比视图（SpaceSniffer 风格 squarified treemap）
// 只负责「布局算法 + 渲染 + 交互」，数据由调用方（dashboard.js）组装成树：
//   { name, value, color, children: [...], leaf?: true, note?: string }
// 设计要点（都是踩过坑定下来的）：
//   · 每个 node 只在上层的 squarify 里被 push 一次，否则容器块会把自己再当叶子画一遍 → 金额重影
//   · 下钻是「整层仿射缩放」，不换页、不跳路由
//   · canDrill 要求能切出 ≥2 个子块，否则钻进去还是一块，白加一层路径
//   · 明度靠 --ov：容器压暗当外壳，叶子按层级越往里越亮

export const MIN_AREA = 2200;   // 子块小于这个面积就不再切，避免切出一堆读不出信息的碎片

function worst(vals, sum, total, w, h, horiz) {
  let mx = 0;
  if (horiz) {
    const rw = (sum / total) * w;
    for (const v of vals) { const ih = (v / sum) * h; mx = Math.max(mx, rw / ih, ih / rw); }
  } else {
    const rh = (sum / total) * h;
    for (const v of vals) { const iw = (v / sum) * w; mx = Math.max(mx, rh / iw, iw / rh); }
  }
  return mx;
}

export function squarify(items, rect) {
  const out = [];
  let list = items.slice().sort((a, b) => b.value - a.value);
  let { x, y, w, h } = rect;
  let total = list.reduce((s, d) => s + d.value, 0);
  if (total <= 0 || w <= 0 || h <= 0) return out;
  while (list.length) {
    const horiz = w >= h;
    const row = []; let sum = 0, best = Infinity;
    for (let i = 0; i < list.length; i++) {
      const v = list[i].value;
      const r = worst(row.concat([v]), sum + v, total, w, h, horiz);
      if (!row.length || r <= best) { row.push(v); sum += v; best = r; } else break;
    }
    const frac = sum / total;
    if (horiz) {
      const rw = w * frac; let cy = y;
      row.forEach((v, i) => { const ih = (v / sum) * h; out.push({ node: list[i], x, y: cy, w: rw, h: ih }); cy += ih; });
      x += rw; w -= rw;
    } else {
      const rh = h * frac; let cx = x;
      row.forEach((v, i) => { const iw = (v / sum) * w; out.push({ node: list[i], x: cx, y, w: iw, h: rh }); cx += iw; });
      y += rh; h -= rh;
    }
    list = list.slice(row.length); total -= sum;
  }
  return out;
}

export function layoutTree(node, rect, depth, maxDepth, out, minArea = 0) {
  const kids = (node.children || []).filter((k) => k.value > 0);
  // depth 0 允许只有 1 个子项：真实账本里「收入」常常只有「工资」一个一级分类，
  // 若在这里直接 return 会整张图空白（kids.length<2 的限制只对更深层生效）
  if (depth >= maxDepth || (kids.length < 2 && depth > 0)) return;
  // minArea 只在 depth>=1 生效：第一层必须切，否则根节点一刀不切会整张空白
  if (minArea && depth >= 1) {
    const total = kids.reduce((s, k) => s + k.value, 0) || 1;
    const smallest = (Math.min(...kids.map((k) => k.value)) / total) * (rect.w * rect.h);
    if (smallest < minArea) return;
  }
  squarify(kids, rect).forEach((b) => {
    const sub = (b.node.children || []).filter((k) => k.value > 0);
    const want = depth + 1 < maxDepth && sub.length > 0;
    const bar = (want && b.h > 40 && b.w > 60) ? 15 : 0;
    const self = { node: b.node, x: b.x, y: b.y, w: b.w, h: b.h, depth: depth + 1, bar, expand: want };
    out.push(self);
    const g = 1;   // 容器留白；分割线由各自的 1px border 承担
    const inner = { x: b.x + g, y: b.y + bar + g, w: Math.max(0, b.w - g * 2), h: Math.max(0, b.h - bar - g * 2) };
    if (want && inner.w > 12 && inner.h > 12) {
      const before = out.length;
      layoutTree(b.node, inner, depth + 1, maxDepth, out, minArea);
      // 实际没切出子块（被 minArea / 单子项拦下）→ 降级成实心块，
      // 否则会出现"一条孤零零的标题条 + 一大片空白"
      if (out.length === before) { self.expand = false; self.bar = 0; }
    } else {
      self.expand = false; self.bar = 0;
    }
  });
}

// 聚拢：占比低于阈值的碎块合并成「其他 N 项」
export function gather(node, minPct) {
  if (!node.children || !node.children.length) return node;
  const kids = node.children.filter((k) => k.value > 0).sort((a, b) => b.value - a.value);
  const total = kids.reduce((s, k) => s + k.value, 0) || 1;
  const keep = kids.filter((k) => k.value / total >= minPct);
  const rest = kids.filter((k) => k.value / total < minPct);
  if (rest.length >= 2) {
    keep.push({
      name: `其他 ${rest.length} 项`, color: '#5c5c61', value: rest.reduce((s, k) => s + k.value, 0),
      children: [], leaf: true, restOf: rest.map((k) => k.name),
    });
  } else if (rest.length === 1) keep.push(rest[0]);
  return { ...node, children: keep };
}

export function deepGather(n, minPct) {
  if (!n.children || !n.children.length) return n;
  const g = gather(n, minPct);
  return { ...g, children: g.children.map((c) => deepGather(c, minPct)) };
}

export const canDrill = (n) => !n.leaf && (n.children || []).filter((k) => k.value > 0).length >= 2;

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function countLeaves(n) {
  return n.leaf ? 1 : (n.children || []).reduce((s, c) => s + countLeaves(c), 0);
}

/**
 * 挂载方块占比视图。
 * @param {HTMLElement} el 容器
 * @param {{root:object, money:(n)=>string, moneyTight:(n)=>string, path?:string[], onPath?:(p:string[])=>void, maxDepth?:number}} opts
 * @returns {{destroy:()=>void}}
 */
export function mountTreemap(el, opts) {
  const root = opts.root;
  const money = opts.money || ((n) => '¥' + Math.round(n));
  const moneyTight = opts.moneyTight || money;
  const maxDepth = opts.maxDepth || 3;
  const st = { path: (opts.path || []).slice(), sel: null, zoom: null };

  // note 放在 map 外面：render() 只重建 map 内部，状态栏/提示不会被冲掉
  el.innerHTML = `
    <div class="tm-crumb"></div>
    <div class="tm-map"></div>
    <div class="tm-note"></div>`;
  const crumb = el.querySelector('.tm-crumb');
  const map = el.querySelector('.tm-map');
  const note = el.querySelector('.tm-note');

  let tip = document.getElementById('tm-tip');
  if (!tip) {
    tip = document.createElement('div');
    tip.id = 'tm-tip';
    tip.className = 'tm-tip';
    document.body.appendChild(tip);
  }
  const hideTip = () => { tip.style.display = 'none'; };

  // 逐层找，找不到就截断 —— 否则切维度后路径失效，会出现"层级多了一层但视图没变"
  function current() {
    let n = root;
    const ok = [];
    for (const id of st.path) {
      const nx = (n.children || []).find((c) => c.name === id);
      if (!nx) break;
      ok.push(id); n = nx;
    }
    if (ok.length !== st.path.length) st.path = ok;
    return deepGather(n, 0.02);
  }

  let toastT = null;
  function toast(msg) {
    note.textContent = msg;
    note.classList.add('show');
    clearTimeout(toastT);
    toastT = setTimeout(() => { note.classList.remove('show'); setStatus(); }, 1700);
  }

  function drill(node, rect) {
    if (!canDrill(node)) { toast(`「${node.name}」没有更细的分类`); return; }
    st.zoom = rect ? { dir: 'in', rect } : null;
    st.path.push(node.name);
    st.sel = null;
    opts.onPath?.(st.path.slice());
    render();
  }

  function goUp(i) {
    if (!st.path.length) return;
    st.zoom = { dir: 'out', find: st.path[st.path.length - 1] };
    st.path = i < 0 ? [] : st.path.slice(0, i + 1);
    st.sel = null;
    opts.onPath?.(st.path.slice());
    render();
  }

  function select(node, blk) {
    st.sel = node;
    map.querySelectorAll('.blk.sel').forEach((b) => b.classList.remove('sel'));
    if (blk) blk.classList.add('sel');
    setStatus();
  }

  // 原地缩放：先把新布局整体缩回「被点击那块」的矩形内，再长大铺满。
  // 只对整个 layer 做一次仿射变换 —— 所有新块经历的缩放和平移是同一个。
  function applyZoom(layer, W, H) {
    const z = st.zoom;
    st.zoom = null;
    if (!z) return;
    let r = null;
    if (z.dir === 'in') r = z.rect;
    else {
      const e = [...layer.querySelectorAll('.blk')].find((x) => x._node && x._node.name === z.find);
      if (e && e._rect) r = e._rect;
    }
    if (!r || !r.w || !r.h) return;
    const sx = z.dir === 'in' ? r.w / W : W / r.w;
    const sy = z.dir === 'in' ? r.h / H : H / r.h;
    const tx = z.dir === 'in' ? r.x : -r.x * sx;
    const ty = z.dir === 'in' ? r.y : -r.y * sy;
    layer.classList.add('zooming');                 // 动画中先藏文字，避免小字号糊成一团
    layer.style.transition = 'none';
    layer.style.transform = `translate(${tx}px, ${ty}px) scale(${sx}, ${sy})`;
    void layer.offsetWidth;                          // 强制回流，让起始状态生效
    layer.style.transition = 'transform .42s cubic-bezier(.32,.72,.34,1)';
    layer.style.transform = 'translate(0px, 0px) scale(1, 1)';
    clearTimeout(layer._zt);
    layer._zt = setTimeout(() => layer.classList.remove('zooming'), 280);
  }

  function showTip(e, node, total) {
    tip.style.display = 'block';
    tip.style.left = Math.min(e.clientX + 14, window.innerWidth - 300) + 'px';
    tip.style.top = (e.clientY + 16) + 'px';
    const sub = node.restOf
      ? `已合并 ${node.restOf.length} 项：${node.restOf.slice(0, 4).join('、')}${node.restOf.length > 4 ? ' …' : ''}`
      : node.leaf ? (node.note || '')
        : `${countLeaves(node)} 笔 · ${(node.children || []).length} 个子项（双击进入）`;
    tip.innerHTML = `<b>${esc(node.name)}</b>`
      + `<span>${money(node.value)} · 占当前视图 ${total ? ((node.value / total) * 100).toFixed(1) : '0.0'}%</span>`
      + (sub ? `<em>${esc(sub)}</em>` : '');
  }

  function render() {
    const node = current();
    // 高度必须显式写回：块的定位是 absolute，容器高度一旦为 0（CSS 没加载到 / 布局未完成）
    // 整张图就会被 overflow:hidden 裁成空白，且看不出任何报错
    const W = map.clientWidth || 600;
    const H = map.clientHeight || 320;
    map.style.height = H + 'px';
    map.innerHTML = '<div class="tm-layer"></div>';
    const layer = map.querySelector('.tm-layer');

    if (!node || !node.value) {
      layer.innerHTML = '<div class="tm-empty">本区间暂无数据</div>';
      crumb.innerHTML = '';
      note.textContent = '';
      return;
    }

    const boxes = [];
    layoutTree(node, { x: 0, y: 0, w: W, h: H }, 0, maxDepth, boxes, MIN_AREA);
    boxes.sort((a, b) => a.depth - b.depth);        // 父块先画，子块盖在上面
    boxes.forEach((b) => {
      if (b.w < 5 || b.h < 5) return;               // 过小的碎片不画，只留底色
      const el2 = document.createElement('div');
      el2.className = 'blk' + (b.expand ? ' parent' : '') + (canDrill(b.node) ? '' : ' solid');
      el2.style.cssText = `left:${b.x}px;top:${b.y}px;width:${b.w}px;height:${b.h}px`;
      const c = b.node.color || '#3a3a3c';
      // 明度分层：容器（外壳）最暗，叶子按层级越深越亮
      el2.style.setProperty('--ov', b.expand ? (b.depth === 0 ? 0.64 : 0.56) : Math.max(0.20, 0.44 - b.depth * 0.08));
      const pct = node.value ? ((b.node.value / node.value) * 100).toFixed(1) : '0';
      el2.innerHTML = `<div class="blk-fill" style="background:${c}"></div>`;
      // 容器：顶部亮色标签条，"名称 - 金额" 一行（SpaceSniffer 文件夹标题的画法）
      if (b.bar) {
        const amt = b.w >= 60 ? ` <span class="t-amt">- ${b.w >= 110 ? money(b.node.value) : moneyTight(b.node.value)}</span>` : '';
        el2.innerHTML += `<div class="b-tag" style="background:linear-gradient(rgba(255,255,255,.42),rgba(255,255,255,.42)), ${c}">${esc(b.node.name)}${amt}</div>`;
      }
      // 叶子：名称 / 金额 / 占比 居中，三档门槛互相包含（有金额必有名称、有占比必有金额）
      if (!b.expand) {
        const showNm = b.w >= 34 && b.h >= 20;
        const showAmt = b.w >= 50 && b.h >= 32;
        const showPct = b.w >= 68 && b.h >= 54;
        const tight = b.w < 76;
        if (showNm) {
          el2.innerHTML += `<div class="b-in${tight ? ' tight' : ''}">
            <div class="b-nm${b.w < 64 ? ' wrap' : ''}">${esc(b.node.name)}</div>
            ${showAmt ? `<div class="b-amt">${tight ? moneyTight(b.node.value) : money(b.node.value)}</div>` : ''}
            ${showPct ? `<div class="b-pct">${pct}%</div>` : ''}
          </div>`;
        }
      }
      el2._node = b.node;
      el2._depth = b.depth;
      el2._rect = b;
      el2.addEventListener('click', (e) => { e.stopPropagation(); select(b.node, el2); });
      el2.addEventListener('dblclick', (e) => { e.stopPropagation(); drill(b.node, b); });
      el2.addEventListener('mouseenter', () => el2.classList.add('hot'));
      el2.addEventListener('mousemove', (e) => showTip(e, b.node, node.value));
      el2.addEventListener('mouseleave', () => { el2.classList.remove('hot'); hideTip(); });
      layer.appendChild(el2);
    });
    applyZoom(layer, W, H);

    // 面包屑
    let html = `<button data-up="-1">${esc(root.name)}</button>`;
    let acc = root;
    st.path.forEach((id, i) => {
      acc = (acc.children || []).find((c) => c.name === id) || acc;
      html += '<span>›</span>'
        + (i === st.path.length - 1 ? `<b>${esc(acc.name)}</b>` : `<button data-up="${i}">${esc(acc.name)}</button>`);
    });
    if (st.path.length) html += ` <button class="tm-back" data-up="${st.path.length - 1}">返回上一层</button>`;
    crumb.innerHTML = html;
    crumb.querySelectorAll('[data-up]').forEach((btn) => btn.addEventListener('click', () => goUp(+btn.dataset.up)));

    setStatus();
  }

  function setStatus() {
    if (note.classList.contains('show')) return;
    const node = current();
    const sel = st.sel;
    const bits = [
      `${countLeaves(node)} 笔`,
      `合计 <b>${money(node.value)}</b>`,
      sel ? `选中 <b>${esc(sel.name)}</b> ${money(sel.value)}` : '',
    ].filter(Boolean);
    note.innerHTML = bits.join(' · ');
  }

  render();

  // 宽度变化时重排（列数/窗口变化都会改 clientWidth）
  let ro = null;
  if (typeof ResizeObserver !== 'undefined') {
    let last = map.clientWidth;
    ro = new ResizeObserver(() => {
      if (Math.abs(map.clientWidth - last) < 8) return;   // 忽略小数点抖动
      last = map.clientWidth;
      render();
    });
    ro.observe(map);
  }

  return {
    destroy() { ro?.disconnect(); hideTip(); clearTimeout(toastT); el.innerHTML = ''; },
  };
}
