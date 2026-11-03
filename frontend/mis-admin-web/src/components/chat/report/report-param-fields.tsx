import type { ReactElement } from 'react';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { ReportParamCardSlot } from '@/lib/chat/types';

export interface ReportParamFieldProps {
  slot: ReportParamCardSlot;
  value: string;
  disabled?: boolean;
  onChange: (wireKey: string, value: string) => void;
}

/** 按 value_type 渲染；未知类型回退为下拉。 */
export function ReportParamField({ slot, value, disabled, onChange }: ReportParamFieldProps) {
  const renderer = PARAM_FIELD_RENDERERS[slot.value_type] ?? renderSelectField;
  return renderer({ slot, value, disabled, onChange });
}

type FieldRenderer = (props: ReportParamFieldProps) => ReactElement;

function renderSelectField({ slot, value, disabled, onChange }: ReportParamFieldProps) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">
        {slot.label}
        {slot.required ? <span className="text-destructive"> *</span> : null}
      </Label>
      <Select
        value={value || undefined}
        disabled={disabled || slot.options.length === 0}
        onValueChange={(v) => onChange(slot.wire_key, v)}
      >
        <SelectTrigger className="h-9 bg-background">
          <SelectValue placeholder={slot.options.length === 0 ? '无可选项' : `请选择${slot.label}`} />
        </SelectTrigger>
        <SelectContent>
          {slot.options.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/** 扩展点：新增 value_type 时在此注册，勿改 Panel 壳。 */
export const PARAM_FIELD_RENDERERS: Record<string, FieldRenderer> = {
  store: renderSelectField,
  biz_date: renderSelectField,
  ord_week: renderSelectField,
  ord_month: renderSelectField,
};
