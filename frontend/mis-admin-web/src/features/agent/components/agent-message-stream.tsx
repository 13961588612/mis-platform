/**
 * 只读消息流渲染（会话详情 UI#4 与本地对话 UI#6 共用）。
 *
 * <p>**为什么抽成共享组件**：`sessions/agent-session-detail-dialog.tsx`（#29 回放）
 * 与 `chat/chat-shell.tsx`（#33 实时）要渲染的是**同一种东西** —— 带 role 分色的消息气泡
 * + tool 消息的 `metadata` 展开。各写一份的必然结局是两处的 role 配色慢慢分叉，
 * 而"同一条 assistant 消息在回放页是蓝的、在对话页是灰的"这种不一致，
 * 比没有配色更让运营困惑。
 *
 * <p>本组件在 `features/agent` 内部共享，不跨 feature，不触发 `arch/no-cross-feature`。
 * 助手正文走公共 {@link MarkdownView}（与知识库问答同一组件，不 import `features/ai`）；
 * 用户 / 工具 / 系统消息仍按原文预格式化，便于排障看清原始输入与 tool 轨迹。
 * 不做流式打字机、消息编辑。
 */
import type { ReactElement, ReactNode } from 'react';
import { Bot, Terminal, ThumbsDown, ThumbsUp, User, Wrench } from 'lucide-react';
import { cn } from '@/lib/utils';
import { MarkdownView } from '@/components/common/markdown-view';
import { KbChatSourceList, splitKbSources } from '@/components/common/kb-chat-sources';
import { formatTime } from '../types';
import type { MessageRole, SessionMessage, SessionTiming } from '../types';

/** 每种 role 的呈现规格：标签 + 配色 + 图标。 */
interface RoleSpec {
  label: string;
  icon: typeof User;
  /** 气泡容器配色。 */
  bubble: string;
  /** 角色标签配色。 */
  chip: string;
}

const ROLE_SPECS: Record<MessageRole, RoleSpec> = {
  user: {
    label: '用户',
    icon: User,
    bubble: 'border-primary/30 bg-primary/5',
    chip: 'bg-primary/10 text-primary',
  },
  assistant: {
    label: '助手',
    icon: Bot,
    bubble: 'border-border bg-card',
    chip: 'bg-muted text-foreground',
  },
  tool: {
    label: '工具',
    icon: Wrench,
    bubble: 'border-info/30 bg-info/5',
    chip: 'bg-info/10 text-info',
  },
  system: {
    label: '系统',
    icon: Terminal,
    bubble: 'border-dashed border-border bg-muted/30',
    chip: 'bg-muted text-muted-foreground',
  },
};

function AssistantMarkdown({ content }: { content: string }) {
  const { body, sources } = splitKbSources(content);
  return (
    <>
      <MarkdownView content={body} />
      <KbChatSourceList sources={sources} />
    </>
  );
}

const FALLBACK_SPEC: RoleSpec = {
  label: '未知',
  icon: Terminal,
  bubble: 'border-border bg-card',
  chip: 'bg-muted text-muted-foreground',
};

/**
 * 从 tool 消息的 `metadata` 里取工具名。
 *
 * <p>`metadata` 是 `Record<string, unknown>`（形状由下游决定），这里只做保守探测：
 * 依次尝试常见键名，都没有就返回空串，绝不 `as any` 硬取。
 */
