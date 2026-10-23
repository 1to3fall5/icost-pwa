// 分类 / 账户图标：内置线性 SVG（24×24 描边，单色用分类色），
// 没有内置图标的自定义分类降级为「首字徽章」（分类名首字，同色）。
//
// 图标来源：Tabler Icons v3.49.0 outline（MIT License）—— https://tabler.io/icons
// 只内联本项目实际用到的 30 个图标的 path，不引入任何运行时依赖、不请求 CDN。
// 全局风格开关：'line'（默认，线性图标）| 'emoji'（旧版彩色圆底 + emoji）
// 开关不直接读 store —— 由 app.js 在每次渲染前注入，避免本模块依赖 localStorage（便于测试）。

import { esc } from './util.js';

// 一级分类名 → Tabler 图标（outline，24×24 描边）
// 一个图标可能由多段 path 组成，用 | 分隔（不能合并成一个 d：
// Tabler 大量使用相对坐标 m 指令，合并后会从前一段的终点起算，图形会错位）
const GLYPH = {
  餐饮: 'M4 11h16a1 1 0 0 1 1 1v.5c0 1.5 -2.517 5.573 -4 6.5v1a1 1 0 0 1 -1 1h-8a1 1 0 0 1 -1 -1v-1c-1.687 -1.054 -4 -5 -4 -6.5v-.5a1 1 0 0 1 1 -1|M19 7l-14 1|M19 2l-14 3',
  购物: 'M6.331 8h11.339a2 2 0 0 1 1.977 2.304l-1.255 8.152a3 3 0 0 1 -2.966 2.544h-6.852a3 3 0 0 1 -2.965 -2.544l-1.255 -8.152a2 2 0 0 1 1.977 -2.304|M9 11v-5a3 3 0 0 1 6 0v5',
  交通: 'M5 17a2 2 0 1 0 4 0a2 2 0 1 0 -4 0|M15 17a2 2 0 1 0 4 0a2 2 0 1 0 -4 0|M5 17h-2v-6l2 -5h9l4 5h1a2 2 0 0 1 2 2v4h-2m-4 0h-6m-6 -6h15m-6 0v-5',
  日用: 'M10 14a2 2 0 1 0 4 0a2 2 0 0 0 -4 0|M5.001 8h13.999a2 2 0 0 1 1.977 2.304l-1.255 7.152a3 3 0 0 1 -2.966 2.544h-9.512a3 3 0 0 1 -2.965 -2.544l-1.255 -7.152a2 2 0 0 1 1.977 -2.304|M17 10l-2 -6|M7 10l2 -6',
  水果: 'M4 11.319c0 3.102 .444 5.319 2.222 7.978c1.351 1.797 3.156 2.247 5.08 .988c.426 -.268 .97 -.268 1.397 0c1.923 1.26 3.728 .809 5.079 -.988c1.778 -2.66 2.222 -4.876 2.222 -7.977c0 -2.661 -1.99 -5.32 -4.444 -5.32c-1.267 0 -2.41 .693 -3.22 1.44a.5 .5 0 0 1 -.672 0c-.809 -.746 -1.953 -1.44 -3.22 -1.44c-2.454 0 -4.444 2.66 -4.444 5.319|M7 12c0 -1.47 .454 -2.34 1.5 -3|M12 7c0 -1.2 .867 -4 3 -4',
  娱乐: 'M12 5h3.5a5 5 0 0 1 0 10h-5.5l-4.015 4.227a2.3 2.3 0 0 1 -3.923 -2.035l1.634 -8.173a5 5 0 0 1 4.904 -4.019h3.4|M14 15l4.07 4.284a2.3 2.3 0 0 0 3.925 -2.023l-1.6 -8.232|M8 9v2|M7 10h2|M14 10h2',
  通讯: 'M6 5a2 2 0 0 1 2 -2h8a2 2 0 0 1 2 2v14a2 2 0 0 1 -2 2h-8a2 2 0 0 1 -2 -2v-14|M11 4h2|M12 17v.01',
  住房: 'M5 12l-2 0l9 -9l9 9l-2 0|M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2 -2v-7|M9 21v-6a2 2 0 0 1 2 -2h2a2 2 0 0 1 2 2v6',
  医疗: 'M4.5 12.5l8 -8a4.94 4.94 0 0 1 7 7l-8 8a4.94 4.94 0 0 1 -7 -7|M8.5 8.5l7 7',
  学习: 'M19 4v16h-12a2 2 0 0 1 -2 -2v-12a2 2 0 0 1 2 -2h12|M19 16h-12a2 2 0 0 0 -2 2|M9 8h6',
  运动: 'M7.026 9.61l-.95 -4.18a2 2 0 0 1 1.95 -2.43h8a2 2 0 0 1 2 2.43l-1 4.2|M9.026 17.001h6|M18.906 20.06a7.92 7.92 0 0 0 1 -5.33a8 8 0 1 0 -14.77 5.33a2 2 0 0 0 1.71 .94h10.36a2 2 0 0 0 1.7 -.94',
  人情: 'M3 9a1 1 0 0 1 1 -1h16a1 1 0 0 1 1 1v2a1 1 0 0 1 -1 1h-16a1 1 0 0 1 -1 -1l0 -2|M12 8l0 13|M19 12v7a2 2 0 0 1 -2 2h-10a2 2 0 0 1 -2 -2v-7|M7.5 8a2.5 2.5 0 0 1 0 -5a4.8 8 0 0 1 4.5 5a4.8 8 0 0 1 4.5 -5a2.5 2.5 0 0 1 0 5',
  宠物: 'M20 3v10a8 8 0 1 1 -16 0v-10l3.432 3.432a7.963 7.963 0 0 1 4.568 -1.432c1.769 0 3.403 .574 4.728 1.546l3.272 -3.546|M2 16h5l-4 4|M22 16h-5l4 4|M11 16a1 1 0 1 0 2 0a1 1 0 1 0 -2 0|M9 11v.01|M15 11v.01',
  美容: 'M10 6v3|M14 6v3|M5 11a2 2 0 0 1 2 -2h10a2 2 0 0 1 2 2v8a2 2 0 0 1 -2 2h-10a2 2 0 0 1 -2 -2l0 -8|M10 15a2 2 0 1 0 4 0a2 2 0 1 0 -4 0|M9 3h6v3h-6l0 -3',
  孩子: 'M6 19a2 2 0 1 0 4 0a2 2 0 1 0 -4 0|M16 19a2 2 0 1 0 4 0a2 2 0 1 0 -4 0|M2 5h2.5l1.632 4.897a6 6 0 0 0 5.693 4.103h2.675a5.5 5.5 0 0 0 0 -11h-.5v6|M6 9h14|M9 17l1 -3|M16 14l1 3',
  其他: 'M5 21v-16a2 2 0 0 1 2 -2h10a2 2 0 0 1 2 2v16l-3 -2l-2 2l-2 -2l-2 2l-2 -2l-3 2m4 -14h6m-6 4h6m-2 4h2',
  工资: 'M17 8v-3a1 1 0 0 0 -1 -1h-10a2 2 0 0 0 0 4h12a1 1 0 0 1 1 1v3m0 4v3a1 1 0 0 1 -1 1h-12a2 2 0 0 1 -2 -2v-12|M20 12v4h-4a2 2 0 0 1 0 -4h4',
  奖金: 'M8 21l8 0|M12 17l0 4|M7 4l10 0|M17 4v8a5 5 0 0 1 -10 0v-8|M3 9a2 2 0 1 0 4 0a2 2 0 1 0 -4 0|M17 9a2 2 0 1 0 4 0a2 2 0 1 0 -4 0',
  理财: 'M3 17l6 -6l4 4l8 -8|M14 7l7 0l0 7',
  红包: 'M3 8a3 3 0 0 1 3 -3h12a3 3 0 0 1 3 3v8a3 3 0 0 1 -3 3h-12a3 3 0 0 1 -3 -3l0 -8|M7 16l3 -3l3 3|M8 13c-.789 0 -2 -.672 -2 -1.5s.711 -1.5 1.5 -1.5c1.128 -.02 2.077 1.17 2.5 3c.423 -1.83 1.372 -3.02 2.5 -3c.789 0 1.5 .672 1.5 1.5s-1.211 1.5 -2 1.5h-4',
  报销: 'M5 21v-16a2 2 0 0 1 2 -2h10a2 2 0 0 1 2 2v16l-3 -2l-2 2l-2 -2l-2 2l-2 -2l-3 2|M15 14v-2a2 2 0 0 0 -2 -2h-4l2 -2m0 4l-2 -2',
  兼职: 'M3 9a2 2 0 0 1 2 -2h14a2 2 0 0 1 2 2v9a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2l0 -9|M8 7v-2a2 2 0 0 1 2 -2h4a2 2 0 0 1 2 2v2|M12 12l0 .01|M3 13a20 20 0 0 0 18 0',
  二手: 'M6.5 7.5a1 1 0 1 0 2 0a1 1 0 1 0 -2 0|M3 6v5.172a2 2 0 0 0 .586 1.414l7.71 7.71a2.41 2.41 0 0 0 3.408 0l5.592 -5.592a2.41 2.41 0 0 0 0 -3.408l-7.71 -7.71a2 2 0 0 0 -1.414 -.586h-5.172a3 3 0 0 0 -3 3',
  礼金: 'M19.5 12.572l-7.5 7.428l-7.5 -7.428a5 5 0 1 1 7.5 -6.566a5 5 0 1 1 7.5 6.572',
  退款: 'M9 14l-4 -4l4 -4|M5 10h11a4 4 0 1 1 0 8h-1',
  // 收入侧也有「其他」，用 type 前缀区分
  'income:其他': 'M9 14c0 1.657 2.686 3 6 3s6 -1.343 6 -3s-2.686 -3 -6 -3s-6 1.343 -6 3|M9 14v4c0 1.656 2.686 3 6 3s6 -1.344 6 -3v-4|M3 6c0 1.072 1.144 2.062 3 2.598s4.144 .536 6 0c1.856 -.536 3 -1.526 3 -2.598c0 -1.072 -1.144 -2.062 -3 -2.598s-4.144 -.536 -6 0c-1.856 .536 -3 1.526 -3 2.598|M3 6v10c0 .888 .772 1.45 2 2|M3 11c0 .888 .772 1.45 2 2',
};

