/**
 * FormSheetView — A2UI `form-sheet` 组件（字段 + 提交）。
 *
 * 渲染后端 ui_render(component="form-sheet", props={...}) 下发的表单。
 * props.fields 为字段描述数组（name/label/type/options/required）；
 * 提交时调用 props.actions.onSubmit（由 A2uiRenderer 注入）。
 * 所有文本经 React 转义，绝不使用 dangerouslySetInnerHTML。
 */

import { useState, type FormEvent } from "react";
import { clsx } from "../../utils/format";
import type { A2UIComponentProps } from "./types";

interface FieldSpec {
  name: string;
  label?: string;
  type?: string;
  placeholder?: string;
  options?: Array<string | { value: string; label: string }>;
  required?: boolean;
}

export function FormSheetView({ props, actions }: A2UIComponentProps): JSX.Element {
  const title = typeof props.title === "string" ? props.title : "表单";
  const fields = Array.isArray(props.fields) ? (props.fields as FieldSpec[]) : [];
  const [values, setValues] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = (e: FormEvent): void => {
    e.preventDefault();
    setSubmitting(true);
    actions?.onSubmit?.({ ...values });
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="my-2 mx-auto max-w-[90%] space-y-3 rounded-lg border border-surface-light bg-white p-4"
    >
      {title && <div className="text-sm font-medium text-surface-dark">{title}</div>}

      {fields.map((f) => {
        const id = `a2ui-field-${f.name}`;
        const value = values[f.name] ?? "";
        const isSelect = f.type === "select" || (f.options != null && f.options.length > 0);
        return (
          <div key={f.name} className="flex flex-col gap-1">
            <label htmlFor={id} className="text-xs text-surface-dark/70">
              {f.label ?? f.name}
              {f.required ? " *" : ""}
            </label>
            {isSelect ? (
              <select
                id={id}
                value={value}
                onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}
                className="rounded-md border border-surface-light bg-white px-3 py-2 text-sm focus:border-primary-400 focus:outline-none"
              >
                <option value="">请选择</option>
                {f.options?.map((o, i) => {
                  const opt = typeof o === "string" ? { value: o, label: o } : o;
                  return (
                    <option key={i} value={opt.value}>
                      {opt.label}
                    </option>
                  );
                })}
              </select>
            ) : (
              <input
                id={id}
                type={f.type ?? "text"}
                placeholder={f.placeholder}
                value={value}
                onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}
                className="rounded-md border border-surface-light bg-white px-3 py-2 text-sm focus:border-primary-400 focus:outline-none"
              />
            )}
          </div>
        );
      })}

      <button
        type="submit"
        disabled={submitting}
        className={clsx(
          "w-full rounded-md bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700",
          "disabled:cursor-not-allowed disabled:opacity-50",
        )}
      >
        {submitting ? "提交中..." : "提交"}
      </button>
    </form>
  );
}

export default FormSheetView;
