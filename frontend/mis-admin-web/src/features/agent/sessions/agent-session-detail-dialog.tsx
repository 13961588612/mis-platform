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
import { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { AgentContentState } from '../components/agent-page-shell';
import { AgentMessageStream } from '../components/agent-message-stream';
import {
  batchSessionTiming,
  getSession,
  getSessionTiming,
  listSessionMessages,
} from '../api/agent-ops-api';
import { agentErrorMessage, formatTime } from '../types';
import type { Session, SessionMessage, SessionTimingMap } from '../types';

/** 渠道枚举 → 中文（与列表页共用同一份口径）。 */
const CHANNEL_LABELS: Record<Session['channel'], string> = {
  web: '网页',
  wecom: '企业微信',
  api: 'API',
  iqd_test: '问数测试',
  kb_test: '问答测试',
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

type TimingStatus = 'loaded' | 'expired' | 'never' | 'mismatch';

function resolveTimingStatus(
  timingResult: PromiseSettledResult<Awaited<ReturnType<typeof getSessionTiming>>>,
  turns: SessionTimingMap | null,
  messages: SessionMessage[],
): TimingStatus {
  if (timingResult.status === 'rejected') return 'never';
  const payload = timingResult.value;
  // API 契约：null = Redis 键不存在/已过期；空 turns = 从未写入有效轮次
  if (payload === null) return 'expired';
  if (!turns || Object.keys(turns).length === 0) return 'never';
  const assistantIds = new Set(
    messages.filter((m) => m.role === 'assistant').map((m) => m.id),
  );
  const hit = Object.keys(turns).some((k) => assistantIds.has(k));
  return hit ? 'loaded' : 'mismatch';
}

const TIMING_STATUS_LABEL: Record<TimingStatus, string> = {
  loaded: '按轮耗时已加载',
  // Redis 无键：可能从未写入，也可能已过 24h；无法区分时用中性文案
  expired: '暂无采样（未写入或已过 24h）',
  never: '本会话暂无耗时采样',
  mismatch: '有耗时采样，但与消息 id 未对齐',
};

export function AgentSessionDetailDialog({
  open,
  onOpenChange,
  sessionId,
  fallbackSession = null,
}: AgentSessionDetailDialogProps) {
  /** 抽屉内可跳到父/Worker 会话，不关 Sheet。 */
  const [activeId, setActiveId] = useState(sessionId);
  const [session, setSession] = useState<Session | null>(null);
  const [messages, setMessages] = useState<SessionMessage[]>([]);
  const [timing, setTiming] = useState<SessionTimingMap | null>(null);
  const [timingStatus, setTimingStatus] = useState<TimingStatus>('never');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) setActiveId(sessionId);
  }, [open, sessionId]);

  const load = useCallback(async () => {
    if (!activeId) return;
    setLoading(true);
    setError(null);
    try {
      const [metaResult, msgResult, timingResult] = await Promise.allSettled([
        getSession(activeId),
        listSessionMessages(activeId),
        getSessionTiming(activeId),
      ]);
      if (msgResult.status === 'rejected') throw msgResult.reason;
      const msgs = msgResult.value;
      setMessages(msgs);
      const meta = metaResult.status === 'fulfilled' ? metaResult.value : null;
      setSession(meta);

      let turns: SessionTimingMap =
        timingResult.status === 'fulfilled' ? { ...(timingResult.value?.turns ?? {}) } : {};

      // 尽力合并绑定 Worker 子会话的按轮耗时（key 仍是各子会话 message.id）
      const workerIds = (meta?.worker_sessions ?? [])
        .map((w) => w.session_id)
        .filter(Boolean);
      if (workerIds.length > 0) {
        try {
          const batch = await batchSessionTiming(workerIds);
          for (const payload of Object.values(batch)) {
            if (!payload?.turns) continue;
            Object.assign(turns, payload.turns);
          }
        } catch {
          // Worker 耗时合并失败不影响主回放
        }
      }

      const turnMap = Object.keys(turns).length > 0 ? turns : null;
      setTiming(turnMap);
      setTimingStatus(resolveTimingStatus(timingResult, turnMap, msgs));
    } catch (e) {
      setMessages([]);
      setError(agentErrorMessage(e, '获取会话消息失败'));
    } finally {
      setLoading(false);
    }
  }, [activeId]);

  useEffect(() => {
    if (!open) return;
    setSession(null);
    setMessages([]);
    setTiming(null);
    setTimingStatus('never');
    void load();
  }, [open, load]);

  const shown = useMemo(() => {
    if (session) return session;
    if (fallbackSession && fallbackSession.session_id === activeId) return fallbackSession;
    return null;
  }, [session, fallbackSession, activeId]);

  const parentId = shown?.parent_session_id?.trim() || '';
  const workers = shown?.worker_sessions ?? [];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-[min(46rem,96vw)] max-w-none flex-col gap-0 overflow-hidden p-0">
        <SheetHeader className="border-b p-4">
          <SheetTitle className="truncate pr-8">
            {shown?.title || '会话详情'}
          </SheetTitle>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span className="font-mono">{activeId}</span>
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
            <span className={timingStatus === 'loaded' ? 'text-success' : undefined}>
              {TIMING_STATUS_LABEL[timingStatus]}
            </span>
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
          {parentId || workers.length > 0 ? (
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
              {parentId ? (
                <Button
                  size="sm"
                  variant="secondary"
                  className="h-7"
                  onClick={() => setActiveId(parentId)}
                >
                  打开父会话
                  <span className="ml-1 font-mono text-[0.65rem] opacity-80">
                    {parentId.length > 18 ? `${parentId.slice(0, 18)}…` : parentId}
                  </span>
                </Button>
              ) : null}
              {workers.map((w) => (
                <Button
                  key={w.session_id}
                  size="sm"
                  variant="outline"
                  className="h-7"
                  onClick={() => setActiveId(w.session_id)}
                  title={w.session_id}
                >
                  Worker {w.worker_id}
                </Button>
              ))}
              {activeId !== sessionId ? (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7"
                  onClick={() => setActiveId(sessionId)}
                >
                  回到列表所选
                </Button>
              ) : null}
            </div>
          ) : null}
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
