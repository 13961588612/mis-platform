/**
 * 企微机器人页（T01 占位空态）。
 *
 * <p>真实内容（多实例并存、独立启停、WS 接入）在 T04 填充。
 * 主理人决策 ②：本期只做多实例 + 独立启停，不改 WS→HTTP 接入方式。
 * 路径与 V19 菜单 `92040` 一一对应。
 */
import { AgentPageShell } from './components/agent-page-shell';

/** 企微机器人（T01 占位）。 */
export function AgentWecomPage() {
  return <AgentPageShell title="企微机器人" description="企业微信渠道的多实例接入与启停。" />;
}
