/**
 * 工作区主 Tab 身份解析。
 *
 * <p>默认 `id === path`；带二级详情 Tab 的明细页需要把一族 URL 收成同一个主 Tab，
 * 否则切「概览 / 可用技能 / 人设与配置」会在顶栏连开多个同名 Tab。
 *
 * <p>当前仅 Agent 详情：`/agent/agents/:id` 与
 * `/agent/agents/:id/{skills|config|coordination}` 共用 id=`/agent/agents/:id`。
 * 路由与权限仍按完整 path 走；本函数只影响顶栏 Tab 去重。
 */

const AGENT_DETAIL_PREFIX = '/agent/agents/';
const AGENT_DETAIL_SUFFIXES = new Set(['skills', 'config', 'coordination']);

/** 将 pathname 归一为工作区 Tab id（多数情况等于 path）。 */
export function resolveWorkspaceTabId(path: string): string {
  if (!path.startsWith(AGENT_DETAIL_PREFIX)) return path;
  const rest = path.slice(AGENT_DETAIL_PREFIX.length);
  if (!rest) return path;
  const [rawId, rawSuffix = '', ...extra] = rest.split('/');
  if (!rawId || extra.length > 0) return path;
  if (rawSuffix !== '' && !AGENT_DETAIL_SUFFIXES.has(rawSuffix)) return path;
  return `${AGENT_DETAIL_PREFIX}${rawId}`;
}

/** 两个 path 是否归属同一工作区 Tab（用于打开时清掉同族旧 Tab）。 */
export function isSameWorkspaceTab(a: string, b: string): boolean {
  return resolveWorkspaceTabId(a) === resolveWorkspaceTabId(b);
}
