// 更多功能：功能总览入口 + 关于复刻版
import Icons from '../icons.js';

const FEATURES = [
  ['🗂️', 'rgba(255,159,10,.18)', '分类管理', '自定义一 / 二级分类', 'category'],
  ['🎯', 'rgba(255,69,58,.18)', '预算管理', '周 / 月 / 年总预算与分类预算', 'budget'],
  ['📔', 'rgba(10,132,255,.18)', '账本管理', '多账本、归档与复制', 'books'],
  ['📋', 'rgba(48,209,88,.18)', '模板记账', '常用账单一键记账', 'templates'],
  ['🔁', 'rgba(191,90,242,.18)', '周期记账', '按天 / 周 / 月自动生成', 'recurring'],
  ['🧾', 'rgba(255,100,130,.18)', '报销管理', '待报销标记与核销', 'claim'],
  ['🏦', 'rgba(172,142,104,.22)', '贷款和分期', '房贷车贷与分期计划', 'loan'],
  ['🔄', 'rgba(100,210,255,.18)', '导入导出', 'CSV / JSON 备份与恢复', 'importexport'],
  ['📅', 'rgba(255,214,10,.18)', '收支日历', '按日查看收支分布', 'calendar'],
  ['🔍', 'rgba(99,99,102,.28)', '搜索', '按关键词 / 分类筛选账单', 'search'],
];

export default {
  title: '更多功能',
  header: 'sub',
  async render() {
    return `
      <div class="sec-title">功能总览</div>
      <div class="cell-group">
        ${FEATURES.map(([icon, bg, name, sub, to]) => `
          <div class="cell" data-go="${to}">
            <span class="ci" style="background:${bg}">${icon}</span>
            <span class="cl">${name}<span class="cell-sub">${sub}</span></span>
            <span class="arrow">${Icons.chevR}</span>
          </div>`).join('')}
      </div>

      <div class="st2-note mo-note">
        <div class="tt">🧩 关于复刻版</div>
        本项目为 iCost 功能的复刻演示，用于交互与前端实现参考，非官方应用。
        <br>所有数据仅保存在本机浏览器（localStorage），不会上传服务器；清理浏览器数据或更换设备会导致账单丢失，
        请定期使用「导入导出 → 导出 JSON 备份」保存。
      </div>`;
  },
};
