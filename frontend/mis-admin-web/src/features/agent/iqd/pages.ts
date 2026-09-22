/**
 * pages.ts — 问数（iqd）域页面桶导出。
 *
 * <p><b>本文件是「iqd feature 目录布局」与「上层注册链路」之间的隔离层</b>
 * （对齐 `features/agent/pages.ts` 的既有做法）：`features/agent/pages.ts` 从本文件
 * 再导出，`keep-alive-outlet.tsx` 的 `PAGE_MAP` 只认符号名。因此页面文件改名/挪位
 * 时，只要本文件的**导出符号名不变**，注册链路零改动。
 *
 * <p>目录边界（Q2=是，v1.11 已迁移）：本目录即 `features/agent/iqd/`（原
 * `features/agent/ai/iqd/`），命名遵守 architecture.md §1.5 的 `iqd` 平台域约定。
 *
 * <p>新增建模台页面必走「四处同改」：见本目录 `iqd-modeling-page.tsx` 头部清单。
 */
export { IqdConfigPage } from './iqd-config-page';
export { IqdCatalogPage } from './iqd-catalog-page';
export { IqdScopePage } from './iqd-scope-page';
export { IqdTestChatPage } from './iqd-test-chat-page';
export { IqdTracePage } from './iqd-trace-page';
export { IqdEnhancePage } from './iqd-enhance-page';
export { IqdInstructionPage } from './iqd-instruction-page';
// v1.11 建模台主页（MR-S1，T01 页面壳）
export { IqdModelingPage } from './iqd-modeling-page';
