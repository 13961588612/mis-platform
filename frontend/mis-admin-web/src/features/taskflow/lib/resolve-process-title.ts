/**
 * 流程实例标题解析（对齐后端 ProcessService.resolveInstanceTitle）。
 *
 * <p>优先级：显式 title → 表单 config.titleField 对应 formData 字段 → null（需弹窗补录）。
 */

export const PROCESS_TITLE_REQUIRED_MESSAGE = '请补录流程标题';

export interface ResolveProcessTitleInput {
  /** 表单定义 config JSON（可含 titleField）。 */
  formConfig?: string | null;
  /** 表单数据：对象或 JSON 字符串。 */
  formData?: Record<string, unknown> | string | null;
  /** 调用方显式标题（补录结果）。 */
  explicitTitle?: string | null;
}

/** 从 form_definition.config 读取 titleField。 */
export function readConfigTitleField(configJson?: string | null): string | null {
  if (!configJson || !configJson.trim() || configJson.trim() === '{}') return null;
  try {
    const root = JSON.parse(configJson) as Record<string, unknown>;
    const v = root.titleField;
    if (typeof v !== 'string') return null;
    const t = v.trim();
    return t.length > 0 ? t : null;
  } catch {
    return null;
  }
}

/** 写入 / 清除 config.titleField，保留其余键。 */
export function withConfigTitleField(
  configJson: string | null | undefined,
  titleField: string | null,
): string {
  let root: Record<string, unknown> = {};
  if (configJson && configJson.trim() && configJson.trim() !== '{}') {
    try {
      const parsed = JSON.parse(configJson) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        root = { ...(parsed as Record<string, unknown>) };
      }
    } catch {
      root = {};
    }
  }
  const trimmed = titleField?.trim() ?? '';
  if (trimmed) {
    root.titleField = trimmed;
  } else {
    delete root.titleField;
  }
  return JSON.stringify(root);
}

function asFormDataObject(
  formData?: Record<string, unknown> | string | null,
): Record<string, unknown> | null {
  if (formData == null) return null;
  if (typeof formData === 'string') {
    if (!formData.trim() || formData.trim() === '{}') return null;
    try {
      const parsed = JSON.parse(formData) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
      return null;
    } catch {
      return null;
    }
  }
  return formData;
}

function fieldText(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    const t = String(value).trim();
    return t.length > 0 ? t : null;
  }
  return null;
}

/**
 * @returns 非空标题，或 `null`（前端应弹窗补录；后端同文案拒绝）。
 */
export function resolveProcessTitle(input: ResolveProcessTitleInput): string | null {
  const explicit = input.explicitTitle?.trim();
  if (explicit) return explicit;

  const titleField = readConfigTitleField(input.formConfig);
  if (!titleField) return null;

  const data = asFormDataObject(input.formData);
  if (!data) return null;
  return fieldText(data[titleField]);
}
