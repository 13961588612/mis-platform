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
import { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { AgentContentState } from '../components/agent-page-shell';
import { AgentMessageStream } from '../components/agent-message-stream';
import { getSession, getSessionTiming, listSessionMessages } from '../api/agent-ops-api';
import { agentErrorMessage, formatTime } from '../types';
import type { Session, SessionMessage, SessionTimingMap } from '../types';

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
  const [timing, setTiming] = useState<SessionTimingMap | null>(null);
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
      // 耗时为调试态（Redis，TTL 24h）：过期 / 未采样 = null，不影响回放。
      // 2.1：返回的是按轮 map，前端按 message.id 逐条内联展示。
      setTiming(timingResult.status === 'fulfilled' ? timingResult.value?.turns ?? null : null);
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
  // 是否有任意一轮耗时可用（用于头部提示）
  const hasTiming = timing != null && Object.keys(timing).length > 0;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-[min(46rem,96vw)] max-w-none flex-col gap-0 overflow-hidden p-0">
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
            {hasTiming ? (
              <span className="text-success">按轮耗时已加载</span>
            ) : (
              <span>耗时已过期（调试窗口 24h）</span>
            )}
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

        <div className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto p-4">
          <AgentContentState
            loading={loading && messages.length === 0}
            error={error}
            onRetry={() => void load()}
            empty={!loading && !error && messages.length === 0}
            emptyText="该会话没有消息"
            emptyHint="会话可能刚创建，或消息已被清理。"
          >
            <AgentMessageStream
              className="min-w-0"
              messages={messages}
              timingByMessageId={timing ?? undefined}
              showTurnIndex
            />
          </AgentContentState>
        </div>
      </SheetContent>
    </Sheet>
  );
}
