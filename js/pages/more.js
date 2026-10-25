// 更多功能：功能总览入口 + 关于复刻版
import Icons from '../icons.js';
import { uiMark } from '../uiicon.js';

// [图标名, 标题, 副标题, 路由] —— 底色与墨色由 .ui-ic 统一给，不再逐个配半透明色
const FEATURES = [
  ['category', '分类管理', '自定义一 / 二级分类', 'category'],
  ['target', '预算管理', '周 / 月 / 年总预算与分类预算', 'budget'],
  ['moneybag', '固定支出', '每月必付清单与可支配金额', 'fixed'],
  ['books', '账本管理', '多账本、归档与复制', 'books'],
  ['template', '模板记账', '常用账单一键记账', 'templates'],
  ['refresh', '周期记账', '按天 / 周 / 月自动生成', 'recurring'],
  ['receipt-refund', '报销管理', '待报销标记与核销', 'claim'],
  ['building-bank', '贷款和分期', '房贷车贷与分期计划', 'loan'],
  ['file-export', '导入导出', 'CSV / JSON 备份与恢复', 'importexport'],
  ['calendar', '收支日历', '按日查看收支分布', 'calendar'],
  ['search', '搜索', '按关键词 / 分类筛选账单', 'search'],
];

export default {
  title: '更多功能',
  header: 'sub',
  async render() {
    return `
      <div class="sec-title">功能总览</div>
      <div class="cell-group">
        ${FEATURES.map(([icon, name, sub, to]) => `
          <div class="cell" data-go="${to}">
            ${uiMark(icon, 'ci')}
            <span class="cl">${name}<span class="cell-sub">${sub}</span></span>
            <span class="arrow">${Icons.chevR}</span>
          </div>`).join('')}
      </div>

      <div class="st2-note mo-note">
        <div class="tt">${uiMark('info-circle', 'badge-ic')}关于复刻版</div>
        本项目为 iCost 功能的复刻演示，用于交互与前端实现参考，非官方应用。
        <br>所有数据仅保存在本机浏览器（localStorage），不会上传服务器；清理浏览器数据或更换设备会导致账单丢失，
        请定期使用「导入导出 → 导出 JSON 备份」保存。
      </div>`;
  },
};
