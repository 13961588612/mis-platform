/**
 * 「AI 对话创建」提问输入区。
 *
 * <p>受控输入：value / onChange 由 `SkillBuilderPanel` 上提（对话框持有，关闭即清）。
 */
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

export interface SkillBuilderInputProps {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  sending: boolean;
  disabled?: boolean;
}

export function SkillBuilderInput({
  value,
  onChange,
  onSend,
  sending,
  disabled = false,
}: SkillBuilderInputProps) {
  const canSend = !sending && !disabled && value.trim().length > 0;

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <Textarea
        value={value}
        disabled={disabled || sending}
        placeholder="描述你想要的技能，例如：按会员 ID 查询积分的只读技能…"
        className="min-h-0 flex-1 resize-none overflow-y-auto"
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && canSend) {
            e.preventDefault();
            onSend();
          }
        }}
      />

      <div className="flex shrink-0 items-center justify-between">
        <span className="text-xs text-muted-foreground">⌘/Ctrl + Enter 发送</span>
        <Button size="sm" disabled={!canSend} onClick={onSend}>
          {sending ? '生成中…' : '发送'}
        </Button>
      </div>
    </div>
  );
}
