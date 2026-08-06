/**
 * 技能池页（T01 占位空态）。
 *
 * <p>真实内容（技能列表、启停、重建索引）在 T03 填充。
 * 路径与 V19 菜单 `92037` 一一对应。
 */
import { AgentPageShell } from './components/agent-page-shell';

/** 技能池（T01 占位）。 */
export function AgentSkillsPage() {
  return <AgentPageShell title="技能池" description="可用技能的注册与生命周期管理。" />;
}
