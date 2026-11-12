/**
 * 流程设计器路由壳（T4.5：改为重定向页）。
 *
 * <p>编排已经 Dialog 化（`DesignerDialog`），画布只在流程定义页里以弹层方式出现。
 * `/system/workflow/designer` 这条路由**仍保留、勿删**（V132 已把旧菜单 95007 删除，
 * 其下「取消发布」(95050) 与「PUT 更新定义」(95056) 两个 `sys_menu_api` 改挂到菜单 95006，
 * permission 现为 `workflow:definition:edit`）。路由与 `keep-alive-outlet.tsx` 的 PAGE_MAP 条目
 * 只因编排 Dialog 的历史兼容而保留，**不要**删除路由或 PAGE_MAP 条目，否则 95006 相关接口回退 403。
 * 进来后 `replace` 回流程定义页。
 *
 * ⚠️ 必须用 `replace: true`：用 `push` 会多出一条历史（进一条、退一条），
 * 用户按后退会觉得「退不出去」。
 */
import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

export function WorkflowDesignerPage() {
  const navigate = useNavigate();

  useEffect(() => {
    navigate('/system/workflow/definitions', { replace: true });
  }, [navigate]);

  return null;
}

export default WorkflowDesignerPage;
