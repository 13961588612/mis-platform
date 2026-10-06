/**
 * FormSheet — A2UI `form-sheet` 组件（shadcn，T06'）。
 *
 * <p>渲染权限：默认可见；写操作 `form:submit` 经 bff-actions → BFF 校验。
 * 卡片内嵌「打开表单」按钮，Sheet 内渲染字段（Input / Select）并提交；
 * 403 时 PermissionErrorBanner 内联常驻。
 */

import { useState } from 'react';
import { ClipboardList } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { PermissionErrorBanner } from '@/components/a2ui/PermissionErrorBanner';
import { useA2ui, useA2uiNode } from '../a2ui-context';
import type { A2uiComponentProps, BffActionError } from '@/lib/a2ui/types';

interface FieldSpec {
  name: string;
  label?: string;
  type?: string;
  placeholder?: string;
  options?: Array<string | { value: string; label: string }>;
  required?: boolean;
}

export function FormSheet({ props }: A2uiComponentProps) {
  const { executeBffAction, dispatchAction } = useA2ui();
  const node = useA2uiNode();
  const surfaceId = node?.surfaceId ?? '';
  const componentId = node?.componentId ?? '';
  const title = typeof props.title === 'string' ? props.title : '表单';
  const description = typeof props.description === 'string' ? props.description : '';
  const fields = Array.isArray(props.fields) ? (props.fields as FieldSpec[]) : [];

  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [bffError, setBffError] = useState<BffActionError | null>(null);

  const setValue = (name: string, value: string): void => {
    setValues((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (): Promise<void> => {
    if (submitting) return;
    setSubmitting(true);
    setBffError(null);
    const result = await executeBffAction('form-sheet', 'submit', { ...values });
    setSubmitting(false);
    if (result.ok) {
      setSubmitted(true);
      // 携带真实 surface.id 与 node.id（QA 建议 1）
      dispatchAction({
        surfaceId,
        componentId,
        action: 'submit',
        payload: { ...values },
      });
    } else {
      setBffError(result.error ?? null);
    }
  };

  return (
    <>
      <Card className="my-2 w-full rounded-lg shadow-none">
        <CardHeader className="flex flex-row items-start gap-3 space-y-0 pb-3">
          <ClipboardList className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <div className="min-w-0">
            <CardTitle className="text-sm font-medium">{title}</CardTitle>
            {description ? (
              <CardDescription className="mt-1 text-xs">{description}</CardDescription>
            ) : null}
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          <PermissionErrorBanner error={bffError} />
          <Button type="button" size="sm" className="mt-2" onClick={() => setOpen(true)}>
            打开表单
          </Button>
        </CardContent>
      </Card>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="w-full max-w-md overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{title}</SheetTitle>
            {description ? <SheetDescription>{description}</SheetDescription> : null}
          </SheetHeader>
          <div className="space-y-4 px-5 py-4">
            {fields.map((f) => {
              const isSelect = f.type === 'select' || (f.options != null && f.options.length > 0);
              return (
                <div key={f.name} className="space-y-1.5">
                  <Label htmlFor={`a2ui-field-${f.name}`} className="text-[13px]">
                    {f.label ?? f.name}
                    {f.required ? <span className="text-destructive"> *</span> : null}
                  </Label>
                  {isSelect ? (
                    <Select value={values[f.name] ?? ''} onValueChange={(v) => setValue(f.name, v)}>
                      <SelectTrigger id={`a2ui-field-${f.name}`} className="w-full">
                        <SelectValue placeholder="请选择" />
                      </SelectTrigger>
                      <SelectContent>
                        {(f.options ?? []).map((o, i) => {
                          const opt = typeof o === 'string' ? { value: o, label: o } : o;
                          return (
                            <SelectItem key={opt.value} value={opt.value}>
                              {opt.label}
                            </SelectItem>
                          );
                        })}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Input
                      id={`a2ui-field-${f.name}`}
                      type={f.type ?? 'text'}
                      placeholder={f.placeholder}
                      value={values[f.name] ?? ''}
                      onChange={(e) => setValue(f.name, e.target.value)}
                    />
                  )}
                </div>
              );
            })}

            <PermissionErrorBanner error={bffError} />

            <div className="flex gap-2 pt-2">
              <Button
                type="button"
                className="flex-1"
                disabled={submitting || submitted}
                onClick={() => void handleSubmit()}
              >
                {submitting ? '提交中…' : submitted ? '已提交' : '提交'}
              </Button>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                取消
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}

export default FormSheet;
