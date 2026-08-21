/**
 * skill-dispatch.ts — 技能分发服务（T09，从 agent/frontend utils/agentRole.ts 迁移 + 扩展）。
 *
 * <p>02 文档 §2.1（T09）：`agentRole.ts`（mis-rag / mis-summary / mis-extract /
 * crm-assistant 技能分发）迁入 `src/services/skill-dispatch.ts`。实际源文件只有
 * Coordinator/Worker 角色过滤（mis-copilot 为 Coordinator，四个 Worker 不面向用户），
 * 技能分发元数据由本服务集中声明，供问数页（data-query）展示能力与调度提示消费。
 *
 * <p>Worker 只经 Coordinator 调度，**绝不出现在用户选择器**（fail-closed）：
 * 未知 / 缺失 role 一律按非 Coordinator 处理。
 */

// ============================================================================
// 角色（对齐 agent/frontend utils/agentRole.ts）
// ============================================================================

/** 用户可选对话入口的角色值。 */
export const COORDINATOR_ROLE = 'coordinator' as const;

/** 委派执行者角色值（永不面向用户选择）。 */
export const WORKER_ROLE = 'worker' as const;

/** 是否为 Coordinator（缺失/未知一律 false，fail-closed）。 */
export function isCoordinator(role: string | undefined | null): boolean {
  return role === COORDINATOR_ROLE;
}

/** 归一化后端角色值；未知/缺失降级为 worker（fail-closed）。 */
export function normalizeAgentRole(role: string | undefined | null): 'coordinator' | 'worker' {
  return role === COORDINATOR_ROLE ? COORDINATOR_ROLE : WORKER_ROLE;
}

// ============================================================================
// 技能分发元数据（问数 / 知识库问答的 Worker 技能）
// ============================================================================

/** 问数相关 Worker 技能声明（LLM/调度层技能码）。 */
export interface DispatchSkillMeta {
  /** 技能码（ai:skill:{skillId}:run 权限码的 {skillId} 段）。 */
  skillId: string;
  /** 展示名。 */
  name: string;
  /** 一句话能力描述。 */
  description: string;
  /** 触发意图关键词（问数页快捷提示用）。 */
  intents: string[];
}

/** 问数/知识库问答相关 Worker 技能清单（与 Python 侧技能注册一致）。 */
export const DISPATCH_SKILLS: DispatchSkillMeta[] = [
  {
    skillId: 'mis-rag',
    name: '知识库检索问答',
    description: '基于知识库分片检索的问答，输出带引用来源。',
    intents: ['检索', '知识库', '资料', '文档', '规章制度'],
  },
  {
    skillId: 'mis-summary',
    name: '数据汇总',
    description: '跨数据源汇总统计，输出结构化表格。',
    intents: ['汇总', '统计', '合计', '对比', '报表'],
  },
  {
    skillId: 'mis-extract',
    name: '信息抽取',
    description: '从文本/表格中抽取结构化字段，输出明细表。',
    intents: ['抽取', '提取', '整理字段', '结构化'],
  },
  {
    skillId: 'crm-assistant',
    name: 'CRM 助手',
    description: '客户/商机域问答与查询，输出业务数据表。',
    intents: ['客户', '商机', 'CRM', '线索'],
  },
];

/** 按技能码取声明；未知返回 undefined。 */
export function getDispatchSkill(skillId: string): DispatchSkillMeta | undefined {
  return DISPATCH_SKILLS.find((s) => s.skillId === skillId);
}

/** 问数页快捷示例（预置提示语）。 */
export const DATA_QUERY_SUGGESTIONS: string[] = [
  '帮我汇总本月各门店销售额',
  '从这段表格里抽取合同关键字段',
  '查询知识库中关于差旅报销的规定',
  '列出最近一周的客户跟进记录',
];
