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
import { useState } from 'react';
import { Bot, Terminal, ThumbsDown, ThumbsUp, User, Wrench } from 'lucide-react';
import { cn } from '@/lib/utils';
import { MarkdownView } from '@/components/common/markdown-view';
import { KbChatSourceFigures, KbChatSourceList, splitKbSources } from '@/components/common/kb-chat-sources';
import { formatTime } from '../types';
import type {
  MessageRole,
  SessionMessage,
  SessionTiming,
  SubStageMap,
  SubStages,
  ToolCallSubStage,
} from '../types';

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
      <KbChatSourceFigures sources={sources} />
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

/** 单阶段耗时单元格（2.1 内联）。可点击展开子阶段下钻。 */
function InlineTimingCell({
  label,
  ms,
  warn,
  onClick,
  expanded,
}: {
  label: string;
  ms: number | null;
  warn?: boolean;
  onClick?: () => void;
  expanded?: boolean;
}): ReactElement {
  const clickable = Boolean(onClick);
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!clickable}
      title={`${label} ${fmtMs(ms)}${warn ? '（子阶段之和与父阶段偏差>5%）' : ''}`}
      className={cn(
        'inline-flex items-center rounded px-1.5 py-0.5 transition-colors',
        clickable ? 'cursor-pointer hover:bg-muted' : 'cursor-default',
        warn ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-200' : 'bg-card',
      )}
    >
      <span className={warn ? 'font-medium' : 'text-muted-foreground'}>{label}</span>
      <span className="ml-1 font-medium text-foreground">
        {fmtMs(ms)}
        {warn ? ' ⚠' : ''}
      </span>
      {clickable ? <span className="ml-0.5 text-[0.6rem] opacity-60">{expanded ? '▾' : '▸'}</span> : null}
    </button>
  );
}

/**
 * 子阶段之和与父阶段聚合值偏差 > 5% 时返回 true（触发父 cell 标黄）。
 * 各父阶段参与严格求和的子段口径不同，故分类型处理：
 * - tool_call：Σ calls[].latency_ms 应 = tool_call_ms
 * - generation：仅 stream_ms 严格 = generation_ms（ttft/tail 为辅助指标，不参与）
 * - 其余（planning/retrieval/post_process）：求和 map 内全部数值字段
 */
function deviationWarn(stageKey: string, sub: unknown, parentMs: number | null): boolean {
  if (!sub || parentMs == null || parentMs <= 0) return false;
  let sum: number | null = null;
  if (stageKey === 'tool_call') {
    const tcs = sub as ToolCallSubStage;
    if (!tcs.calls || tcs.calls.length === 0) return false;
    sum = tcs.calls.reduce(
      (s, c) => s + (typeof c.latency_ms === 'number' ? c.latency_ms : 0),
      0,
    );
  } else if (stageKey === 'generation') {
    const g = sub as SubStageMap;
    const stream = typeof g?.stream_ms === 'number' ? g.stream_ms : null;
    if (stream == null) return false;
    sum = stream;
  } else {
    const m = sub as SubStageMap;
    const vals = Object.values(m ?? {}).filter((v): v is number => typeof v === 'number');
    if (vals.length === 0) return false;
    sum = vals.reduce((s, v) => s + v, 0);
  }
  if (sum == null || sum <= 0) return false;
  return Math.abs(sum - parentMs) / parentMs > 0.05;
}

/** 渲染一组子阶段明细行（key → value，null 显示「—」）。 */
function SubStageRows({ map }: { map: SubStageMap | null | undefined }): ReactElement | null {
  if (!map) return null;
  const entries = Object.entries(map).filter(([, v]) => v !== undefined);
  if (entries.length === 0) return null;
  return (
    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 pl-3 text-[0.65rem] text-muted-foreground">
      {entries.map(([key, value]) => (
        <span key={key} className="whitespace-nowrap">
          <span className="opacity-80">{key.replace(/_ms$/, '')}</span>
          <span className="ml-1 font-medium text-foreground">{fmtMs(value as number | null)}</span>
        </span>
      ))}
    </div>
  );
}

/** 工具调用数组下钻（每次调用：tool_name / kind / latency + 其内部 sub_stages）。 */
function ToolCallDrill({ tcs }: { tcs: ToolCallSubStage }): ReactElement {
  return (
    <div className="mt-1 flex flex-col gap-1 pl-3">
      {tcs.calls.map((call, idx) => (
        <div key={`${call.tool_name}-${idx}`} className="text-[0.65rem]">
          <span className="whitespace-nowrap text-muted-foreground">
            <span className="font-medium text-foreground">{call.tool_name}</span>
            <span className="ml-1 rounded bg-muted px-1 py-0.5 text-[0.6rem]">{call.kind}</span>
            <span className="ml-1 font-medium text-foreground">{fmtMs(call.latency_ms)}</span>
          </span>
          {call.sub_stages ? <SubStageRows map={call.sub_stages} /> : null}
        </div>
      ))}
      {typeof tcs.delegate_round_trip_ms === 'number' ? (
        <div className="whitespace-nowrap text-[0.65rem] text-muted-foreground">
          <span className="opacity-80">delegate_round_trip</span>
          <span className="ml-1 font-medium text-foreground">{fmtMs(tcs.delegate_round_trip_ms)}</span>
        </div>
      ) : null}
    </div>
  );
}

