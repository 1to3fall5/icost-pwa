// 分类管理：一级 / 二级分类的增删改
import Icons from '../icons.js';
import { S, save, cats, uid } from '../store.js';
import { esc } from '../util.js';
import { UI } from '../app.js';

const PALETTE = [
  ['#ff453a', '红'], ['#ff9f0a', '橙'], ['#ffd60a', '黄'], ['#30d158', '绿'],
  ['#64d2ff', '浅蓝'], ['#0a84ff', '蓝'], ['#bf5af2', '紫'], ['#ff6482', '粉'],
];
const RANDOM_ICONS = ['🛒', '🎯', '🧩', '⚡', '🌟', '🧃', '🏦'];
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

let type = 'expense';        // 当前 seg
const open = new Set();      // 已展开的一级分类 id

function catBills(c) {
  return S().bills.filter((b) => b.categoryId === c.id || c.children.some((x) => x.id === b.categoryId)).length;
}

function catHTML(c) {
  const expanded = open.has(c.id);
  return `<div class="cg-item">
    <div class="cell" data-cat="${c.id}">
      <span class="cg-ic" style="background:${c.color}22;color:${c.color}">${c.icon}</span>
      <span class="cl">${esc(c.name)}<span class="cell-sub">${c.children.length} 个二级分类</span></span>
      <span class="cg-edit" data-edit="${c.id}">✏️</span>
    </div>
    ${expanded ? `<div class="cg-subs">
      ${c.children.map((s) => `<span class="cg-chip" data-sub="${s.id}">${esc(s.name)}<i class="x" data-del="${s.id}">${Icons.x}</i></span>`).join('')}
      <span class="cg-chip add" data-addsub="${c.id}">+ 二级分类</span>
    </div>` : ''}
  </div>`;
}

function listHTML() {
  const list = cats(type);
  return `${list.map(catHTML).join('')}`;
}

async function addTop() {
  const name = await UI.prompt('新建一级分类', '请输入分类名称');
  if (!name) return;
  const c = { id: uid(), name, icon: pick(RANDOM_ICONS), color: pick(PALETTE)[0], type, children: [] };
  S().categories[type].push(c);
  save();
  open.add(c.id);
  UI.toast('已添加分类');
  return true;
}

async function addSub(pid) {
  const parent = cats(type).find((c) => c.id === pid);
  if (!parent) return false;
  const name = await UI.prompt(`为「${parent.name}」添加二级分类`, '请输入二级分类名称');
  if (!name) return false;
  parent.children.push({ id: uid(), name });
  save();
  UI.toast('已添加二级分类');
  return true;
}

async function editCat(id) {
  const c = cats(type).find((x) => x.id === id);
  if (!c) return false;
  const pickOpt = await UI.sheet(c.name, [
    { label: '修改名称', icon: '✏️', v: 'name' },
    { label: '修改图标', icon: c.icon, v: 'icon' },
    { label: '修改颜色', icon: '🎨', v: 'color' },
    { label: '删除分类', icon: '🗑️', color: 'rgba(255,69,58,.18)', v: 'del' },
  ]);
  if (!pickOpt) return false;
  if (pickOpt.v === 'name') {
    const name = await UI.prompt('修改分类名称', c.name, c.name);
    if (!name) return false;
    c.name = name; save(); UI.toast('已保存');
    return true;
  }
  if (pickOpt.v === 'icon') {
    const icon = await UI.prompt('修改图标', '输入一个 emoji，如 🍜', c.icon);
    if (!icon) return false;
    c.icon = icon; save(); UI.toast('已保存');
    return true;
  }
  if (pickOpt.v === 'color') {
    const color = await UI.sheet('选择颜色', PALETTE.map(([hex, nm]) => ({
      label: nm, icon: '●', color: hex, v: hex,
    })));
    if (!color) return false;
    c.color = color.v; save(); UI.toast('已保存');
    return true;
  }
  if (pickOpt.v === 'del') {
    const used = catBills(c);
    const msg = used > 0
      ? `「${c.name}」下已有 ${used} 笔账单，删除后这些账单将归入「其他」，确认删除？`
      : `确认删除分类「${c.name}」？`;
    const ok = await UI.confirm(msg, '删除');
    if (!ok) return false;
    const list = cats(type);
    list.splice(list.indexOf(c), 1);
    // 已引用该分类的账单回落到「其他」
    const other = (S().categories[type] || []).find((x) => x.name === '其他') || S().categories[type][S().categories[type].length - 1];
    if (other) S().bills.forEach((b) => {
      if (b.categoryId === c.id || c.children.some((x) => x.id === b.categoryId)) b.categoryId = other.id;
    });
    save();
    UI.toast('已删除分类');
    return true;
  }
  return false;
}

