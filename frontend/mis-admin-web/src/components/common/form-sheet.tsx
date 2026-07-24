import { useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';

export interface FormSheetField {
  key: string;
  label: string;
  placeholder?: string;
  required?: boolean;
  type?: 'text' | 'textarea' | 'select';
  options?: { label: string; value: string }[];
}

interface FormSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: 'create' | 'edit' | 'view';
  title: string;
  description?: string;
  fields?: FormSheetField[];
  initialValues?: Record<string, string>;
  footerExtra?: ReactNode;
  onSubmit?: (values: Record<string, string>) => void;
}

const DEFAULT_FIELDS: FormSheetField[] = [
  { key: 'name', label: '名称', placeholder: '请输入名称', required: true },
  {
    key: 'org',
    label: '所属组织',
    type: 'select',
    options: [
      { label: '运营中心', value: '运营中心' },
      { label: '研发中心', value: '研发中心' },
      { label: '数据中心', value: '数据中心' },
    ],
  },
  {
    key: 'status',
    label: '状态',
    type: 'select',
    options: [
      { label: '启用', value: 'enabled' },
      { label: '禁用', value: 'disabled' },
      { label: '锁定', value: 'locked' },
    ],
  },
  { key: 'remark', label: '备注', type: 'textarea', placeholder: '可选说明' },
];

export function FormSheet({
  open,
  onOpenChange,
  mode,
  title,
  description,
  fields = DEFAULT_FIELDS,
  initialValues,
  footerExtra,
  onSubmit,
}: FormSheetProps) {
  const [values, setValues] = useState<Record<string, string>>({});
  const readOnly = mode === 'view';

  const syncOpen = (next: boolean) => {
    if (next) {
      const seed: Record<string, string> = {};
      for (const f of fields) seed[f.key] = initialValues?.[f.key] ?? '';
      setValues(seed);
    }
    onOpenChange(next);
  };

  return (
    <Sheet open={open} onOpenChange={syncOpen}>
      <SheetContent side="right" className="max-w-md p-0 sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription>
            {description ??
              (mode === 'create' ? '填写后保存（骨架演示，未写库）' : '查看或编辑记录（骨架演示）')}
          </SheetDescription>
        </SheetHeader>
        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {fields.map((field) => (
            <div key={field.key} className="space-y-1.5">
              <Label htmlFor={`sheet-${field.key}`}>
                {field.label}
                {field.required ? <span className="text-destructive"> *</span> : null}
              </Label>
              {field.type === 'textarea' ? (
                <textarea
                  id={`sheet-${field.key}`}
                  disabled={readOnly}
                  placeholder={field.placeholder}
                  value={values[field.key] ?? ''}
                  onChange={(e) => setValues((v) => ({ ...v, [field.key]: e.target.value }))}
                  className="min-h-[5rem] w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
                />
              ) : field.type === 'select' ? (
                <select
                  id={`sheet-${field.key}`}
                  disabled={readOnly}
                  value={values[field.key] ?? ''}
                  onChange={(e) => setValues((v) => ({ ...v, [field.key]: e.target.value }))}
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm disabled:opacity-60"
                >
                  <option value="">请选择</option>
                  {(field.options ?? []).map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              ) : (
                <Input
                  id={`sheet-${field.key}`}
                  disabled={readOnly}
                  placeholder={field.placeholder}
                  value={values[field.key] ?? ''}
                  onChange={(e) => setValues((v) => ({ ...v, [field.key]: e.target.value }))}
                />
              )}
            </div>
          ))}
        </div>
        <SheetFooter>
          {footerExtra}
          <Button type="button" variant="outline" className="flex-1" onClick={() => syncOpen(false)}>
            {readOnly ? '关闭' : '取消'}
          </Button>
          {!readOnly ? (
            <Button
              type="button"
              className="flex-1"
              onClick={() => {
                onSubmit?.(values);
                syncOpen(false);
              }}
            >
              确定
            </Button>
          ) : null}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