/**
 * 单轮耗时条 + 可折叠子阶段下钻（P1）。顶层 5 阶段保持不变，点击某阶段可展开其
 * 子阶段明细；并提供「展开全部耗时明细」开关（默认折叠）。
 */
function TimingBlock({ turn }: { turn: SessionTiming }): ReactElement {
  const [expandAll, setExpandAll] = useState(false);
  const [open, setOpen] = useState<Record<string, boolean>>({});

  const stages = turn.stages;
  const sub = turn.sub_stages;
  const hasSub = sub != null;

  const items: {
    key: keyof NonNullable<SubStages>;
    label: string;
    ms: number | null;
    sub?: unknown;
  }[] = [
    { key: 'planning', label: '规划', ms: stages.planning_ms, sub: sub?.planning },
    { key: 'retrieval', label: '检索', ms: stages.retrieval_ms, sub: sub?.retrieval },
    { key: 'tool_call', label: '工具', ms: stages.tool_call_ms, sub: sub?.tool_call },
    { key: 'generation', label: '生成', ms: stages.generation_ms, sub: sub?.generation },
    { key: 'post_process', label: '后处理', ms: stages.post_process_ms, sub: sub?.post_process },
  ];

  return (
    <div className="mb-2 rounded-md border bg-muted/40 px-2 py-1 text-[0.7rem]">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-muted-foreground">本轮耗时</span>
        <span className="font-medium text-foreground">{fmtMs(turn.total_ms)}</span>
        <span className="text-border">·</span>
        {items.map((it) => {
          const hasDrill = it.sub != null;
          const isOpen = expandAll || open[it.key];
          return (
            <InlineTimingCell
              key={it.key}
              label={it.label}
              ms={it.ms}
              warn={hasDrill ? deviationWarn(it.key, it.sub, it.ms) : false}
              onClick={hasDrill ? () => setOpen((p) => ({ ...p, [it.key]: !p[it.key] })) : undefined}
              expanded={isOpen}
            />
          );
        })}
        {hasSub ? (
          <button
            type="button"
            onClick={() => setExpandAll((v) => !v)}
            className="ml-auto rounded bg-muted px-1.5 py-0.5 text-[0.65rem] text-muted-foreground hover:bg-border/60"
            title="展开 / 折叠全部子阶段明细"
          >
            {expandAll ? '折叠明细' : '展开明细'}
          </button>
        ) : null}
        {!hasSub ? (
          <span className="ml-auto text-[0.65rem] text-muted-foreground">
            采样 {formatTime(turn.sampled_at)}
          </span>
        ) : null}
      </div>

      {hasSub && expandAll
        ? items.map((it) =>
            it.sub != null ? (
              <div key={`${it.key}-drill`} className="mt-1 border-l border-border pl-1">
                <SubStageDrillForStage stageKey={it.key} sub={it.sub} />
              </div>
            ) : null,
          )
        : null}
      {hasSub && !expandAll
        ? items.map((it) =>
            open[it.key] && it.sub != null ? (
              <div key={`${it.key}-drill`} className="mt-1 border-l border-border pl-1">
                <SubStageDrillForStage stageKey={it.key} sub={it.sub} />
              </div>
            ) : null,
          )
        : null}
      {hasSub ? (
        <div className="mt-1 text-right text-[0.65rem] text-muted-foreground">
          采样 {formatTime(turn.sampled_at)}
        </div>
      ) : null}
    </div>
  );
}

/** 按父阶段类型渲染对应的子阶段下钻内容。 */
function SubStageDrillForStage({
  stageKey,
  sub,
}: {
  stageKey: string;
  sub: unknown;
}): ReactElement | null {
  if (stageKey === 'tool_call') {
    return <ToolCallDrill tcs={sub as ToolCallSubStage} />;
  }
  return <SubStageRows map={sub as SubStageMap | null} />;
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
          <div key={msg.id} className={cn('min-w-0 overflow-hidden rounded-lg border p-3', spec.bubble)}>
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
              <TimingBlock turn={turn} />
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
                <pre className="mt-1 max-h-56 max-w-full overflow-auto whitespace-pre-wrap break-words rounded-md border bg-card p-2 font-mono text-[0.7rem] leading-relaxed">
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
