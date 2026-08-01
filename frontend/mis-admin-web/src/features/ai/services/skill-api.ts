import api from '@/lib/api/client';
import type { SkillExecuteRequest, SkillExecuteResponse } from '../types/skill-fill.types';

/**
 * 调用 BFF Skill 执行端点。
 * 使用项目统一的 axios 实例（/api/v1 前缀 + JWT interceptor）。
 */
export async function executeSkillFill(
  request: SkillExecuteRequest,
): Promise<SkillExecuteResponse> {
  const res = await api.post('/ai/skill/execute', request);
  const payload = res.data as { code: number; message?: string; data?: unknown; traceId?: string };
  if (payload && payload.code === 0 && payload.data) {
    return payload.data as SkillExecuteResponse;
  }
  throw new Error(payload?.message || 'Skill 执行失败');
}
