// 设置中心：效率 / 记账 / 通用 / 数据 / 关于
import Icons from '../icons.js';
import { S, save, reset } from '../store.js';
import { go, UI, syncIconStyle } from '../app.js';

const VERSION = 'v2.0.6';
const TYPE_LABEL = { expense: '支出', income: '收入', transfer: '转账' };
const ICON_STYLE_LABEL = { line: '线性', filled: '实心', tint: '彩底实心', illust: '彩色插画', emoji: 'Emoji 圆底' };

// 【秒开记账】settings.startPage：'record' = 启动直接进记账页，'home' = 启动进账本首页。
// app.js 启动处（load() 之后）读取方式：
//   if (!location.hash) location.hash = '#/' + (S().settings.startPage || 'home');
// 复刻版不改动 app.js，本文件只负责持久化开关状态。
//
// 【账单时间】settings.bookTime：开启后记账页显示并可编辑「时间」字段，
// record.js 读取该值决定是否默认展开时间选择器 / 是否写入 bill.time。
//
// 【深色模式】settings.theme：'dark' | 'light'，关闭时给 body 加 class="light"，
// 仅覆盖 --bg 等亮色变量（见 css/style.css 末尾 body.light）。

// 单行 cell：sw 有值时渲染 switch（整行 label 可点），否则渲染 cv + chevron
function row(o) {
  const right = o.sw
    ? `<span class="switch"><input type="checkbox" data-sw="${o.sw}"${o.on ? ' checked' : ''}><i></i></span>`
    : `<span class="cv">${o.value || ''}</span><span class="arrow">${Icons.chevR}</span>`;
  const attrs = o.sw ? '' : (o.to ? `data-go="${o.to}"` : `data-act="${o.act || ''}"`);
  const tag = o.sw ? 'label' : 'div';
  return `<${tag} class="cell" ${attrs}>
      <span class="ci" style="background:${o.bg || 'var(--card2)'}">${o.icon}</span>
      <span class="cl${o.danger ? ' st2-danger' : ''}">${o.label}${o.sub ? `<span class="cell-sub">${o.sub}</span>` : ''}</span>
      ${right}
    </${tag}>`;
}

function group(title, rows) {
  return `<div class="sec-title">${title}</div><div class="cell-group">${rows.map(row).join('')}</div>`;
}

async function clearAll() {
  const first = await UI.confirm('将清空全部账单、账本、分类与资产数据，且无法恢复。确定继续？', '继续');
  if (!first) return;
  const second = await UI.confirm('再次确认：立即删除本机所有数据？', '清空');
  if (!second) return;
  reset();
  UI.toast('已清空全部数据');
  go('home');
}

