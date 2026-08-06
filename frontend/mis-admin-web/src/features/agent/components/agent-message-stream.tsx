/**
 * 只读消息流渲染（会话详情 UI#4 与本地对话 UI#6 共用）。
 *
 * <p>**为什么抽成共享组件**：`sessions/agent-session-detail-dialog.tsx`（#29 回放）
 * 与 `chat/chat-shell.tsx`（#33 实时）要渲染的是**同一种东西** —— 带 role 分色的消息气泡
 * + tool 消息的 `meta` 展开。各写一份的必然结局是两处的 role 配色慢慢分叉，
 * 而"同一条 assistant 消息在回放页是蓝的、在对话页是灰的"这种不一致，
 * 比没有配色更让运营困惑。
 *
 * <p>本组件在 `features/agent` 内部共享，不跨 feature，不触发 `arch/no-cross-feature`。
 * 它**刻意不做**：Markdown 渲染、流式打字机、消息编辑 —— 那些是业务 Copilot
 * （`features/ai`）的职责，运营台只需要"看清楚发生了什么"。
 */
import type { ReactNode } from 'react';
import { Bot, Terminal, User, Wrench } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatTime } from '../types';
import type { MessageRole, SessionMessage } from '../types';

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

const FALLBACK_SPEC: RoleSpec = {
  label: '未知',
  icon: Terminal,
  bubble: 'border-border bg-card',
  chip: 'bg-muted text-muted-foreground',
};

/**
 * 从 tool 消息的 `meta` 里取工具名。
 *
 * <p>`meta` 是 `Record<string, unknown>`（形状由下游决定），这里只做保守探测：
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
 * 入参摘要：把 `meta` 里除工具名以外的字段压成一行 JSON。
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

/** 完整 meta 的美化 JSON（展开区用）。 */
function prettyMeta(meta: Record<string, unknown>): string {
  try {
    return JSON.stringify(meta, null, 2);
  } catch {
    return String(meta);
  }
}

export interface AgentMessageStreamProps {
  messages: SessionMessage[];
  /** 空态文案。 */
  emptyText?: string;
  /** 挂在列表末尾的内容（如"正在生成…"指示器）。 */
  footer?: ReactNode;
  className?: string;
}

export function AgentMessageStream({
  messages,
  emptyText = '暂无消息',
  footer,
  className,
}: AgentMessageStreamProps) {
  if (messages.length === 0 && !footer) {
    return <p className="py-10 text-center text-sm text-muted-foreground">{emptyText}</p>;
  }

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      {messages.map((msg) => {
        const spec = ROLE_SPECS[msg.role] ?? FALLBACK_SPEC;
        const Icon = spec.icon;
        const isTool = msg.role === 'tool';
        const toolName = isTool ? toolNameOf(msg.meta) : '';
        const argsSummary = isTool ? argsSummaryOf(msg.meta) : '';

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
                {formatTime(msg.created_at)}
              </span>
            </div>

            {/* whitespace-pre-wrap：保留下游返回的换行与缩进，不做 Markdown 渲染 */}
            {msg.content ? (
              <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">
                {msg.content}
              </p>
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

            {msg.meta && Object.keys(msg.meta).length > 0 ? (
              <details className="mt-1.5">
                <summary className="cursor-pointer text-[0.7rem] text-muted-foreground hover:text-foreground">
                  查看完整 meta
                </summary>
                <pre className="mt-1 max-h-56 overflow-auto rounded-md border bg-card p-2 font-mono text-[0.7rem] leading-relaxed">
                  {prettyMeta(msg.meta)}
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