function toolNameOf(meta: Record<string, unknown> | undefined): string {
  if (!meta) return '';
  for (const key of ['tool', 'tool_name', 'name', 'function']) {
    const v = meta[key];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return '';
}

/**
 * 入参摘要：把 `metadata` 里除工具名以外的字段压成一行 JSON。
 *
 * <p>超过 240 字符就截断 —— 完整入参在 `<details>` 里可展开，
 * 摘要行的职责是让运营一眼看出"这次调用大概传了什么"。
 */
function argsSummaryOf(meta: Record<string, unknown> | undefined): string {
  if (!meta) return '';
  const source = (meta.arguments ?? meta.args ?? meta.input ?? meta.params) as unknown;
  const target = source !== undefined && source !== null ? source : meta;
  try {
    const text = JSON.stringify(target);
    if (!text || text === '{}') return '';
    return text.length > 240 ? `${text.slice(0, 240)}…` : text;
  } catch {
    return '';
  }
}

/** 完整 metadata 的美化 JSON（展开区用）。 */
function prettyMeta(meta: Record<string, unknown>): string {
  try {
    return JSON.stringify(meta, null, 2);
  } catch {
    return String(meta);
  }
}

/**
 * 消息级反馈徽标（CF-02）。
 *
 * <p>对 assistant 消息的 ``metadata.feedback``（``{rating, comment?, updated_at?}``）
 * 做结构化渲染，替代 metadata JSON 裸展开——运营在会话回放里能一眼看到
 * 「这条回答被点赞/吐槽了、说了什么」。JSON 仍保留在下方 `<details>` 兜底。
 *
 * <p>保守探测：`metadata.feedback` 不是对象或 `rating` 非法时静默返回 null，
 * 绝不让一个脏 metadata 把整条消息渲染搞崩。
 */
function FeedbackBadge({ meta }: { meta: Record<string, unknown> | undefined }) {
  const raw = meta?.feedback;
  if (!raw || typeof raw !== 'object') return null;
  const fb = raw as {
    rating?: unknown;
    comment?: unknown;
    status?: unknown;
    updated_at?: unknown;
  };
  const rating = fb.rating === 'up' || fb.rating === 'down' ? fb.rating : null;
  if (!rating) return null;
  const up = rating === 'up';
  const comment =
    typeof fb.comment === 'string' && fb.comment.trim() ? fb.comment.trim() : '';
  // 处理状态非消息契约字段；若未来 metadata.feedback 里带了就顺带展示，缺省不显示。
  const status = typeof fb.status === 'string' && fb.status.trim() ? fb.status.trim() : '';
  const updated = typeof fb.updated_at === 'string' ? fb.updated_at : '';
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 rounded-md border bg-muted/40 px-2.5 py-1.5 text-xs">
      <span
        className={cn(
          'inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium',
          up ? 'bg-success/10 text-success' : 'bg-destructive/10 text-destructive',
        )}
      >
        {up ? <ThumbsUp className="h-3 w-3" /> : <ThumbsDown className="h-3 w-3" />}
        {up ? '已点赞' : '已吐槽'}
      </span>
      {status ? <span className="text-muted-foreground">状态：{status}</span> : null}
      {comment ? (
        <span className="min-w-0 flex-1 break-words text-foreground/90">{comment}</span>
      ) : null}
      {updated ? (
        <span className="ml-auto text-muted-foreground/70">{formatTime(updated)}</span>
      ) : null}
    </div>
  );
}

export interface AgentMessageStreamProps {
  messages: SessionMessage[];
  /** 按轮耗时 map（key = assistant 消息 id）。2.1：逐条内联展示，缺失显示「—」。 */
  timingByMessageId?: Record<string, SessionTiming>;
  /** 空态文案。 */
  emptyText?: string;
  /** 挂在列表末尾的内容（如"正在生成…"指示器）。 */
  footer?: ReactNode;
  /** 会话回放时展示每条助手消息的对话编号（与反馈列表「对话编号」口径一致：会话内第 N 条助手消息）。 */
  showTurnIndex?: boolean;
  className?: string;
}