// 特殊场景：转账 / 账户类型（同样来自 Tabler）
const SPECIAL = {
  transfer: 'M21 17l-18 0|M6 10l-3 -3l3 -3|M3 7l18 0|M18 20l3 -3l-3 -3',
  cash: 'M7 15h-3a1 1 0 0 1 -1 -1v-8a1 1 0 0 1 1 -1h12a1 1 0 0 1 1 1v3|M7 10a1 1 0 0 1 1 -1h12a1 1 0 0 1 1 1v8a1 1 0 0 1 -1 1h-12a1 1 0 0 1 -1 -1l0 -8|M12 14a2 2 0 1 0 4 0a2 2 0 0 0 -4 0',
  online: 'M13 21h-5a2 2 0 0 1 -2 -2v-14a2 2 0 0 1 2 -2h8a2 2 0 0 1 2 2v5|M11 4h2|M12 17v.01|M21 15h-2.5a1.5 1.5 0 0 0 0 3h1a1.5 1.5 0 0 1 0 3h-2.5|M19 21v1m0 -8v1',
  bank: 'M3 21l18 0|M3 10l18 0|M5 6l7 -3l7 3|M4 10l0 11|M20 10l0 11|M8 14l0 3|M12 14l0 3|M16 14l0 3',
  credit: 'M3 8a3 3 0 0 1 3 -3h12a3 3 0 0 1 3 3v8a3 3 0 0 1 -3 3h-12a3 3 0 0 1 -3 -3l0 -8|M3 10l18 0|M7 15l.01 0|M11 15l2 0',
};

