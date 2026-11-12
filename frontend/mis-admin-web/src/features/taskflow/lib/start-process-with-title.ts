/**
 * 表单包装发起：一律先弹窗确认标题/过期/紧急 → 再调 startProcess。
 */
import { startProcess, type StartProcessRequest } from '@/lib/api/workflow';
import { resolveProcessTitle } from './resolve-process-title';

export type StartProcessWithTitleInput = Omit<StartProcessRequest, 'title'> & {
  tenantId: string;
  /** 表单定义 config JSON。 */
  formConfig?: string | null;
  /** 已解析的 formData 对象（与 formData JSON 二选一即可；优先对象）。 */
  formDataObject?: Record<string, unknown> | null;
  /**
   * 弹窗确认后传入的标题。未确认时不要传；确认后必填（可改自动值）。
   */
  explicitTitle?: string | null;
  /** 为 true 表示已走 {@link ProcessStartDialog} 确认。 */
  confirmed?: boolean;
  priority?: number | null;
  dueDate?: string | null;
};

export type StartProcessWithTitleResult =
  | { ok: true; instanceId: string }
  | { ok: false; needConfirm: true; suggestedTitle: string }
  | { ok: false; needConfirm: false; error: string };

/**
 * 未确认时返回 `needConfirm`（带自动标题建议）；确认后带 `confirmed` + `explicitTitle` 再调。
 */
export async function startProcessWithTitle(
  input: StartProcessWithTitleInput,
): Promise<StartProcessWithTitleResult> {
  const formDataJson =
    input.formDataObject != null
      ? JSON.stringify(input.formDataObject)
      : input.formData ?? null;

  const suggestedTitle =
    resolveProcessTitle({
      formConfig: input.formConfig,
      formData: input.formDataObject ?? input.formData,
      explicitTitle: input.explicitTitle,
    }) ?? '';

  // 所有表单发起都必须先弹窗确认标题 / 过期时间 / 紧急程度
  if (!input.confirmed) {
    return { ok: false, needConfirm: true, suggestedTitle };
  }

  const title = (input.explicitTitle ?? suggestedTitle).trim();
  if (!title) {
    return { ok: false, needConfirm: true, suggestedTitle: '' };
  }

  try {
    const instanceId = await startProcess(input.tenantId, {
      definitionCode: input.definitionCode,
      businessType: input.businessType,
      businessId: input.businessId,
      startedFormCode: input.startedFormCode,
      formData: formDataJson,
      initiatorId: input.initiatorId,
      initiatorName: input.initiatorName,
      appCode: input.appCode,
      initiatorOrgName: input.initiatorOrgName,
      title,
      priority: input.priority,
      dueDate: input.dueDate,
    });
    return { ok: true, instanceId };
  } catch (e) {
    return {
      ok: false,
      needConfirm: false,
      error: e instanceof Error ? e.message : '发起流程失败',
    };
  }
}
