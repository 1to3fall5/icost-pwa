// 账本管理：列表 / 设为当前 / 重命名 / 复制 / 归档 / 删除 / 新建
import Icons from '../icons.js';
import { S, save, uid, addTombstone } from '../store.js';
import { esc } from '../util.js';
import { uiMark, uiInitialMark } from '../uiicon.js';
import { UI } from '../app.js';

// 账本图标不再让用户在 emoji 里挑：统一彩底 + 白色首字，多个账本靠首字区分

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const countOf = (id) => S().bills.filter((b) => b.bookId === id).length;

function rowHTML(b) {
  const cur = S().currentBookId === b.id;
  const n = countOf(b.id);
  return `<div class="cell bk-row${b.archived ? ' archived' : ''}" data-book="${b.id}">
    ${uiInitialMark(b.name, 'bk-ic')}
    <span class="cl">${esc(b.name)}${b.archived ? '<span class="bk-tag">已归档</span>' : ''}<span class="cell-sub">${n} 笔账单</span></span>
    ${cur ? '<span class="bk-flag">✓ 当前</span>' : `<span class="arrow">${Icons.chevR}</span>`}
  </div>`;
}

function bodyHTML() {
  const s = S();
  const live = s.books.filter((b) => !b.archived);
  const archived = s.books.filter((b) => b.archived);
  return `
    <div class="sec-title">我的账本 · ${live.length}</div>
    <div class="cell-group">${live.map(rowHTML).join('')}</div>
    ${archived.length ? `<div class="sec-title">已归档 · ${archived.length}</div>
      <div class="cell-group bk-archived">${archived.map(rowHTML).join('')}</div>` : ''}
    <div class="st2-add" data-act="new">+ 新建账本</div>
    <div class="st2-note">
      <div class="tt">${uiMark('info-circle', 'badge-ic')}账本说明</div>
      每个账本的账单相互独立，「当前账本」决定记账与首页统计的范围；删除账本会同时删除其下所有账单。
    </div>`;
}

async function newBook() {
  const name = await UI.prompt('新建账本', '请输入账本名称');
  if (!name) return false;
  const book = { id: uid(), name, icon: '', archived: false, created: today() };
  S().books.push(book);
  const use = await UI.confirm(`已创建「${name}」，是否设为当前账本？`, '设为当前');
  if (use) S().currentBookId = book.id;
  save();
  UI.toast(use ? '已创建并切换' : '已创建账本');
  return true;
}

async function bookSheet(id) {
  const s = S();
  const b = s.books.find((x) => x.id === id);
  if (!b) return false;
  const n = countOf(b.id);
  const opts = [];
  if (s.currentBookId !== b.id) opts.push({ label: '设为当前账本', icon: 'check', v: 'current' });
  opts.push(
    { label: '重命名', icon: 'edit', v: 'rename' },
    { label: '复制账本', icon: 'copy', v: 'copy' },
    { label: b.archived ? '取消归档' : '归档账本', icon: 'archive', v: 'archive' },
    { label: '删除账本', icon: 'trash', danger: true, v: 'del' },
  );
  const pick = await UI.sheet(b.name, opts);
  if (!pick) return false;

  if (pick.v === 'current') { s.currentBookId = b.id; save(); UI.toast(`已切换到「${b.name}」`); return true; }

  if (pick.v === 'rename') {
    const name = await UI.prompt('重命名账本', b.name, b.name);
    if (!name) return false;
    b.name = name; save(); UI.toast('已重命名');
    return true;
  }

  if (pick.v === 'copy') {
    const copy = { ...b, id: uid(), name: `${b.name} 副本`, archived: false, created: today() };
    s.books.push(copy);
    save();
    UI.toast('已复制账本（不含原账本账单）');
    return true;
  }

  if (pick.v === 'archive') {
    b.archived = !b.archived;
    if (b.archived && s.currentBookId === b.id) {
      const other = s.books.find((x) => x.id !== b.id && !x.archived);
      if (other) s.currentBookId = other.id;
    }
    save();
    UI.toast(b.archived ? '已归档' : '已取消归档');
    return true;
  }

  if (pick.v === 'del') {
    let msg = `确认删除账本「${b.name}」？`;
    if (b.id === 'b1') msg = '这是默认账本，删除后首页可能无可用账本，确认删除？';
    else if (n > 0) msg = `「${b.name}」下还有 ${n} 笔账单，删除账本会一并删除这些账单，确认删除？`;
    const ok = await UI.confirm(msg, '删除');
    if (!ok) return false;
    s.books.splice(s.books.indexOf(b), 1);
    addTombstone('books', b.id);
    s.bills.forEach((x) => { if (x.bookId === b.id) addTombstone('bills', x.id); });
    s.bills = s.bills.filter((x) => x.bookId !== b.id);
    if (s.currentBookId === b.id) {
      const other = s.books.find((x) => !x.archived);
      if (other) s.currentBookId = other.id;
    }
    save();
    UI.toast('已删除账本');
    return true;
  }
  return false;
}

export default {
  title: '账本管理',
  header: 'sub',
  async render() {
    return `<div id="bk-body">${bodyHTML()}</div>`;
  },
  mount(root) {
    const repaint = () => {
      const box = root.querySelector('#bk-body');
      if (box) box.innerHTML = bodyHTML();
      bind();
    };
    function bind() {
      root.querySelectorAll('[data-book]').forEach((el) => {
        el.addEventListener('click', async () => { if (await bookSheet(el.dataset.book)) repaint(); });
      });
      root.querySelector('[data-act="new"]')?.addEventListener('click', async () => {
        if (await newBook()) repaint();
      });
    }
    bind();
  },
};
