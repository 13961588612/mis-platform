/**
 * 只读字段渲染器统一出口（方案 §3.5 映射表）。
 *
 * ⚠️ **这里是「只读态不实例化业务组件」的落点**。
 * `ReadOnlyForm` 只吃 `fields` + `value`，**签名里根本没有 FormComponent**，
 * 所以物理上不可能渲染业务组件——业务组件的 `useEffect`（可能发请求）不会执行。
 * 这比「渲染了再传 readOnly=true 让组件自己克制」强：后者依赖每个业务组件都写对。
 *
 * 另含方案 §3.3 降级 ④：schema 未声明的键以 `<details>` 追加列出。
 */
import type { FormData, FormFieldSchema } from '../types';
import { ReadOnlyRow } from './read-only-row';
import { ReadOnlyText } from './read-only-text';
import { ReadOnlyNumber } from './read-only-number';
import { ReadOnlyDate } from './read-only-date';
import { ReadOnlyTag } from './read-only-select';
import { ReadOnlyMulti } from './read-only-multi';
import { ReadOnlyBool } from './read-only-bool';

/** 按 `fields[].type` 分发到具体渲染器。缺省 'text'。 */
export function ReadOnlyField({
  field,
  value,
}: {
  field: FormFieldSchema;
  value: FormData[string];
}) {
  switch (field.type) {
    case 'textarea':
      return <ReadOnlyText value={value} multiline />;
    case 'number':
      return <ReadOnlyNumber value={value} unit={field.unit} />;
    case 'date':
      return <ReadOnlyDate value={value} showTime={false} />;
    case 'datetime':
      return <ReadOnlyDate value={value} showTime />;
    case 'select':
      return <ReadOnlyTag value={value} options={field.options} />;
    case 'multi':
      return <ReadOnlyMulti value={value} options={field.options} collapse={field.collapseInReadonly} />;
    case 'bool':
      return <ReadOnlyBool value={value} />;
    case 'text':
    default:
      return <ReadOnlyText value={value} />;
  }
}

/** 把任意值转成可展示的 JSON 文本（降级 ④ 用）。 */
function stringifyValue(value: FormData[string]): string {
  if (value === null) return 'null';
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

/**
 * 只读表单视图。
 *
 * ⚠️ **props 里刻意没有 `component`** —— 见文件头注释。
 * 传入的 `value` 里若有 schema 未声明的键，按方案 §3.3 降级 ④ 追加 `<details>`。
 */
export function ReadOnlyForm({
  fields,
  value,
  emptyText = '暂无表单数据',
}: {
  fields: FormFieldSchema[];
  value: FormData;
  emptyText?: string;
}) {
  const declared = new Set(fields.map((f) => f.key));
  const undeclared = Object.keys(value).filter((k) => !declared.has(k));

  if (fields.length === 0 && undeclared.length === 0) {
    return (
      <div className="rounded border border-dashed border-border px-3 py-6 text-center text-[13px] text-muted-foreground">
        {emptyText}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3" data-testid="read-only-form">
      {fields.length === 0 ? null : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {fields.map((field) => (
            <ReadOnlyRow key={field.key} label={field.label}>
              <ReadOnlyField field={field} value={value[field.key]} />
            </ReadOnlyRow>
          ))}
        </div>
      )}

      {undeclared.length > 0 && (
        <details className="rounded border border-border/60 bg-muted/30 px-3 py-2">
          <summary className="cursor-pointer text-[12px] text-muted-foreground">
            {`未在 schema 中声明的字段（${undeclared.length}）`}
          </summary>
          <dl className="mt-2 flex flex-col gap-1">
            {undeclared.map((key) => (
              <div key={key} className="flex gap-2 text-[12px]">
                <dt className="shrink-0 text-muted-foreground">{key}</dt>
                <dd className="min-w-0 break-all text-foreground">{stringifyValue(value[key])}</dd>
              </div>
            ))}
          </dl>
        </details>
      )}
    </div>
  );
}

export { ReadOnlyRow, READONLY_VALUE_CLASS, READONLY_VALUE_MULTILINE_CLASS, EMPTY_PLACEHOLDER, isBlank } from './read-only-row';
export { ReadOnlyText } from './read-only-text';
export { ReadOnlyNumber, toFiniteNumber } from './read-only-number';
export { ReadOnlyDate, parseDateValue, formatDateCn } from './read-only-date';
export { ReadOnlyTag, findLabel } from './read-only-select';
export { ReadOnlyMulti, toStringList } from './read-only-multi';
export { ReadOnlyBool, parseBoolValue } from './read-only-bool';
