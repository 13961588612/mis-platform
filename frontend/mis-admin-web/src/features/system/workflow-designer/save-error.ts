/**
 * 流程定义保存的错误翻译 + 编码查重（方案 §4.4 字段 2）。
 *
 * <p>⚠️ 后端**不翻译**唯一索引冲突：`WfDefinitionService.create` 直接落到
 * `uk_wf_def_tenant_code_ver (tenant_id, code, version) WHERE deleted=0`，
 * `DataIntegrityViolationException` 被 `GlobalExceptionHandler.handleException(Exception)`
 * 兜成 **500 INTERNAL_ERROR**（消息是「系统内部错误」这类通用文案）。
 * 管理员看到「系统内部错误」根本不知道是编码重复了 ⇒ 只能在前端翻。
 *
 * <p>两条路一起走：
 * <ol>
 *   <li>**保存前**查重（`findCodeConflict`）：列表端点无 `keyword` 参数，只能翻页比对。
 *       翻前 {@link MAX_SCAN_PAGES} 页 × 100 条，命中即给出精确的「编码 "XXX" 已存在」。</li>
 *   <li>**保存后**翻译（`friendlySaveError`）：翻页没覆盖到（>500 条）时，
 *       把 500 兜底错误翻译成「疑似编码冲突」的可读文案，并带上原始错误信息。</li>
 * </ol>
 */
import { fetchDefinitions } from '@/lib/api/workflow';

/** 流程编码：大写字母开头，仅大写字母/数字/下划线，总长 2-64。 */
export const DEFINITION_CODE_PATTERN = /^[A-Z][A-Z0-9_]{1,63}$/;

const PAGE_SIZE = 100;
const MAX_SCAN_PAGES = 5;

/** 编码格式校验，返回错误文案；合法返回 `null`。 */
export function validateDefinitionCode(code: string): string | null {
  const trimmed = code.trim();
  if (!trimmed) return '请填写流程编码';
  if (!DEFINITION_CODE_PATTERN.test(trimmed)) {
    return '编码须以大写字母开头，仅含大写字母、数字与下划线，长度 2-64';
  }
  return null;
}

/**
 * 保存前查重：`code` 已存在返回 `已存在的那条` 的编码，否则 `null`。
 *
 * ⚠️ 接口失败时**返回 null 而不是抛错**——查重是体验优化，
 * 因为查重接口抖动就拦住管理员保存是不可接受的；真冲突还有后端唯一索引兜底。
 */
export async function findCodeConflict(tenantId: string, code: string): Promise<string | null> {
  try {
    for (let page = 1; page <= MAX_SCAN_PAGES; page += 1) {
      const res = await fetchDefinitions(tenantId, page, PAGE_SIZE);
      const hit = res.list.find((d) => d.code === code);
      if (hit) return hit.code;
      if (res.list.length < PAGE_SIZE) return null;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * 把保存失败的错误翻成人话。
 *
 * <p>能识别的三类：唯一索引冲突（英文 PG 原文 / 索引名 / 后端已翻译的「已存在」）、
 * 以及「查重没覆盖到时后端只给了 500」的兜底情形。
 */
export function friendlySaveError(e: unknown, code: string): string {
  const raw = e instanceof Error ? e.message : String(e ?? '');
  if (/仅草稿状态可修改/.test(raw)) {
    return '当前流程仍为已发布状态，无法直接覆盖保存。请使用「仅保存 / 保存并发布」（会自动先取消发布），或先在列表点「取消发布」。';
  }
  const trimmedCode = code.trim();
  const looksLikeConflict =
    /uk_wf_def_tenant_code_ver/i.test(raw) ||
    /duplicate key/i.test(raw) ||
    /已存在/.test(raw) ||
    /内部错误|INTERNAL_ERROR|系统异常/.test(raw);
  if (looksLikeConflict && trimmedCode) {
    return `流程编码「${trimmedCode}」可能已存在（唯一索引 uk_wf_def_tenant_code_ver 冲突），请更换编码后重试。原始错误：${raw}`;
  }
  return raw || '保存失败';
}
