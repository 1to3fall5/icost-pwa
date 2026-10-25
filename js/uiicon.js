/**
 * 界面图标（UI 图标，区别于分类 / 账户图标）：统一「彩底 + 白色线性图形」。
 *
 * 与分类图标走两条线是有意的：
 *   分类 / 账户图标（caticon.js）：用户可以整体切风格（line / filled / tint / illust / emoji），
 *     形状要跟着「餐饮 / 购物 / 银行卡」这些语义走。
 *   界面图标（本模块）：设置项、弹层选项、卡片头、功能入口……它们不是数据，
 *     不该跟着分类风格变，一律蓝底白图形，只靠形状区分。
 * 左侧栏导航（账务 / 资产 / 统计…）刻意不在这里 —— 它保持中性线性灰图标。
 *
 * 底色与墨色都不写进 SVG：墨色用 currentColor（CSS 给 color:#fff），
 * 底色由 .ui-ic / .cell .ci 等容器给（CSS 一行可换）。
 *
 * 查找顺序：seticon 表（设置项那套 path）→ icons.js（通用图标）→ 原样返回（emoji 兜底）。
 */
import Icons from './icons.js';
import { setIconHTML } from './seticon.js';
import { initialOf } from './caticon.js';
import { esc } from './util.js';

const svgOf = (k) => {
  const v = Icons[k];
  if (v == null) return '';
  // 底部 Tab 那几个是函数（选中态要换填充），界面图标一律取未选中态
  return typeof v === 'function' ? v(false) : v;
};

/** 名字 → SVG 串；表里没有就原样返回（emoji / 纯文本兜底，不会渲染成空白） */
export function uiIcon(name) {
  const key = typeof name === 'string' ? name : '';
  if (!key) return '';
  const a = setIconHTML(key);
  if (a !== key) return a;            // seticon 命中（setIconHTML 未命中时原样返回入参）
  const b = svgOf(key);
  return b || key;                    // icons.js 命中，否则原样（emoji）
}

/** 是否命中内置图标（用来决定要不要加 .ui-ic 那层彩底） */
export const hasIcon = (name) => {
  const key = typeof name === 'string' ? name : '';
  return !!key && (setIconHTML(key) !== key || !!svgOf(key));
};

/** 带彩底外壳的图标：`<span class="badge-ic ui-ic">…</span>`；danger → 红底（删除类操作） */
export function uiMark(name, cls = '', danger = false) {
  const inner = uiIcon(name);
  if (!inner) return '';
  // 查不到内置图标时也要这层底：兜底 emoji / 文本（如「52」「365」）在彩底上才和 SVG 图形成套
  return `<span class="${cls} ui-ic${danger ? ' ui-ic-danger' : ''}">${inner}</span>`;
}

/**
 * 没有内置图标的东西（账本等）→ 彩底 + 白色首字，与 SVG 图形同一套墨色。
 * 中文取第一个字，英文取首字母。
 */
export function uiInitialMark(name, cls = '') {
  return `<span class="${cls} ui-ic"><span class="ui-ini">${esc(initialOf(name))}</span></span>`;
}
