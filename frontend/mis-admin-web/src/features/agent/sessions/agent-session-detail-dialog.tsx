/**
 * 会话详情（UI#4 回放，§4.3 #28 会话元信息 / #29 消息列表，**两者后端均已就绪**）。
 *
 * <p>只读：本对话框**不提供**任何写操作。删除入口留在列表页 ——
 * 在"正在读某条会话内容"的上下文里放删除按钮，是误删的主要来源。
 *
 * <p>用 `ui/sheet`（右侧抽屉）而不是 `ui/dialog`：消息流是**纵向长内容**，
 * 抽屉能吃满视口高度、滚动手感更接近聊天记录；居中 Dialog 在长会话下
 * 会变成一个夹在上下留白之间的小窗口，读起来很别扭。
 *
 * <p>#28 与 #29 用 `Promise.allSettled` 并行拉取：**消息拉不到才算失败**，
 * 元信息（标题 / 渠道 / 用户）失败只让头部少几个字段，不该把整个回放拦掉。
 */
import { useCallback, useEffect, useState, type ReactElement } from 'react';
import { RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { AgentContentState } from '../components/agent-page-shell';
import { AgentMessageStream } from '../components/agent-message-stream';
import { getSession, getSessionTiming, listSessionMessages } from '../api/agent-ops-api';
import { agentErrorMessage, formatTime } from '../types';
import type { Session, SessionMessage, SessionTiming } from '../types';

/** 毫秒格式化：>=1s 显示秒，否则显示 ms；不可得（null）显示「—」。 */
function fmtMs(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return '—';
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)}s`;
  return `${ms}ms`;
}

/** 单阶段耗时单元格（A-5）。 */
function TimingCell({ label, ms }: { label: string; ms: number | null }): ReactElement {
  return (
    <div className="rounded bg-card px-2 py-1.5">
      <div className="text-[0.7rem] text-muted-foreground">{label}</div>
      <div className="font-medium text-foreground">{fmtMs(ms)}</div>
    </div>
  );
}

/** 渠道枚举 → 中文（与列表页共用同一份口径）。 */
const CHANNEL_LABELS: Record<Session['channel'], string> = {
  web: '网页',
  wecom: '企业微信',
  api: 'API',
  unknown: '未知',
};

export interface AgentSessionDetailDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 目标会话 id；空串时不拉取。 */
  sessionId: string;
  /** 列表页已有的会话行，用作元信息兜底（#28 失败时仍能显示标题/渠道）。 */
  fallbackSession?: Session | null;
}

export function AgentSessionDetailDialog({
  open,
  onOpenChange,
  sessionId,
  fallbackSession = null,
}: AgentSessionDetailDialogProps) {
  const [session, setSession] = useState<Session | null>(null);
  const [messages, setMessages] = useState<SessionMessage[]>([]);
  const [timing, setTiming] = useState<SessionTiming | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!sessionId) return;
    setLoading(true);
    setError(null);
    try {
      const [metaResult, msgResult, timingResult] = await Promise.allSettled([
        getSession(sessionId),
        listSessionMessages(sessionId),
        getSessionTiming(sessionId),
      ]);
      // 消息是主体：拿不到才算整体失败
      if (msgResult.status === 'rejected') throw msgResult.reason;
      setMessages(msgResult.value);
      setSession(metaResult.status === 'fulfilled' ? metaResult.value : null);
      // 耗时为调试态（Redis，TTL 24h）：过期 / 未采样 = null，不影响回放
      setTiming(timingResult.status === 'fulfilled' ? timingResult.value : null);
    } catch (e) {
      setMessages([]);
      setError(agentErrorMessage(e, '获取会话消息失败'));
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  // 每次打开都重新拉：会话内容可能在列表停留期间已变化
  useEffect(() => {
    if (!open) return;
    setSession(null);
    setMessages([]);
    setTiming(null);
    void load();
  }, [open, load]);

  const shown = session ?? fallbackSession;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-[min(46rem,96vw)] max-w-none flex-col gap-0 p-0">
        <SheetHeader className="border-b p-4">
          <SheetTitle className="truncate pr-8">
            {shown?.title || '会话详情'}
          </SheetTitle>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span className="font-mono">{sessionId}</span>
            {shown ? (
              <>
                <span>渠道：{CHANNEL_LABELS[shown.channel] ?? shown.channel}</span>
                <span>Agent：{shown.agent_name || shown.agent_id}</span>
                {shown.user_name || shown.user_id ? (
                  <span>用户：{shown.user_name || shown.user_id}</span>
                ) : null}
                <span>创建：{formatTime(shown.created_at)}</span>
                <span>更新：{formatTime(shown.updated_at)}</span>
              </>
            ) : null}
            <span>共 {messages.length} 条消息</span>
            <Button
              size="sm"
              variant="ghost"
              className="ml-auto h-6"
              onClick={() => void load()}
              disabled={loading}
            >
              <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
              刷新
            </Button>
          </div>
        </SheetHeader>

        <div className="min-h-0 flex-1 overflow-auto p-4">
          {timing ? (
            <div className="mb-3 rounded-md border bg-muted/40 p-3 text-xs">
              <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium text-foreground">
                  本轮耗时（端到端 {fmtMs(timing.total_ms)}）
                </span>
                <span className="text-muted-foreground">采样：{formatTime(timing.sampled_at)}</span>
              </div>
              <div className="grid grid-cols-5 gap-2">
                <TimingCell label="规划" ms={timing.stages.planning_ms} />
                <TimingCell label="检索" ms={timing.stages.retrieval_ms} />
                <TimingCell label="工具" ms={timing.stages.tool_call_ms} />
                <TimingCell label="生成" ms={timing.stages.generation_ms} />
                <TimingCell label="后处理" ms={timing.stages.post_process_ms} />
              </div>
            </div>
          ) : (
            <div className="mb-3 rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground">
              耗时数据已过期（调试窗口 24h）
            </div>
          )}
          <AgentContentState
            loading={loading && messages.length === 0}
            error={error}
            onRetry={() => void load()}
            empty={!loading && !error && messages.length === 0}
            emptyText="该会话没有消息"
            emptyHint="会话可能刚创建，或消息已被清理。"
          >
            <AgentMessageStream messages={messages} />
          </AgentContentState>
        </div>
      </SheetContent>
    </Sheet>
  );
}
