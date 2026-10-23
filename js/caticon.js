// 分类 / 账户图标：内置线性 SVG（24×24 描边，单色用分类色），
// 没有内置图标的自定义分类降级为「首字徽章」（分类名首字，同色）。
// 全局风格开关：'line'（默认，线性图标）| 'emoji'（旧版彩色圆底 + emoji）
// 开关不直接读 store —— 由 app.js 在每次渲染前注入，避免本模块依赖 localStorage（便于测试）。

import { esc } from './util.js';

// 一级分类名 → 图标路径（24×24，stroke 描边）
const GLYPH = {
  // 支出
  餐饮: 'M6 3v6a2 2 0 0 0 4 0V3M8 9v12M16.5 3c-2 2.5-2.5 5-2.5 7.5s.5 3.5 2.5 3.5 2.5-1 2.5-3.5S18.5 5.5 16.5 3zM16.5 14v7',
  购物: 'M5.5 8h13l1.2 12H4.3L5.5 8zM9 8V6a3 3 0 0 1 6 0v2',
  交通: 'M6 3h12a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM4 10h16M8 20l1.5 2M16 20l-1.5 2M9.5 7h.01M14.5 7h.01',
  日用: 'M10 3h4v2.5l2 2V20a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V7.5l2-2V3zM8 12h8',
  水果: 'M12 8.5c-3.3 0-6 2.2-6 5.5S8.7 19.5 12 19.5s6-2.2 6-5.5S15.3 8.5 12 8.5zM12 8.5c-.5-2.2.5-4.2 2.6-4.8',
  娱乐: 'M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zM8.5 8.5h.01M15.5 8.5h.01M12 12h.01M8.5 15.5h.01M15.5 15.5h.01',
  通讯: 'M8 2h8a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1zM11 19h2',
  住房: 'M3 11l9-7 9 7M5 9.5V20h14V9.5M10 20v-6h4v6',
  医疗: 'M4 8h16v10a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V8zM9 8V6a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M12 11v6M9 14h6',
  学习: 'M12 6.5C10 4.5 6 4.5 4 5.5v12c2-1 6-1 8 1 2-2 6-2 8-1v-12c-2-1-6-1-8 1zM12 6.5v12',
  运动: 'M4 9v6M20 9v6M7 7v10M17 7v10M7 12h10',
  人情: 'M4 10h16v9a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-9zM3 10h18M12 10v10M12 10L9.5 6.5M12 10l2.5-3.5',
  宠物: 'M12 4.5c-4 0-7 2.5-7 6 0 3 2.5 5.5 5.5 5.5h3c3 0 5.5-2.5 5.5-5.5 0-3.5-3-6-7-6zM7.6 7.5L6.2 3.2l4 2M16.4 7.5l1.4-4.3-4 2M9.8 11h.01M14.2 11h.01',
  美容: 'M9.5 10h5v8.5a2.5 2.5 0 0 1-5 0V10zM14.5 10l3.5-5.5h-3.5M9.5 10V7.5a1.5 1.5 0 0 1 1.5-1.5h2a1.5 1.5 0 0 1 1.5 1.5V10',
  孩子: 'M10 3h4v2l1.5 2.5V10h-7V7.5L10 5V3zM8.5 10h7v8a2.5 2.5 0 0 1-2.5 2.5h-2A2.5 2.5 0 0 1 8.5 18v-8zM8.5 13.5h3',
  其他: 'M6 3h12v18l-3-2-3 2-3-2-3 2V3zM9 8h6M9 12h6',
  // 收入
  工资: 'M3.5 6h17v12h-17zM3.5 10h17M6.5 14h4',
  奖金: 'M8 4h8v5a4 4 0 0 1-8 0V4zM8 6H5.5v1.5A3.5 3.5 0 0 0 9 11M16 6h2.5v1.5A3.5 3.5 0 0 1 15 11M12 13v4M9.5 20h5',
  理财: 'M4 17l5.5-5.5 3.5 3.5L20 8M15 8h5v5',
  红包: 'M4.5 8h15v11a1 1 0 0 1-1 1h-13a1 1 0 0 1-1-1V8zM3.5 8l2-3.5h13l2 3.5M9.5 15h5',
  报销: 'M4 9a8 8 0 0 1 13.5-3.5M18 4v3h-3M20 15a8 8 0 0 1-13.5 3.5M6 20v-3h3',
  兼职: 'M3 8h18v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8zM8.5 8V6a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v2M3 13h18',
  二手: 'M12 3.5l8.5 8.5L12 20.5 3.5 12 12 3.5zM12 9h.01',
  礼金: 'M12 20s-7-4.3-7-9a4 4 0 0 1 7-2.6A4 4 0 0 1 19 11c0 4.7-7 9-7 9z',
  退款: 'M9 14L4 9l5-5M4 9h10a6 6 0 0 1 0 12h-4',
  // 收入侧也有「其他」，用 type 前缀区分
  'income:其他': 'M12 4a8 8 0 1 1 0 16 8 8 0 0 1 0-16zM9 10h6M9 14h6',
};

// 特殊场景：转账 / 账户类型
const SPECIAL = {
  transfer: 'M4 8h13M14 5l3 3-3 3M20 16H7M10 13l-3 3 3 3',
  cash: 'M3.5 7h17v10h-17zM10 12a2 2 0 0 1 4 0 2 2 0 0 1-4 0',
  online: 'M8 2h8a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1zM11 19h2',
  bank: 'M3.5 6h17v12h-17zM3.5 10h17M6.5 14h4',
  credit: 'M3.5 6h17v12h-17zM3.5 10h17M7 14.5h5',
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

// 描边 / 填充两种用法共用同一套 viewBox，尺寸交给 CSS（容器百分比）
const svgWrap = (color, inner, fill) => `<svg viewBox="0 0 24 24" fill="none"${fill ? ` fill="${color}"` : ` stroke="${color}"`} stroke-linecap="round" stroke-linejoin="round" stroke-width="1.7">${inner}</svg>`;

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
  if (d) return svgWrap(c, `<path d="${d}"/>`);
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
