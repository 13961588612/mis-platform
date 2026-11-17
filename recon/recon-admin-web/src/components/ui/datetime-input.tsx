import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/** 值互转：接口串 "yyyy-MM-dd HH:mm:ss" ↔ 原生 datetime-local 值 */
function toLocalInput(v: string): string {
  const m = v?.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}` : '';
}

function toApiValue(v: string): string {
  const m = v?.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/);
  return m ? `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}:${m[6] ?? '00'}` : '';
}

export interface DateTimeInputProps {
  /** 外部值：接口格式 "yyyy-MM-dd HH:mm:ss"，空串=未选择 */
  value: string;
  onChange: (v: string) => void;
  label?: string;
  /** 英文字段名小字（§1.6 文案规范） */
  en?: string;
  required?: boolean;
  note?: string;
  disabled?: boolean;
  className?: string;
}

/**
 * 日期时间输入框（原生 datetime-local 选择器）。
 * 内部用 datetime-local 交互，对外始终以 "yyyy-MM-dd HH:mm:ss" 传递，
 * 避免手工输入格式不一致导致后端 LocalDateTime 解析失败。
 */
export function DateTimeInput({
  value,
  onChange,
  label,
  en,
  required,
  note,
  disabled,
  className,
}: DateTimeInputProps) {
  return (
    <div className={cn('space-y-1.5', className)}>
      {label && (
        <Label>
          {label}
          {en && <span className="en">{en}</span>}
          {required && ' *'}
        </Label>
      )}
      <Input
        type="datetime-local"
        className="h-9 w-full"
        disabled={disabled}
        value={toLocalInput(value)}
        onChange={(e) => onChange(toApiValue(e.target.value))}
      />
      {note && <p className="f-note">{note}</p>}
    </div>
  );
}