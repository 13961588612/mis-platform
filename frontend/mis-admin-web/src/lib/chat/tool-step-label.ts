/**
 * 工具步骤展示文案（Copilot 折叠条）。
 */

/** 常见工具名 → 中文。 */
const TOOL_LABELS: Record<string, string> = {
  skill: '加载技能',
  agent__invoke: '委派执行',
  render_a2ui: '渲染界面',
  'mcp__mcp-sm-api-suite__callCommonInfoApi': '查询主数据',
  'mcp__mcp-sm-api-suite__callShopSaleApi': '查询门店销售',
  'mcp__mcp-sm-api-suite__callShopCategorySaleApi': '查询品类销售',
  'mcp__mcp-api-suite__callApi': '调用业务 API',
};

/** 从 args 抽一句短摘要（skill 名 / apiName）。 */
export function summarizeToolArgs(args?: Record<string, unknown>): string | undefined {
  if (!args) return undefined;
  const name = args.name ?? args.skill_id ?? args.skillId;
  if (typeof name === 'string' && name.trim()) return name.trim();
  const apiName = args.apiName ?? args.api_name;
  if (typeof apiName === 'string' && apiName.trim()) return apiName.trim();
  return undefined;
}

/** 工具名展示。 */
export function formatToolLabel(toolName: string): string {
  const id = toolName.trim();
  if (!id) return '工具';
  if (TOOL_LABELS[id]) return TOOL_LABELS[id];
  // mcp__server__tool → 末段
  if (id.startsWith('mcp__')) {
    const parts = id.split('__');
    const last = parts[parts.length - 1];
    return last || id;
  }
  return id;
}

/** 折叠条单行文案。 */
export function formatToolStepLine(toolName: string, summary?: string): string {
  const label = formatToolLabel(toolName);
  if (summary && summary !== toolName) return `${label} · ${summary}`;
  return label;
}
