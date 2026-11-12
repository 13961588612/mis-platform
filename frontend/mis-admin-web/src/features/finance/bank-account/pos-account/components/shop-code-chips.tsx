import { X } from 'lucide-react';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

/**
 * 门店号多选（MIS 暂无门店主数据；输入门店号回车添加）。
 * 后续可替换为权限门店下拉。
 */
export function ShopCodeChips({
  value,
  onChange,
  placeholder = '输入门店号后回车添加',
  disabled,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState('');

  const add = () => {
    const code = draft.trim();
    if (!code) return;
    if (!value.includes(code)) onChange([...value, code]);
    setDraft('');
  };

  return (
    <div className="flex min-w-[220px] flex-1 flex-col gap-1.5">
      <div className="flex flex-wrap gap-1">
        {value.map((code) => (
          <Badge key={code} variant="secondary" className="gap-1 pr-1">
            {code}
            {!disabled ? (
              <button
                type="button"
                className="rounded-sm p-0.5 hover:bg-muted"
                onClick={() => onChange(value.filter((c) => c !== code))}
              >
                <X className="h-3 w-3" />
              </button>
            ) : null}
          </Badge>
        ))}
      </div>
      <div className="flex gap-2">
        <Input
          value={draft}
          disabled={disabled}
          placeholder={placeholder}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
        />
        <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={add}>
          添加
        </Button>
      </div>
    </div>
  );
}
