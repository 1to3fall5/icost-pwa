// 无依赖的纯工具函数（不碰 localStorage / DOM，任何模块都能安全引入）
//
// esc：HTML 转义。所有「用户输入 → innerHTML」的必经关卡。
// 覆盖 & < > " ' 五种：& 必须最先处理，否则会把后面生成的实体再转义一次；
// " 和 ' 是属性注入的关键 —— 只转义尖括号挡不住 `value="x" onmouseover=...` 这类突破。
// store.js 的 scrub 只删 <> 且只作用于落盘字段，内存态（如搜索关键词）根本不过它，
// 所以输出层必须自己 esc，不能指望存储层兜底。
const ENT = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ENT[c]);
