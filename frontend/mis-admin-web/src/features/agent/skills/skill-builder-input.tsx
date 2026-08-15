/**
 * 「AI 对话创建」输入区（P2-1 示例模板 / P2-3 本地草稿）。
 *
 * <p>受控输入：value / onChange 由 `SkillBuilderPanel` 上提（对话框持有，关闭即清）。
 * 提供示例技能描述快捷填入（P2-1），以及发送按钮（生成中禁用）。
 */
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

export interface SkillBuilderInputProps {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  sending: boolean;
  disabled?: boolean;
  examples: string[];
  onUseExample: (text: string) => void;
}

export function SkillBuilderInput({
  value,
  onChange,
  onSend,
  sending,
  disabled = false,
  examples,
  onUseExample,
}: SkillBuilderInputProps) {
  const canSend = !sending && !disabled && value.trim().length > 0;

  return (
    <div className="space-y-2">
      {examples.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {examples.map((ex) => (
            <button
              key={ex}
              type="button"
              disabled={sending}
              onClick={() => onUseExample(ex)}
              className="rounded-full border bg-muted/40 px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted disabled:opacity-50"
              title="点击填入输入框"
            >
              {ex.length > 24 ? `${ex.slice(0, 24)}…` : ex}
            </button>
          ))}
        </div>
      ) : null}

      <Textarea
        value={value}
        rows={3}
        disabled={disabled || sending}
        placeholder="描述你想要的技能，例如：按会员 ID 查询积分的只读技能…"
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && canSend) {
            e.preventDefault();
            onSend();
          }
        }}
      />

      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">⌘/Ctrl + Enter 发送</span>
        <Button size="sm" disabled={!canSend} onClick={onSend}>
          {sending ? '生成中…' : '发送'}
        </Button>
      </div>
    </div>
  );
}
