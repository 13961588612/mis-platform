/**
 * 「AI 对话创建」对话消息列表（P0-3 / P1-2）。
 *
 * <p>渲染用户/助手气泡，助手消息展示生成态：
 *   - `generating`：显示「生成中…」骨架/省略号；
 *   - `generated`：正常渲染（若收敛额外标注「可回填」）；
 *   - `error`：红色错误气泡。
 *
 * <p>纯展示组件，数据来自 `SkillBuilderPanel` 的 `messages` state。
 */
import { cn } from '@/lib/utils';
import type { SkillBuilderMessage } from '../types';
import { CODE_FENCE_LABEL_RE } from './skill-builder-utils';

export interface SkillBuilderMessageListProps {
  messages: SkillBuilderMessage[];
}

/** 把 AI 文本里的 ```SKILL.md 代码块渲染成带边框的预览区，正文照常显示。 */
function renderContent(content: string): React.ReactNode {
  if (!content) return null;
  return content.split(/```/).map((seg, idx) => {
    // 奇数段为代码块（被 ``` 切分后交替），偶数段为普通文本
    if (idx % 2 === 1) {
      return (
        <pre
          key={idx}
          className="my-1 max-h-48 overflow-auto rounded-md border bg-muted/60 p-2 font-mono text-xs"
        >
          {seg.replace(CODE_FENCE_LABEL_RE, '')}
        </pre>
      );
    }
    return (
      <span key={idx} className="whitespace-pre-wrap">
        {seg}
      </span>
    );
  });
}

export function SkillBuilderMessageList({ messages }: SkillBuilderMessageListProps) {
  if (messages.length === 0) {
    return (
      <div className="flex h-full items-center justify-center px-4 text-center text-sm text-muted-foreground">
        还没有对话。<br />在下方描述你想要的技能，AI 会生成 SKILL.md。
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {messages.map((m) => {
        const isUser = m.role === 'user';
        if (m.status === 'error') {
          return (
            <div
              key={m.id}
              className="rounded-md border border-destructive/50 bg-destructive/10 p-2.5 text-sm text-destructive"
            >
              {m.content || 'AI 生成失败，请重试或调整后重发。'}
            </div>
          );
        }
        return (
          <div key={m.id} className={cn('flex', isUser ? 'justify-end' : 'justify-start')}>
            <div
              className={cn(
                'max-w-[88%] rounded-lg px-3 py-2 text-sm',
                isUser
                  ? 'bg-primary text-primary-foreground'
                  : 'border bg-card text-card-foreground',
              )}
            >
              {m.status === 'generating' ? (
                <span className="inline-flex items-center gap-1 text-muted-foreground">
                  <span className="animate-pulse">生成中…</span>
                </span>
              ) : (
                <>
                  {renderContent(m.content)}
                  {!isUser && m.converged ? (
                    <p className="mt-1.5 text-xs text-emerald-600">
                      ✓ SKILL.md 已完整生成，可点「回填」写入表单。
                    </p>
                  ) : null}
                </>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
