/**
 * 只读字段渲染（P7）。
 *
 * <p>用「组件映射替换法」而非 disabled：审批界面保持布局一致、文本可选中复制、
 * 视觉上像「已填写的信息」而不是「不可用的控件」。见设计文档 §9。
 */
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export function ReadOnlyText({ value }: { value?: string | number | null }) {
  return <div className="readonly-text">{value === null || value === undefined || value === '' ? '-' : value}</div>;
}

export function ReadOnlyTag({ value }: { value?: string | null }) {
  if (!value) return <ReadOnlyText value={null} />;
  return (
    <div className="flex flex-wrap gap-1">
      <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">{value}</span>
    </div>
  );
}

export interface ReadOnlyFieldProps {
  label: string;
  children: ReactNode;
}

/** 只读字段的标签 + 值容器。 */
export function ReadOnlyField({ label, children }: ReadOnlyFieldProps) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[12px] text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

/** 只读字段样式（去边框、浅灰底、可选中）。 */
export const READONLY_FIELD_CLASS = cn(
  'w-full min-h-[34px] rounded border border-transparent bg-muted/40 px-3 py-1.5 text-[13px] text-foreground cursor-default whitespace-pre-wrap',
);
