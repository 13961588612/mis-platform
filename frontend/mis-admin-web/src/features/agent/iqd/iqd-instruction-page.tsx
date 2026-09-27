/**
 * iqd-instruction-page.tsx — 兼容旧路由 `/iqd/instruction`。
 *
 * <p>指令能力已并入「知识与规则」页（`/iqd/enhance`）的「指令」Tab；
 * 访问本路径时重定向，避免书签 / 外链失效。
 */

import { Navigate } from 'react-router-dom';

export const IQD_INSTRUCTION_PAGE_PATH = '/iqd/instruction';
export const IQD_INSTRUCTION_TAB_HREF = '/iqd/enhance?tab=instruction';

export function IqdInstructionPage() {
  return <Navigate to={IQD_INSTRUCTION_TAB_HREF} replace />;
}

export default IqdInstructionPage;
