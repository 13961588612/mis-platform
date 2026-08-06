/**
 * 技能权限页（T01 占位空态）。
 *
 * <p>真实内容（技能执行授权、角色分配）在 T03 填充。
 * 权限码 `ai:skill:{id}:run` 由 V21 播种（挂在 system App 下，fail-closed）。
 * 路径与 V19 菜单 `92038` 一一对应。
 */
import { AgentPageShell } from './components/agent-page-shell';

/** 技能权限（T01 占位）。 */
export function AgentSkillsPermissionsPage() {
  return <AgentPageShell title="技能权限" description="技能执行码的角色授权。" />;
}
