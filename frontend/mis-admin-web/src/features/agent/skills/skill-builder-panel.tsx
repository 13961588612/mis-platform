/**
 * 「AI 对话创建」右栏 AI 对话面板容器（C 功能）。
 *
 * <p>本组件为**受控展示 + 行为上提**：对话的 state（messages / input / sending /
 * staged / error / autoRefill）全部由 `AgentSkillFormDialog` 持有，以便
 *   - 切换 A/B/C Tab 不丢失 AI 上下文；
 *   - 关闭对话框（open=false）时由对话框统一重置（P2-3 本地草稿关闭即清）。
 *
 * <p>交互（设计 §8-1 / P1-1 / P2-2）：
 *   - 发送 → 对话框调 `chatSkillBuilder` → 抽取 ```SKILL.md → 复用 `parseSkill`；
 *   - 解析成功未回填时在此**暂存预览**（P2-2），用户点「回填」才写回表单；
 *   - `autoRefill` 开启时由对话框在解析成功后自动写回（默认关闭，手动点按）。
 */
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import type {
  SkillBuilderChatResponse,
  SkillBuilderMessage,
  SkillBuilderSelection,
} from '../types';
import { SkillBuilderMessageList } from './skill-builder-message-list';
import { SkillBuilderInput } from './skill-builder-input';
import { SKILL_BUILDER_EMPTY_HINT, SKILL_BUILDER_EXAMPLES } from './skill-builder-guide';

/** 解析成功、尚未写回表单时的暂存结果（P2-2）。 */
export interface StagedResult {
  /** 抽取出的 SKILL.md 文本（用于预览）。 */
  skillMd: string;
  /** parseSkill 返回的 metadata。 */
  meta: Record<string, unknown>;
  /** parseSkill 返回的 body。 */
  body: string;
  /** 后端判定的收敛状态。 */
  converged: boolean;
}

export interface SkillBuilderPanelProps {
  /** 对话消息列表（含生成态）。 */
  messages: SkillBuilderMessage[];
  /** 是否正在生成。 */
  sending: boolean;
  /** 输入草稿（受控）。 */
  input: string;
  onInputChange: (v: string) => void;
  onSend: () => void;
  /** 自动回填开关（默认关闭）。 */
  autoRefill: boolean;
  onToggleAutoRefill: (v: boolean) => void;
  /** 内联错误（发送/解析失败）。 */
  error: string | null;
  /** 暂存预览（解析成功未回填时）。 */
  staged: StagedResult | null;
  onRefill: () => void;
  onDiscardStaged: () => void;
  // —— T04：内嵌选择器（不离开创建流）——
  /** 打开技能选择器。 */
  onOpenSelector: () => void;
  /** 已选技能（来自选择器）。 */
  selectedSkills: SkillBuilderSelection[];
  /** 移除某个已选技能。 */
  onRemoveSelected: (skill_id: string) => void;
  /** 用已选技能作为上下文发起生成。 */
  onGenerateWithSelected: () => void;
  /** 清空已选技能。 */
  onClearSelected: () => void;
}

export function SkillBuilderPanel({
  messages,
  sending,
  input,
  onInputChange,
  onSend,
  autoRefill,
  onToggleAutoRefill,
  error,
  staged,
  onRefill,
  onDiscardStaged,
  onOpenSelector,
  selectedSkills,
  onRemoveSelected,
  onGenerateWithSelected,
  onClearSelected,
}: SkillBuilderPanelProps) {
  return (
    <div className="flex h-full min-h-[20rem] flex-col gap-3">
      {/* 头部：标题 + 自动回填开关 */}
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-foreground">与 AI 一起生成 SKILL.md</span>
        <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
          <input
            type="checkbox"
            className="h-3.5 w-3.5 accent-primary"
            checked={autoRefill}
            onChange={(e) => onToggleAutoRefill(e.target.checked)}
          />
          自动回填
        </label>
      </div>

      {/* T04：内嵌选择器触发 + 已选技能回显（不离开创建流） */}
      <div className="rounded-md border bg-muted/30 p-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">
            参考现有技能合并生成（数据源 GET /skills）
          </span>
          <Button size="sm" variant="outline" onClick={onOpenSelector}>
            浏览现有技能
          </Button>
        </div>
        {selectedSkills.length > 0 ? (
          <div className="mt-2 space-y-1.5">
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

      {/* 消息流 */}
      <div className="flex-1 overflow-auto rounded-md border bg-muted/20 p-3">
        {messages.length === 0 ? (
          <p className="whitespace-pre-wrap text-center text-sm text-muted-foreground">
            {SKILL_BUILDER_EMPTY_HINT}
          </p>
        ) : (
          <SkillBuilderMessageList messages={messages} />
        )}
      </div>

      {/* 暂存预览（P2-2）：解析成功未回填时展示，点「回填」写回表单 */}
      {staged ? (
        <div className="rounded-md border border-amber-400/60 bg-amber-50/50 p-2.5">
          <p className="mb-1 text-xs font-medium text-amber-700">
            已解析出 SKILL.md{staged.converged ? '（完整）' : ''}，待回填：
          </p>
          <pre className="max-h-36 overflow-auto rounded bg-white/70 p-2 font-mono text-xs text-foreground">
            {staged.skillMd}
          </pre>
          <div className="mt-2 flex items-center gap-2">
            <Button size="sm" onClick={onRefill}>
              回填到表单
            </Button>
            <Button size="sm" variant="ghost" onClick={onDiscardStaged}>
              放弃
            </Button>
          </div>
        </div>
      ) : null}

      {/* 内联错误（解析/发送失败，可重试） */}
      {error ? (
        <p className={cn('rounded-md border border-destructive/50 bg-destructive/10 px-2.5 py-1.5 text-xs text-destructive')}>
          {error}
        </p>
      ) : null}

      {/* 输入区（示例模板 + 草稿 + 发送） */}
      <SkillBuilderInput
        value={input}
        onChange={onInputChange}
        onSend={onSend}
        sending={sending}
        examples={SKILL_BUILDER_EXAMPLES}
        onUseExample={(text) => onInputChange(text)}
      />
    </div>
  );
}

/** 后端响应类型再导出，供对话框在发送逻辑里做类型标注。 */
export type { SkillBuilderChatResponse };
