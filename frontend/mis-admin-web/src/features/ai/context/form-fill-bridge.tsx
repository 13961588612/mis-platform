import { createContext, useContext, type ReactNode } from 'react';
import type { AdminField, AdminPageDef } from '@/features/system/types';
import type { FieldSuggestion, FormFieldSchema } from '../types';

/**
 * 表单回填桥接：桥接 AI 组件与 AdminListPage 表单态。
 * schema 真源 = def.form（AdminField.key 唯一真源）。
 */
export interface FormFillBridge {
  def: AdminPageDef;
  /** 由 def.form 映射出的表单 schema（作为 extract 输入） */
  getSchema: () => FormFieldSchema[];
  /** 当前表单值 */
  getValues: () => Record<string, unknown>;
  /** 仅回填已确认项（HITL：未确认项绝不落值） */
  applyFields: (partial: Record<string, FieldSuggestion>) => void;
  /** 供「智能录入」先打开创建 Sheet，再填充 */
  openCreate: () => void;
}

const FormFillBridgeContext = createContext<FormFillBridge | null>(null);

export function FormFillBridgeProvider({
  value,
  children,
}: {
  value: FormFillBridge;
  children: ReactNode;
}) {
  return <FormFillBridgeContext.Provider value={value}>{children}</FormFillBridgeContext.Provider>;
}

export function useFormFillBridge(): FormFillBridge {
  const ctx = useContext(FormFillBridgeContext);
  if (!ctx) {
    throw new Error('useFormFillBridge 必须在 FormFillBridgeProvider 内使用');
  }
  return ctx;
}

/** AdminField → FormFieldSchema 映射（schema 真源 = def.form） */
export function toFormFieldSchema(fields: AdminField[]): FormFieldSchema[] {
  return fields.map((f) => {
    // AdminField 用 'text'，FormFieldSchema 用 'string'，此处归一以对齐抽取契约
    const rawType = f.type ?? 'text';
    const type: FormFieldSchema['type'] = rawType === 'text' ? 'string' : (rawType as FormFieldSchema['type']);
    return {
      name: f.key,
      label: f.label,
      type,
      options: f.options?.map((o) => ({ value: o.value, label: o.label })),
      required: f.required,
    };
  });
}