async function delSub(id) {
  const parent = cats(type).find((c) => c.children.some((s) => s.id === id));
  const sub = parent?.children.find((s) => s.id === id);
  if (!sub) return false;
  const used = S().bills.filter((b) => b.categoryId === id).length;
  const ok = await UI.confirm(used > 0
    ? `「${sub.name}」下已有 ${used} 笔账单，删除后这些账单将归入「${parent.name}」，确认删除？`
    : `确认删除二级分类「${sub.name}」？`, '删除');
  if (!ok) return false;
  parent.children.splice(parent.children.indexOf(sub), 1);
  if (parent) S().bills.forEach((b) => { if (b.categoryId === id) b.categoryId = parent.id; });
  save();
  UI.toast('已删除');
  return true;
}

export default {
  title: '分类管理',
  header: 'sub',
  async render() {
    const list = cats(type);
    return `
      <div class="seg">
        <button data-t="expense" class="${type === 'expense' ? 'on' : ''}">支出</button>
        <button data-t="income" class="${type === 'income' ? 'on' : ''}">收入</button>
      </div>
      <div class="cell-group">
        <div class="cell" data-act="addtop">
          <span class="ci" style="background:rgba(48,209,88,.18)">➕</span>
          <span class="cl">添加一级分类</span>
          <span class="arrow">${Icons.chevR}</span>
        </div>
      </div>
      <div class="sec-title">${type === 'expense' ? '支出' : '收入'}分类 · ${list.length} 个一级</div>
      <div class="cell-group" id="cg-list">${listHTML()}</div>
      <div class="st2-note">
        <div class="tt">💡 使用提示</div>
        点击一级分类行展开二级分类；点右侧 ✏️ 可改名 / 换图标 / 换颜色 / 删除；二级分类点 × 或长按即可删除。
      </div>`;
  },
  mount(root) {
    const repaint = () => {
      const box = root.querySelector('#cg-list');
      if (box) box.innerHTML = listHTML();
      root.querySelector('.sec-title').textContent =
        `${type === 'expense' ? '支出' : '收入'}分类 · ${cats(type).length} 个一级`;
      bind();
    };
    const refresh = async (changed) => { if (changed) repaint(); };

    function bind() {
      root.querySelectorAll('[data-t]').forEach((b) => b.addEventListener('click', () => {
        if (type === b.dataset.t) return;
        type = b.dataset.t;
        open.clear();
        repaint();
        root.querySelectorAll('[data-t]').forEach((x) => x.classList.toggle('on', x.dataset.t === type));
      }));
      root.querySelectorAll('[data-cat]').forEach((el) => {
        el.addEventListener('click', () => {
          const id = el.dataset.cat;
          if (open.has(id)) open.delete(id); else open.add(id);
          repaint();
        });
      });
      root.querySelectorAll('[data-edit]').forEach((el) => {
        el.addEventListener('click', async (e) => {
          e.stopPropagation();
          refresh(await editCat(el.dataset.edit));
        });
      });
      root.querySelectorAll('[data-addsub]').forEach((el) => {
        el.addEventListener('click', async () => { refresh(await addSub(el.dataset.addsub)); });
      });
      root.querySelectorAll('[data-del]').forEach((el) => {
        const fire = async () => { refresh(await delSub(el.dataset.del)); };
        el.addEventListener('click', (e) => { e.stopPropagation(); fire(); });
        let timer = null;
        el.addEventListener('touchstart', () => { timer = setTimeout(fire, 600); }, { passive: true });
        el.addEventListener('touchend', () => clearTimeout(timer));
        el.addEventListener('contextmenu', (e) => { e.preventDefault(); fire(); });
      });
    }

    root.querySelector('[data-act="addtop"]')?.addEventListener('click', async () => {
      refresh(await addTop());
    });
    bind();
  },
};
