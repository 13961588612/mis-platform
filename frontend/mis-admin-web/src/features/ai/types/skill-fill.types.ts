/**
 * Skill Fill / HITL 类型定义。
 * 消费 /api/v1/ai/skill/execute 端点的请求与响应契约。
 */

export interface SkillExecuteRequest {
  skillId: string;
  userInput: string;
  pageContext?: Record<string, unknown>;
  resumeToken?: string;
  selectedCandidate?: string;
}

export interface SkillExecuteResponse {
  status: 'success' | 'hitl_required' | 'manual_required' | 'error';
  fields: Record<string, unknown>;
  hitl?: HitlPayload;
  message?: string;
  resumeToken?: string;
}

export interface HitlPayload {
  field: string;
  originalValue: string;
  candidates: EntityCandidate[];
}

export interface EntityCandidate {
  id: number | string;
  name: string;
  aliases: string[];
  context: string;
}
