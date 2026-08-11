import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import {
  Check,
  Copy,
  History,
  Loader2,
  RefreshCw,
  RotateCcw,
  Send,
  Sparkles,
  Square,
  TriangleAlert,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { PageHeader } from '@/components/common/page-header';
import { buildAppBreadcrumbs } from '@/components/common/app-breadcrumbs';
import { MarkdownView } from '@/components/common/markdown-view';
import { useAiStore } from '@/stores/ai-store';
import { KbCitationList } from '../components/kb-citation-list';
import { KbFeedbackFormPanel } from '../components/kb-feedback-form';
import { KbLibraryCombobox } from '../components/kb-library-combobox';
import { KbTicketDialog } from '../components/kb-ticket-dialog';
import { askKbRag, askKbRagStream, getSessionDetail, listMySessions } from '../api/kb-api';
import type { KbQaCitation, KbQaSession } from '../types';
import { formatTime } from '../types';

/** 单轮问答（提问 + 回答 + 引用 + 归属会话 + 落库消息 ID）。 */
interface TurnItem {
  /** 本地稳定 key：会话/消息 ID 在流结束前都为空，不能用作 key。 */
  key: string;
  question: string;
  answer: string;
  citations: KbQaCitation[];
  sessionId: number | null;
  /** 助手消息 ID（F-10 建单需要）；未落库为 null。 */
  messageId: number | null;
  /** 是否仍在流式输出中。 */
  streaming: boolean;
  /** 本轮的检索范围快照，重新生成时原样复用。 */
  libraryIds: number[] | undefined;
}

let turnSeq = 0;

/** 生成本地稳定 key。 */
function nextTurnKey(): string {
  turnSeq += 1;
  return `turn-${Date.now()}-${turnSeq}`;
}

/**
 * 知识问答页（UC-4 主入口，F-01 流式）。
 *
 * <p>链路：前端 → BFF `/api/v1/ai/rag`（stream=true）→ ai-platform(mis-rag) → mis-kb 检索 + 落库。
 * 服务端在**流结束时一次性落库**（非逐 token），所以 `sessionId` / `messageId` 只会在
 * `done` 帧到达后才有值——流中途的「复制」可用，「报告问题」要等落库完成才可用。
 *
 * <p>降级：SSE 在**一个字都没吐出来**之前失败时自动回落非流式 `askKbRag` 重试一次。
 * 已吐出部分内容后再断流不重试——重试会让用户看到答案被清空重来，体验比截断更差。
 *
 * <p>能力门禁读取全局 `useAiStore`（AIProvider 在应用根加载 /ai/features 后写入），
 * 不直接依赖 features/ai 内部模块——遵守「禁止跨 features 直接依赖」的架构军规。
 */
export function KbQaPage() {
  const location = useLocation();
  const [question, setQuestion] = useState('');
  const [libraryId, setLibraryId] = useState<number | null>(null);
  const [turns, setTurns] = useState<TurnItem[]>([]);
  const [asking, setAsking] = useState(false);
  const [askError, setAskError] = useState<string | null>(null);
  const [sessions, setSessions] = useState<KbQaSession[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [activeSessionId, setActiveSessionId] = useState<number | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [ticketTarget, setTicketTarget] = useState<TurnItem | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const featuresLoaded = useAiStore((s) => s.featuresLoaded);
  const enabledFeatures = useAiStore((s) => s.enabledFeatures);
  const aiHealth = useAiStore((s) => s.health);
  // fail-closed：/ai/features 未加载完成前不判定为不可用，加载后按 rag-qa 是否启用裁定
  const ragUnavailable = featuresLoaded && !enabledFeatures.includes('rag-qa');

  const loadSessions = useCallback(async () => {
    setHistoryLoading(true);
    try {
      setSessions(await listMySessions());
    } catch {
      // 历史加载失败不阻断问答主流程
      setSessions([]);
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSessions();
  }, [loadSessions]);

  // 组件卸载时中断在途流，避免 setState on unmounted
  useEffect(
    () => () => {
      abortRef.current?.abort();
      abortRef.current = null;
    },
    [],
  );

  // 新增回答后滚动到底部（流式期间随内容增长持续贴底）
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns, asking]);

  /** 按 key 局部更新某一轮，避免整表替换导致输入态抖动。 */
  const patchTurn = useCallback((key: string, patch: Partial<TurnItem>) => {
    setTurns((prev) => prev.map((t) => (t.key === key ? { ...t, ...patch } : t)));
  }, []);

  /**
   * 执行一轮问答（新提问或重新生成共用）。
   *
   * @param q          问题文本
   * @param turnKey    目标轮次 key（重新生成时复用已有轮次）
   * @param libraryIds 检索范围
   * @param sessionId  续聊会话 ID
   */
  const runAsk = useCallback(
    async (
      q: string,
      turnKey: string,
      libraryIds: number[] | undefined,
      sessionId: number | null,
    ): Promise<void> => {
      const controller = new AbortController();
      abortRef.current = controller;
      setAsking(true);
      setAskError(null);

      let received = false;

      const finish = (result: {
        answer: string;
        sessionId: number | null;
        messageId: number | null;
        citations: KbQaCitation[];
      }): void => {
        patchTurn(turnKey, {
          answer: result.answer,
          citations: result.citations,
          sessionId: result.sessionId,
          messageId: result.messageId,
          streaming: false,
        });
        if (result.sessionId != null) setActiveSessionId(result.sessionId);
        void loadSessions();
      };

      /** 非流式回落：仅在「一个 delta 都没收到」时使用。 */
      const fallback = async (reason: string): Promise<void> => {
        try {
          const result = await askKbRag({
            question: q,
            libraryIds,
            context: { route: location.pathname, module: 'kb' },
            sessionId,
          });
          finish(result);
        } catch (e) {
          const msg = e instanceof Error ? e.message : reason;
          setAskError(msg);
          patchTurn(turnKey, { streaming: false });
          toast.error(`问答失败：${msg}`);
        }
      };

      try {
        await askKbRagStream(
          {
            question: q,
            libraryIds,
            context: { route: location.pathname, module: 'kb' },
            sessionId,
          },
          {
            onDelta: (text) => {
              received = true;
              setTurns((prev) =>
                prev.map((t) => (t.key === turnKey ? { ...t, answer: t.answer + text } : t)),
              );
            },
            onDone: (result) => {
              // 流式已把正文逐块渲染过；done 帧的 answer 为服务端拼装的最终稿，以它为准
              finish(result);
            },
            onError: (message) => {
              if (received) {
                // 已有部分内容：保留已渲染文本，仅提示中断
                patchTurn(turnKey, { streaming: false });
                setAskError(message);
                toast.warning(`回答中断：${message}`);
                return;
              }
              void fallback(message);
            },
          },
          controller.signal,
        );
      } finally {
        abortRef.current = null;
        setAsking(false);
      }
    },
    [location.pathname, loadSessions, patchTurn],
  );

  async function onAsk(): Promise<void> {
    const q = question.trim();
    if (!q || asking) return;
    setQuestion('');
    const libraryIds = libraryId == null ? undefined : [libraryId];
    const key = nextTurnKey();
    setTurns((prev) => [
      ...prev,
      {
        key,
        question: q,
        answer: '',
        citations: [],
        sessionId: null,
        messageId: null,
        streaming: true,
        libraryIds,
      },
    ]);
    await runAsk(q, key, libraryIds, activeSessionId);
  }

  /** 重新生成：清空该轮答案后按原问题、原检索范围重跑（F-08）。 */
  async function onRegenerate(turn: TurnItem): Promise<void> {
    if (asking) return;
    patchTurn(turn.key, { answer: '', citations: [], messageId: null, streaming: true });
    await runAsk(turn.question, turn.key, turn.libraryIds, turn.sessionId ?? activeSessionId);
  }

  /** 复制回答正文到剪贴板（F-08）。 */
  async function onCopy(turn: TurnItem): Promise<void> {
    if (!turn.answer) {
      toast.warning('暂无可复制的内容');
      return;
    }
    try {
      await navigator.clipboard.writeText(turn.answer);
      setCopiedKey(turn.key);
      window.setTimeout(() => setCopiedKey((k) => (k === turn.key ? null : k)), 1500);
    } catch {
      toast.error('复制失败：浏览器拒绝了剪贴板访问');
    }
  }

  /** 手动中断当前流。 */
  function onStop(): void {
    abortRef.current?.abort();
  }

  /** 回看历史会话：拉取详情并回填到对话区。 */
  async function onOpenSession(session: KbQaSession): Promise<void> {
    try {
      const detail = await getSessionDetail(session.id);
      const messages = detail.messages ?? [];
      const restored: TurnItem[] = [];
      let pendingQuestion = '';
      for (const m of messages) {
        if (m.role === 'user') {
          pendingQuestion = m.content;
        } else {
          restored.push({
            key: nextTurnKey(),
            question: pendingQuestion,
            answer: m.content,
            citations: m.citations ?? [],
            sessionId: session.id,
            messageId: m.id,
            streaming: false,
            libraryIds: undefined,
          });
          pendingQuestion = '';
        }
      }
      // 末尾若为未回答的提问，保留空回答条目，避免上下文丢失
      if (pendingQuestion) {
        restored.push({
          key: nextTurnKey(),
          question: pendingQuestion,
          answer: '',
          citations: [],
          sessionId: session.id,
          messageId: null,
          streaming: false,
          libraryIds: undefined,
        });
      }
      setTurns(restored);
      setAskError(null);
      setActiveSessionId(session.id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '加载会话详情失败');
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title="知识问答"
        description="基于可见知识库的检索增强问答；回答流式输出并附带引用来源，可提交质量反馈或报告问题。"
        breadcrumbs={buildAppBreadcrumbs({ app: 'kb', title: '智能问答' })}
        actions={
          <Button
            size="sm"
            variant="outline"
            disabled={historyLoading}
            onClick={() => void loadSessions()}
          >
            <RefreshCw className="h-4 w-4" />
            刷新历史
          </Button>
        }
      />

      <div className="flex min-h-0 flex-1 gap-3">
        {/* 左侧：历史会话 */}
        <aside className="flex w-64 shrink-0 flex-col overflow-hidden rounded-lg border bg-card">
          <div className="flex items-center gap-2 border-b px-3 py-2 text-sm font-medium">
            <History className="h-4 w-4" />
            我的问答历史
          </div>
          <div className="min-h-0 flex-1 overflow-auto p-2">
            {historyLoading ? (
              <p className="p-2 text-sm text-muted-foreground">加载中…</p>
            ) : sessions.length === 0 ? (
              <p className="p-2 text-sm text-muted-foreground">暂无历史会话</p>
            ) : (
              sessions.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className={cn(
                    'mb-0.5 w-full truncate rounded-md px-2 py-1.5 text-left text-sm',
                    activeSessionId === s.id
                      ? 'bg-primary/10 font-medium text-primary'
                      : 'hover:bg-accent',
                  )}
                  onClick={() => void onOpenSession(s)}
                >
                  会话 #{s.id}
                  <span className="ml-1 text-xs text-muted-foreground">
                    {formatTime(s.createdAt)}
                  </span>
                </button>
              ))
            )}
          </div>
        </aside>

        {/* 右侧：对话区 */}
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-lg border bg-card">
          <div className="flex min-w-0 items-center gap-2 border-b px-3 py-2">
            <Sparkles className="h-4 w-4 shrink-0 text-primary" />
            <span className="shrink-0 text-sm font-medium">检索范围</span>
            <div className="min-w-0 flex-1">
              <KbLibraryCombobox
                value={libraryId}
                onChange={(id) => setLibraryId(id)}
                allowClear
                emptyOptionLabel="全部可见知识库"
                activePath="/kb/qa"
              />
            </div>
            {ragUnavailable ? <Badge variant="warning">RAG 能力当前未启用</Badge> : null}
            {aiHealth === 'down' ? <Badge variant="destructive">AI 服务不可用</Badge> : null}
          </div>

          <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
            {turns.length === 0 ? (
              <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
                向知识库提问，例如「差旅住宿标准是多少？」「报销单需要哪些附件？」
              </div>
            ) : (
              turns.map((turn) => (
                <div key={turn.key} className="space-y-2">
                  <div className="flex justify-end">
                    <div className="max-w-[80%] rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground">
                      {turn.question}
                    </div>
                  </div>
                  <div className="rounded-lg border bg-background p-3">
                    {turn.answer ? (
                      <MarkdownView content={turn.answer} />
                    ) : turn.streaming ? (
                      <p className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        正在检索并生成…
                      </p>
                    ) : (
                      <MarkdownView content="（无回答）" />
                    )}
                    {turn.streaming ? (
                      <span className="ml-0.5 inline-block h-4 w-[2px] animate-pulse bg-primary align-text-bottom" />
                    ) : null}
                    {!turn.streaming ? <KbCitationList citations={turn.citations} /> : null}

                    {/* 回答操作条（F-08 复制/重新生成 · F-10 报告问题） */}
                    {!turn.streaming ? (
                      <div className="mt-2 flex flex-wrap items-center gap-1 border-t border-border/60 pt-2">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2 text-xs"
                          onClick={() => void onCopy(turn)}
                        >
                          {copiedKey === turn.key ? (
                            <Check className="h-3 w-3" />
                          ) : (
                            <Copy className="h-3 w-3" />
                          )}
                          {copiedKey === turn.key ? '已复制' : '复制'}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2 text-xs"
                          disabled={asking}
                          onClick={() => void onRegenerate(turn)}
                        >
                          <RotateCcw className="h-3 w-3" />
                          重新生成
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2 text-xs text-destructive hover:text-destructive"
                          disabled={turn.sessionId == null}
                          title={
                            turn.sessionId == null
                              ? '本轮回答未落库，无法建单'
                              : '对该回答报告问题'
                          }
                          onClick={() => setTicketTarget(turn)}
                        >
                          <TriangleAlert className="h-3 w-3" />
                          报告问题
                        </Button>
                      </div>
                    ) : null}
                  </div>
                </div>
              ))
            )}
            {askError ? <p className="text-sm text-destructive">{askError}</p> : null}
          </div>

          {activeSessionId != null ? (
            <div className="border-t p-3">
              <KbFeedbackFormPanel sessionId={activeSessionId} />
            </div>
          ) : null}

          <div className="border-t px-3 py-3">
            <div className="flex items-end gap-2">
              <Textarea
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    void onAsk();
                  }
                }}
                placeholder="输入问题…（Enter 发送，Shift+Enter 换行）"
                className="max-h-32 min-h-[2.5rem]"
                disabled={ragUnavailable}
              />
              {asking ? (
                <Button
                  type="button"
                  size="icon"
                  variant="outline"
                  className="h-9 w-9 shrink-0"
                  title="停止生成"
                  onClick={onStop}
                >
                  <Square className="h-3.5 w-3.5" />
                </Button>
              ) : (
                <Button
                  type="button"
                  size="icon"
                  className="h-9 w-9 shrink-0"
                  disabled={ragUnavailable || !question.trim()}
                  onClick={() => void onAsk()}
                >
                  <Send className="h-4 w-4" />
                </Button>
              )}
            </div>
            <div className="mt-1.5 flex items-center gap-1 text-[10px] text-muted-foreground">
              <Badge variant="outline" className="px-1.5 py-0">
                AI 生成
              </Badge>
              回答基于知识库检索，仅供参考，请以原始制度文件为准
            </div>
          </div>
        </div>
      </div>

      <KbTicketDialog
        open={ticketTarget != null}
        onOpenChange={(v) => {
          if (!v) setTicketTarget(null);
        }}
        sessionId={ticketTarget?.sessionId ?? null}
        messageId={ticketTarget?.messageId ?? null}
      />
    </div>
  );
}