// 默认二级分类名 → 一级（只拿到二级名时也能命中图标）
const SUB2TOP = {
  早餐: '餐饮', 午餐: '餐饮', 晚餐: '餐饮', 零食饮料: '餐饮', 外卖: '餐饮',
  日用品: '购物', 服饰: '购物', 数码: '购物', 家居: '购物',
  公交地铁: '交通', 打车: '交通', 加油: '交通', 停车: '交通',
  纸品洗护: '日用', 清洁: '日用', 其他日用: '日用',
  生鲜: '水果',
  电影: '娱乐', 游戏: '娱乐', KTV: '娱乐', 旅游: '娱乐',
  话费: '通讯', 网费: '通讯',
  房租: '住房', 水电燃气: '住房', 物业: '住房',
  药品: '医疗', 门诊: '医疗', 保健: '医疗', 粮食: '宠物', 用品: '宠物',
  书籍: '学习', 课程: '学习', 文具: '学习', 教育: '孩子',
  健身: '运动', 球类: '运动', 装备: '运动',
  礼物: '人情', 请客: '人情',
  护肤: '美容', 美发: '美容', 美甲: '美容',
  奶粉: '孩子', 玩具: '孩子',
  基本工资: '工资', 加班: '工资', 补贴: '工资',
  年终奖: '奖金', 绩效: '奖金',
  利息: '理财', 基金: '理财', 股票: '理财',
  闲鱼: '二手', 转转: '二手',
};