export default {
  title: '设置',
  header: 'sub',
  async render() {
    const s = S().settings;
    const dark = (s.theme || 'dark') !== 'light';
    return `
      <div class="st2-profile">
        <div class="st2-avatar">${Icons.avatar}</div>
        <div class="st2-pbox">
          <div class="st2-pname">iCost 用户</div>
          <div class="st2-psub">复刻版 ${VERSION} · 本地存储</div>
        </div>
      </div>

      ${group('效率', [
        { icon: '⚡', bg: 'rgba(255,214,10,.18)', label: '秒开记账', sub: '启动应用后直接进入记账页', sw: 'startPage', on: s.startPage === 'record' },
        { icon: '🧾', bg: 'rgba(10,132,255,.18)', label: '默认记账类型', value: TYPE_LABEL[s.defaultType || 'expense'], act: 'defaultType' },
        { icon: '📋', bg: 'rgba(48,209,88,.18)', label: '模板快捷记账', to: 'templates' },
        { icon: '🔁', bg: 'rgba(191,90,242,.18)', label: '周期记账', to: 'recurring' },
      ])}

      ${group('记账', [
        { icon: '🗂️', bg: 'rgba(255,159,10,.18)', label: '分类管理', to: 'category' },
        { icon: '🎯', bg: 'rgba(255,69,58,.18)', label: '预算管理', to: 'budget' },
        { icon: '📔', bg: 'rgba(10,132,255,.18)', label: '账本管理', to: 'books' },
        { icon: '🧾', bg: 'rgba(255,100,130,.18)', label: '报销管理', to: 'claim' },
        { icon: '💸', bg: 'rgba(48,209,88,.18)', label: '报销功能', sub: '开启后记账可标记待报销', sw: 'claimEnabled', on: !!s.claimEnabled },
        { icon: '🏦', bg: 'rgba(172,142,104,.22)', label: '贷款和分期', to: 'loan' },
        { icon: '🔄', bg: 'rgba(100,210,255,.18)', label: '账单导入导出', to: 'importexport' },
      ])}

      ${group('通用', [
        { icon: '🙈', bg: 'rgba(99,99,102,.28)', label: '隐藏金额', sub: '首页与统计中的金额以 **** 显示', sw: 'hideAmount', on: !!s.hideAmount },
        { icon: '🕐', bg: 'rgba(191,90,242,.18)', label: '账单时间', sub: '记账时记录具体到分钟的时间', sw: 'bookTime', on: !!s.bookTime },
        { icon: '🌙', bg: 'rgba(94,92,230,.28)', label: '深色模式', sw: 'dark', on: dark },
        { icon: '◌', bg: 'rgba(100,210,255,.18)', label: '分类图标', value: ICON_STYLE_LABEL[s.iconStyle || 'line'], act: 'iconStyle' },
      ])}

      ${group('数据', [
        { icon: '📤', bg: 'rgba(10,132,255,.18)', label: '导出数据', to: 'importexport' },
        { icon: '🗑️', bg: 'rgba(255,69,58,.18)', label: '清空全部数据', danger: true, act: 'clear' },
      ])}

      ${group('关于', [
        { icon: 'ℹ️', bg: 'rgba(99,99,102,.28)', label: '版本', value: VERSION, act: 'version' },
        { icon: '📄', bg: 'rgba(99,99,102,.28)', label: '用户协议', act: 'agreement' },
        { icon: '🔒', bg: 'rgba(48,209,88,.18)', label: '隐私政策', act: 'privacy' },
        { icon: '⭐', bg: 'rgba(255,214,10,.18)', label: '给 iCost 评分', act: 'rate' },
        { icon: '🧩', bg: 'rgba(255,159,10,.18)', label: '更多功能', to: 'more' },
      ])}

      <div class="st2-note">
        <div class="tt">💡 关于复刻版</div>
        数据全部保存在本机浏览器 localStorage，不上传服务器；更换浏览器或清理缓存会导致数据丢失，建议定期在「导入导出」中导出 JSON 备份。
      </div>`;
  },
  mount(root) {
    // 进入设置页时同步一次主题（浅色模式仅给 body 加 class="light"）
    document.body.classList.toggle('light', (S().settings.theme || 'dark') === 'light');
    root.querySelectorAll('[data-sw]').forEach((el) => {
      el.addEventListener('change', () => {
        const k = el.dataset.sw;
        const on = el.checked;
        const st = S().settings;
        if (k === 'startPage') { st.startPage = on ? 'record' : 'home'; UI.toast(on ? '已开启秒开记账' : '已关闭秒开记账'); }
        else if (k === 'claimEnabled') { st.claimEnabled = on; UI.toast(on ? '已开启报销功能' : '已关闭报销功能'); }
        else if (k === 'hideAmount') { st.hideAmount = on; UI.toast(on ? '金额已隐藏' : '金额已显示'); }
        else if (k === 'bookTime') { st.bookTime = on; UI.toast(on ? '已开启账单时间' : '已关闭账单时间'); }
        else if (k === 'dark') {
          st.theme = on ? 'dark' : 'light';
          document.body.classList.toggle('light', !on);
          UI.toast(on ? '已切换深色模式' : '已切换浅色模式');
        }
        save();
      });
    });
    root.querySelectorAll('[data-act]').forEach((el) => {
      el.addEventListener('click', async () => {
        const act = el.dataset.act;
        if (act === 'clear') { clearAll(); return; }
        if (act === 'defaultType') {
          const pick = await UI.sheet('默认记账类型', [
            { label: '支出', icon: '📤', value: 'expense' },
            { label: '收入', icon: '📥', value: 'income' },
            { label: '转账', icon: '🔄', value: 'transfer' },
          ]);
          if (!pick) return;
          S().settings.defaultType = pick.value;
          save();
          el.querySelector('.cv').textContent = TYPE_LABEL[pick.value];
          UI.toast(`默认记账类型：${TYPE_LABEL[pick.value]}`);
          return;
        }
        if (act === 'iconStyle') {
          const pick = await UI.sheet('分类图标', [
            { label: '线性图标', icon: '◌', value: 'line' },
            { label: '实心图标', icon: '◉', value: 'filled' },
            { label: '彩底实心（分类色底 + 单色图形）', icon: '◍', value: 'tint' },
            { label: '彩色插画（Fluent Emoji）', icon: '🎨', value: 'illust' },
            { label: 'Emoji 彩色圆底', icon: '🧾', value: 'emoji' },
          ]);
          if (!pick) return;
          S().settings.iconStyle = pick.value;
          syncIconStyle();
          save();
          el.querySelector('.cv').textContent = ICON_STYLE_LABEL[pick.value];
          UI.toast(`分类图标：${ICON_STYLE_LABEL[pick.value]}`);
          return;
        }
        if (act === 'version') { UI.toast(`iCost 复刻版 ${VERSION}`); return; }
        if (act === 'agreement' || act === 'privacy') { UI.toast('复刻演示'); return; }
        if (act === 'rate') { UI.toast('感谢支持～（复刻演示）'); }
      });
    });
  },
};
