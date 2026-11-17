import type { FormData, FormFieldSchema, FormFieldValue } from '../types';

/** 当前登录用户是否可看到某表单的「辅助录入」。 */
export function canShowFormAiAssist(
  form: { aiAgentId?: string | null; aiSkillId?: string | null } | null | undefined,
  hasPermission: (code: string) => boolean,
): boolean {
  const agent = form?.aiAgentId?.trim();
  const skill = form?.aiSkillId?.trim();
  if (!agent || !skill) return false;
  return hasPermission(`ai:skill:${skill}:run`);
}

export function skillRunPermission(skillId: string): string {
  return `ai:skill:${skillId}:run`;
}

/** 从助手回复中取出 `{ fields }`；键必须是 schema.key。 */
export function parseFormAssistFields(raw: string): Record<string, unknown> {
  const text = raw.trim();
  if (!text) return {};
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const candidate = (fenced?.[1] ?? text).trim();
  const sliced = sliceJsonObject(candidate);
  if (!sliced) return {};
  try {
    const parsed = JSON.parse(sliced) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const obj = parsed as Record<string, unknown>;
    const fields = obj.fields;
    if (fields && typeof fields === 'object' && !Array.isArray(fields)) {
      return fields as Record<string, unknown>;
    }
    return obj;
  } catch {
    return {};
  }
}

function sliceJsonObject(text: string): string | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  return text.slice(start, end + 1);
}

export function normalizeAssistValue(field: FormFieldSchema, value: unknown): FormFieldValue | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const type = field.type ?? 'text';
  if (type === 'select' && field.options?.length) {
    const asStr = String(value);
    if (field.options.some((o) => o.value === asStr)) return asStr;
    const byLabel = field.options.find((o) => o.label === asStr);
    return byLabel ? byLabel.value : asStr;
  }
  if (type === 'multi') {
    const rawList = Array.isArray(value) ? value : String(value).split(/[,，]/);
    const mapped = rawList
      .map((v) => String(v).trim())
      .filter(Boolean)
      .map((v) => {
        const hit = field.options?.find((o) => o.value === v || o.label === v);
        return hit?.value ?? v;
      });
    return mapped;
  }
  if (type === 'number') {
    const n = typeof value === 'number' ? value : Number(String(value).replace(/[,，\s元]/g, ''));
    return Number.isFinite(n) ? n : undefined;
  }
  if (type === 'bool') {
    if (typeof value === 'boolean') return value;
    const s = String(value).toLowerCase();
    if (['true', '1', 'yes', '是', '加急'].includes(s)) return true;
    if (['false', '0', 'no', '否'].includes(s)) return false;
    return undefined;
  }
  return String(value);
}

export function pickAssistFields(
  schema: FormFieldSchema[],
  raw: Record<string, unknown>,
): FormData {
  const next: FormData = {};
  for (const field of schema) {
    if (!(field.key in raw)) continue;
    const v = normalizeAssistValue(field, raw[field.key]);
    if (v !== undefined) next[field.key] = v;
  }
  return next;
}

export function buildFormAssistPrompt(input: {
  formCode: string;
  skillId: string;
  fields: FormFieldSchema[];
  currentValues: FormData;
  userText: string;
}): string {
  const schema = input.fields.map((f) => ({
    key: f.key,
    label: f.label,
    type: f.type ?? 'text',
    options: f.options,
  }));
  const said = input.userText.trim() || '（无文字，请看附件）';
  return [
    '【表单辅助录入】',
    `请加载并遵守技能 ${input.skillId}。`,
    `formCode=${input.formCode}`,
    '只输出 JSON：{"fields":{"<key>": <value>}}。key 必须等于 schema 中的 key。',
    'select/multi 用 options.value；number 不要带单位；date 用 YYYY-MM-DD；bool 用 true/false。没有依据的字段不要输出。',
    `schema=${JSON.stringify(schema)}`,
    `current_values=${JSON.stringify(input.currentValues)}`,
    `用户说明：${said}`,
  ].join('\n');
}
