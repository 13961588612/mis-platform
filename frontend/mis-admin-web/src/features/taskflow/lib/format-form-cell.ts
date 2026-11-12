/**
 * 表单模块列表单元格：按字段 schema 把扁平 form_data 值格式化成短文案。
 */
import { toFiniteNumber } from '@/features/biz/forms/fields/read-only-number';
import type { FormData, FormFieldSchema, FormFieldValue } from '@/features/biz/forms/types';

const EMPTY = '—';

export function formatFormCellValue(
  field: FormFieldSchema | undefined,
  value: FormFieldValue | undefined,
): string {
  if (value === null || value === undefined || value === '') return EMPTY;
  const type = field?.type ?? 'text';

  if (type === 'bool') {
    if (value === true || value === 'true') return '是';
    if (value === false || value === 'false') return '否';
    return String(value);
  }

  if (type === 'number') {
    const n = toFiniteNumber(value);
    if (n === null) return String(value);
    const formatted = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(n);
    return field?.unit ? `${formatted} ${field.unit}` : formatted;
  }

  if (type === 'select' && field?.options && typeof value === 'string') {
    return field.options.find((o) => o.value === value)?.label ?? value;
  }

  if (Array.isArray(value)) {
    const labels = value.map((v) => {
      if (typeof v !== 'string') return String(v);
      return field?.options?.find((o) => o.value === v)?.label ?? v;
    });
    const text = labels.join('、');
    return text || EMPTY;
  }

  const text = String(value).replace(/\s+/g, ' ').trim();
  return text.length > 40 ? `${text.slice(0, 40)}…` : text;
}

/** schema 列优先；form_data 里多出来的 key 补成列，避免有数据却无表头。 */
export function mergeFormListFields(
  schemaFields: FormFieldSchema[],
  rows: FormData[],
): FormFieldSchema[] {
  const out = [...schemaFields];
  const seen = new Set(out.map((f) => f.key));
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ key, label: key });
    }
  }
  return out;
}
