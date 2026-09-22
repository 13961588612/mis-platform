/**
 * SqlEditor.tsx — 样本对 SQL 编辑框（CodeMirror 6 + `<Textarea>` 兜底；T04e / MR-08）。
 *
 * <h2>为什么抽成组件（照 `RelationshipDialog.ConditionEditor` 的范例）</h2>
 * 降级路径集中一处：编辑器不可用（CodeMirror 依赖缺失 / 动态 import 被 CSP 拦 / 容器未挂载）时
 * 退回 `<Textarea>` —— **绝不让编辑器故障阻断「样本对」这条业务主路径**（v1.10 的
 * 「DB 类型下拉 → 转化 → 试运行 → 保存」必须照常可用）。
 *
 * <h2>不复用 instruction 目录</h2>
 * 本组件只依赖共享 hook {@link useCodeMirror}，与「指令页」无耦合。
 */
import { Loader2 } from 'lucide-react';
import { Textarea } from '@/components/ui/textarea';
import { useCodeMirror } from '../../hooks/useCodeMirror';

/** `SqlEditor` Props。 */
export interface SqlEditorProps {
  /** 受控值。 */
  value: string;
  /** 内容变更回调。 */
  onChange: (next: string) => void;
  /** 占位文案。 */
  placeholder: string;
  /** 内容区高度（默认 120px）。 */
  height?: number;
  /** 只读。 */
  readOnly?: boolean;
}

/** SQL 编辑框（CodeMirror 6，失败降级为 Textarea）。 */
export function SqlEditor({
  value,
  onChange,
  placeholder,
  height = 120,
  readOnly = false,
}: SqlEditorProps) {
  const editor = useCodeMirror({ value, onChange, placeholder, height, readOnly });

  // ★ 降级路径：编辑器不可用 → Textarea 兜底（不阻断业务）
  if (editor.error) {
    return (
      <div className="space-y-1">
        <Textarea
          value={value}
          onChange={(event) => onChange(event.target.value)}
          readOnly={readOnly}
          className="min-h-[90px] font-mono text-[13px]"
          placeholder={placeholder}
        />
        <p className="text-[11px] text-muted-foreground">
          代码编辑器不可用（{editor.error}），已降级为纯文本输入。
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <div
        ref={editor.containerRef}
        className="overflow-hidden rounded border border-border/60 bg-background px-2"
      />
      {editor.loading && (
        <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" />
          编辑器加载中…
        </p>
      )}
      {editor.degraded && (
        <p className="text-[11px] text-muted-foreground">
          SQL 高亮不可用（依赖缺失），已降级为纯文本编辑。
        </p>
      )}
    </div>
  );
}

export default SqlEditor;
