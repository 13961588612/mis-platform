/**
 * Agent 详情子路由占位（T01）。
 *
 * <p>承载 `/agent/agents/:id/skills`、`/agent/agents/:id/config`、
 * `/agent/agents/:id/coordination` 三条 V19 中 `type=2 + visible=0` 的详情子路由。
 * 它们不进侧栏（agent-nav.ts 刻意不含），但 permission 仍生效，
 * 通过 keep-alive-outlet 的 `DYNAMIC_PAGES` 提供独立的 Tab 标题。
 *
 * <p>标题按路径后缀切换；真实内容在 T02（skills/config/coordination）填充。
 */
import { useLocation } from 'react-router-dom';
import { AgentPageShell } from './components/agent-page-shell';

/** 后缀 → 标题映射。 */
const DETAIL_TITLES: Record<string, string> = {
  skills: '技能绑定',
  config: '配置文件',
  coordination: '调度配置',
};

/** Agent 详情（T01 占位）。 */
export function AgentAgentDetailPage() {
  const { pathname } = useLocation();
  const suffix = pathname.split('/agent/agents/')[1]?.split('/')[1] ?? '';
  const title = DETAIL_TITLES[suffix] ?? 'Agent 详情';
  return <AgentPageShell title={title} description="Agent 实例的明细配置（T02 上线）。" />;
}
