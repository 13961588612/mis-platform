/**
 * bff-actions — A2UI 写操作 → BFF REST 调用层（T06'）。
 *
 * <p>02 文档 §3.2：所有写操作最终转化为对 BFF REST API 的调用，由
 * `ApiPermissionInterceptor` 校验（deny-unmapped=true fail-closed）。
 * 本模块只做「actionApiMap → axios 调用 + 403 结构化错误」，不做权限判定。
 *
 * <p>错误码口径（03-permission-design.md §3.3）：
 * 40301 FORBIDDEN（missingPermissions）/ 40303 ACL_UNAVAILABLE / 40304 RENDER_FORBIDDEN /
 * 40305 EVENT_FORBIDDEN / 4004 POLICY_UNMAPPED。
 */

import api from '@/lib/api/client';
import type { BffActionError, BffActionResult, A2uiActionApiBinding } from '@/lib/a2ui/types';
import { A2UI_ERROR_CODES } from '@/lib/a2ui/types';

/** 统一响应信封（BFF）。 */
interface ApiEnvelope<T = unknown> {
  code: number;
  message: string;
  data: T;
  traceId?: string;
}

const PERMISSION_CODES = new Set<number>([
  A2UI_ERROR_CODES.FORBIDDEN,
  A2UI_ERROR_CODES.ACL_UNAVAILABLE,
  A2UI_ERROR_CODES.RENDER_FORBIDDEN,
  A2UI_ERROR_CODES.EVENT_FORBIDDEN,
  A2UI_ERROR_CODES.POLICY_UNMAPPED,
]);

function parseErrorCode(payload: unknown): number | null {
  if (payload == null || typeof payload !== 'object') return null;
  const code = (payload as { code?: unknown }).code;
  return typeof code === 'number' ? code : null;
}

function parseMissingPermissions(payload: unknown): string[] {
  if (payload == null || typeof payload !== 'object') return [];
  const list = (payload as { missingPermissions?: unknown }).missingPermissions;
  if (!Array.isArray(list)) return [];
  return list.filter((item): item is string => typeof item === 'string');
}

/** 从任意异常中提取 BFF 结构化错误。 */
export function toBffActionError(error: unknown): BffActionError {
  const shaped = error as {
    response?: { status?: number; data?: unknown };
    message?: unknown;
  };
  const status = shaped.response?.status;
  const body = shaped.response?.data as Record<string, unknown> | undefined;
  const code = status === 403 ? (parseErrorCode(body) ?? A2UI_ERROR_CODES.FORBIDDEN) : parseErrorCode(body) ?? -1;
  const message =
    (typeof body?.message === 'string' ? body.message : undefined) ??
    (typeof shaped.message === 'string' ? shaped.message : '请求失败');

  return {
    code,
    message,
    missingPermissions: parseMissingPermissions(body),
    permissionDenied: status === 403 || PERMISSION_CODES.has(code),
  };
}

/**
 * 调用一个 BFF 写操作（actionApiMap 绑定）。
 *
 * @param binding - registry 中的 actionApiMap 条目（method/path/permissionCode）
 * @param payload - 请求体
 */
export async function callBffAction<T = unknown>(
  binding: A2uiActionApiBinding,
  payload: Record<string, unknown>,
): Promise<BffActionResult<T>> {
  try {
    const res = await api.request<ApiEnvelope<T>>({
      method: binding.method,
      url: binding.path,
      data: payload,
    });
    const envelope = res.data;
    if (envelope.code !== 0) {
      const err: BffActionError = {
        code: envelope.code,
        message: envelope.message || '操作失败',
        missingPermissions: parseMissingPermissions(envelope),
        permissionDenied: PERMISSION_CODES.has(envelope.code),
      };
      return { ok: false, error: err };
    }
    return { ok: true, data: envelope.data };
  } catch (error) {
    return { ok: false, error: toBffActionError(error) };
  }
}

export default callBffAction;