/** 毫秒 → 可读串（2.1 内联耗时）。null 表示阶段未发生，显示「—」。 */
function fmtMs(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return '—';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

/** 单阶段耗时单元格（2.1 内联）。 */
function InlineTimingCell({ label, ms }: { label: string; ms: number | null }): ReactElement {
  return (
    <span className="rounded bg-card px-1.5 py-0.5" title={`${label} ${fmtMs(ms)}`}>
      <span className="text-muted-foreground">{label}</span>
      <span className="ml-1 font-medium text-foreground">{fmtMs(ms)}</span>
    </span>
  );
}

export function AgentMessageStream({
  messages,
  timingByMessageId,
  emptyText = '暂无消息',
  footer,
  showTurnIndex = false,
  className,
}: AgentMessageStreamProps) {
  if (messages.length === 0 && !footer) {
    return <p className="py-10 text-center text-sm text-muted-foreground">{emptyText}</p>;
  }

  // 会话内助手消息的 1-based 顺序号（对话编号），与反馈列表 turn_index 口径一致。
  let assistantTurn = 0;

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      {messages.map((msg) => {
        const isAssistant = msg.role === 'assistant';
        const turnIndex = isAssistant ? (assistantTurn += 1) : undefined;
        const spec = ROLE_SPECS[msg.role] ?? FALLBACK_SPEC;
        const Icon = spec.icon;
        const isTool = msg.role === 'tool';
        const toolName = isTool ? toolNameOf(msg.metadata) : '';
        const argsSummary = isTool ? argsSummaryOf(msg.metadata) : '';
        // 2.1：assistant 消息按 message.id 在按轮 map 中查本轮耗时。
        const turn = msg.role === 'assistant' ? timingByMessageId?.[msg.id] : undefined;
        const turnMissing = msg.role === 'assistant' && !turn;

        return (
          <div key={msg.id} className={cn('rounded-lg border p-3', spec.bubble)}>
            <div className="mb-1.5 flex flex-wrap items-center gap-2">
              <span
                className={cn(
                  'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[0.7rem] font-medium',
                  spec.chip,
                )}
              >
                <Icon className="h-3 w-3" />
                {spec.label}
              </span>
              {toolName ? <span className="font-mono text-xs">{toolName}</span> : null}
              <span className="ml-auto text-[0.7rem] text-muted-foreground">
                {formatTime(msg.timestamp)}
              </span>
              {showTurnIndex && isAssistant && turnIndex != null ? (
                <span className="ml-2 inline-flex items-center gap-1 rounded-md bg-primary/10 px-1.5 py-0.5 text-[0.7rem] font-medium text-primary">
                  对话 #{turnIndex}
                </span>
              ) : null}
            </div>

            {turn ? (
              <div className="mb-2 flex flex-wrap items-center gap-1.5 rounded-md border bg-muted/40 px-2 py-1 text-[0.7rem]">
                <span className="text-muted-foreground">本轮耗时</span>
                <span className="font-medium text-foreground">{fmtMs(turn.total_ms)}</span>
                <span className="text-border">·</span>
                <InlineTimingCell label="规划" ms={turn.stages.planning_ms} />
                <InlineTimingCell label="检索" ms={turn.stages.retrieval_ms} />
                <InlineTimingCell label="工具" ms={turn.stages.tool_call_ms} />
                <InlineTimingCell label="生成" ms={turn.stages.generation_ms} />
                <InlineTimingCell label="后处理" ms={turn.stages.post_process_ms} />
                <span className="ml-auto text-muted-foreground">
                  采样 {formatTime(turn.sampled_at)}
                </span>
              </div>
            ) : null}
            {turnMissing ? (
              <div className="mb-2 text-[0.7rem] text-muted-foreground">本轮耗时：—</div>
            ) : null}

            {msg.content ? (
              msg.role === 'assistant' ? (
                <>
                  <AssistantMarkdown content={msg.content} />
                  {/* CF-02：assistant 消息的 feedback 结构化徽标（无反馈时渲染 null） */}
                  <FeedbackBadge meta={msg.metadata} />
                </>
              ) : (
                <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">
                  {msg.content}
                </p>
              )
            ) : (
              <p className="text-sm italic text-muted-foreground">（空消息体）</p>
            )}

            {/* tool 消息：先给一行入参摘要，完整 meta 收进 details 避免刷屏 */}
            {isTool && argsSummary ? (
              <p
                className="mt-1.5 truncate font-mono text-[0.7rem] text-muted-foreground"
                title={argsSummary}
              >
                入参：{argsSummary}
              </p>
            ) : null}

            {msg.metadata && Object.keys(msg.metadata).length > 0 ? (
              <details className="mt-1.5">
                <summary className="cursor-pointer text-[0.7rem] text-muted-foreground hover:text-foreground">
                  查看完整 metadata
                </summary>
                <pre className="mt-1 max-h-56 overflow-auto rounded-md border bg-card p-2 font-mono text-[0.7rem] leading-relaxed">
                  {prettyMeta(msg.metadata)}
                </pre>
              </details>
            ) : null}
          </div>
        );
      })}
      {footer}
    </div>
  );
}
