/**
 * 「AI 对话创建」右栏：上半浏览现有技能、下半提问。
 *
 * <p>自动回填始终开启且不可关闭；生成结果直接写入左栏字段与中栏正文。
 */
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import type { SkillBuilderSelection } from '../types';
import { SkillBuilderInput } from './skill-builder-input';

export interface SkillBuilderPanelProps {
  sending: boolean;
  input: string;
  onInputChange: (v: string) => void;
  onSend: () => void;
  error: string | null;
  onOpenSelector: () => void;
  selectedSkills: SkillBuilderSelection[];
  onRemoveSelected: (skill_id: string) => void;
  onGenerateWithSelected: () => void;
  onClearSelected: () => void;
}

export function SkillBuilderPanel({
  sending,
  input,
  onInputChange,
  onSend,
  error,
  onOpenSelector,
  selectedSkills,
  onRemoveSelected,
  onGenerateWithSelected,
  onClearSelected,
}: SkillBuilderPanelProps) {
  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex shrink-0 items-center justify-between">
        <span className="text-sm font-medium text-foreground">与 AI 一起生成 SKILL.md</span>
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <input
            type="checkbox"
            className="h-3.5 w-3.5 accent-primary"
            checked
            disabled
            readOnly
          />
          自动回填
        </label>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border bg-muted/30 p-2">
        <div className="flex shrink-0 items-center justify-between gap-2">
          <span className="min-w-0 text-xs text-muted-foreground">
            参考现有技能合并生成（数据源 GET /skills）
          </span>
          <Button size="sm" variant="outline" className="shrink-0" onClick={onOpenSelector}>
            浏览现有技能
          </Button>
        </div>
        <div className="mt-2 min-h-0 flex-1 overflow-y-auto">
          {selectedSkills.length > 0 ? (
            <div className="space-y-1.5">
              <div className="flex flex-wrap gap-1.5">
                {selectedSkills.map((s) => (
                  <span
                    key={s.skill_id}
                    className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary"
                  >
                    {s.name}
                    <button
                      type="button"
                      className="text-primary/70 hover:text-primary"
                      onClick={() => onRemoveSelected(s.skill_id)}
                      aria-label={`移除 ${s.name}`}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
              <div className="flex items-center gap-2">
                <Button size="sm" onClick={onGenerateWithSelected} disabled={sending}>
                  用所选技能生成
                </Button>
                <Button size="sm" variant="ghost" onClick={onClearSelected} disabled={sending}>
                  清空
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border bg-muted/20 p-2">
        {error ? (
          <p
            className={cn(
              'mb-2 shrink-0 rounded-md border border-destructive/50 bg-destructive/10 px-2.5 py-1.5 text-xs text-destructive',
            )}
          >
            {error}
          </p>
        ) : null}
        <div className="min-h-0 flex-1">
          <SkillBuilderInput
            value={input}
            onChange={onInputChange}
            onSend={onSend}
            sending={sending}
          />
        </div>
      </div>
    </div>
  );
}
