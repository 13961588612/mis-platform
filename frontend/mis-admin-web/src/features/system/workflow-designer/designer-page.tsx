/**
 * 流程设计器路由壳（T4.5：改为重定向页）。
 *
 * <p>编排已经 Dialog 化（`DesignerDialog`），画布只在流程定义页里以弹层方式出现。
 * 但 `/system/workflow/designer` 这条路由在三处仍然存在，不能删：
 * <ol>
 *   <li>`keep-alive-outlet.tsx` PAGE_MAP 登记</li>
 *   <li>`lib/nav/system-nav.ts` 侧栏「流程编排」</li>
 *   <li>`V123:44` 的 `sys_menu` 95007 —— 且 V128 在它上面绑了「取消发布」(95050)
 *       与「PUT 更新定义」(95056) 两个 `sys_menu_api`</li>
 * </ol>
 * 删菜单 ⇒ 那两个 API 失去权限来源 ⇒ 全部 403。**为了 UX 去动权限数据是本末倒置**，
 * 所以路由与侧栏项都保留，进来后 `replace` 回流程定义页。
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