let style = 'line';
export const setIconStyle = (s) => { style = s === 'emoji' ? 'emoji' : 'line'; };
export const getIconStyle = () => style;

// 颜色只接受 #rgb / #rrggbb / #rrggbbaa，其它一律回退 —— 它要写进 style / stroke 属性
const safeColor = (c) => (/^#[0-9a-fA-F]{3,8}$/.test(String(c || '')) ? String(c) : '#98989f');

// 取首字：中文取第一个字，英文/数字取首字母（大写）
export function initialOf(name) {
  const s = String(name || '').trim();
  if (!s) return '?';
  return [...s][0].toUpperCase();
}

// 名字 → 图标路径（parent 优先，因为二级名可能与一级重名）
export function glyphOf(name, parent, type) {
  if (name && type && GLYPH[`${type}:${name}`]) return GLYPH[`${type}:${name}`];
  if (parent && GLYPH[parent]) return GLYPH[parent];
  if (name && GLYPH[name]) return GLYPH[name];
  const top = SUB2TOP[String(name || '')];
  if (top && GLYPH[top]) return GLYPH[top];
  return '';
}

// 描边 / 填充两种用法共用同一套 viewBox，尺寸与线宽都交给 CSS（按容器分档）
// 多段 path 必须拆成多个 <path>：Tabler 用相对坐标 m，合并成一个 d 会错位
const pathsHTML = (d) => String(d || '').split('|').filter(Boolean).map((p) => `<path d="${p}"/>`).join('');
const svgWrap = (color, d, fill) => `<svg viewBox="0 0 24 24" fill="none"${fill ? ` fill="${color}"` : ` stroke="${color}"`} stroke-linecap="round" stroke-linejoin="round">${pathsHTML(d)}</svg>`;

/**
 * 分类标记 HTML。
 * @param {object} o {name, parent, icon, color, type, kind, cls, style}
 *   kind: 'transfer' | 'cash' | 'online' | 'bank' | 'credit' 走内置特殊图标
 *   cls : 附加到容器的 class（bill-ic / badge-ic / ic …）
 * 返回的是一个 span，直接替换原来的彩色圆底容器。
 */
export function markInnerHTML(o = {}) {
  const c = safeColor(o.color);
  const st = o.style || style;
  const name = String(o.name || '');
  if (st === 'emoji') return esc(o.icon || (o.kind === 'transfer' ? '🔄' : '🧾'));
  const d = (o.kind && SPECIAL[o.kind]) ? SPECIAL[o.kind] : glyphOf(name, o.parent, o.type);
  if (d) return svgWrap(c, d);
  const ch = esc(initialOf(name || o.parent));
  const txt = `<text x="12" y="12.5" text-anchor="middle" dominant-baseline="central" font-size="12" font-weight="500" fill="${c}" stroke="none">${ch}</text>`;
  return svgWrap(c, txt, true);
}

export function catMarkHTML(o = {}) {
  const cls = String(o.cls || '');
  const c = safeColor(o.color);
  if ((o.style || style) === 'emoji') {
    return `<span class="ic-mark ic-emoji ${cls}" style="--c:${c}">${markInnerHTML(o)}</span>`;
  }
  const mono = !((o.kind && SPECIAL[o.kind]) || glyphOf(String(o.name || ''), o.parent, o.type));
  return `<span class="ic-mark ic-line${mono ? ' ic-mono' : ''} ${cls}" style="--c:${c}">${markInnerHTML(o)}</span>`;
}

/** 账户图标：按账户 type 给内置图标，自定义账户降级首字 */
export function accMarkHTML(o = {}) {
  const kind = SPECIAL[o.type] ? o.type : '';
  return catMarkHTML({ ...o, kind, name: o.name || '', parent: '' });
}
