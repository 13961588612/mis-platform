/**
 * 流程设计器路由壳（T4.1 瘦身 / T4.5 改为重定向）。
 *
 * <p>全部逻辑与 JSX 已搬到 `designer-body.tsx`，本文件只负责把它挂出来。
 */
import { DesignerBody } from './designer-body';

export function WorkflowDesignerPage() {
  return <DesignerBody />;
}

export default WorkflowDesignerPage;
