import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Bot, Check, Eye, ScanSearch, Ticket, User, X, type LucideIcon } from 'lucide-react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { KbCitationList } from '../components/kb-citation-list';
import { SecrecyBadge } from '../components/kb-badges';
import { KbTicketDialog } from '../components/kb-ticket-dialog';
import { getOperationSessionDetail, listTicketsBySession, markFeedbackProcessed } from '../api/kb-api';
import type { KbQaFeedback, KbQaSessionDetail, KbQaTicket } from '../types';
import {
  aclActionLabel,
  feedbackStatusLabel,
  formatTime,
  KB_FEEDBACK_STATUS_META,
  qaSentimentLabel,
  subjectTypeLabel,
  ticketStatusLabel,
  ticketTypeLabel,
} from '../types';

/** 定义列表的单行（label 固定宽度，value 自适应）。 */
function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex gap-2 py-1 text-sm">
      <span className="w-24 shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 flex-1 break-words">{value}</span>
    </div>
  );
}

/** 数值展示：null/NaN 统一回落 `-`，避免渲染出 `null`。 */
function num(v: number | null | undefined, suffix = ''): string {
  if (v == null || !Number.isFinite(v)) return '-';
  return `${v}${suffix}`;
}

/** 反馈综合分（accuracy/helpful 非空均值；无可评维度回落 null）。 */
function compositeScore(fb: KbQaFeedback): number | null {
  const scores = [fb.accuracy, fb.helpful].filter(
    (s): s is number => s != null && Number.isFinite(s),
  );
  if (scores.length === 0) return null;
  return scores.reduce((a, b) => a + b, 0) / scores.length;
}

/** 转工单初始类型（OP-03：引用错误维度 → cite_error，其余 → answer_error）。 */
function ticketTypeForFeedback(fb: KbQaFeedback): string {
  if ((fb.citeError ?? 0) > 0) return 'cite_error';
  return 'answer_error';
}

/** 小节容器。 */
function Section({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon: LucideIcon;
  children: ReactNode;
}) {
  return (
    <section className="rounded-lg border bg-card p-3">
      <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
        <Icon className="h-4 w-4 text-muted-foreground" />
        {title}
      </h3>
      {children}
    </section>
  );
}

/**
 * 运营问答详情弹窗（A-02a）。
 *
 * <p>在只读的问答回放之上，补齐两块运营视角的关键上下文：
 * - **可见范围快照**：本会话涉及知识库的密级与 ACL 摘要（`subjectName` 由 BFF 回填，
 *   前端不再二次查名字）；
 * - **召回参数快照**：topK / 阈值 / rerank / 检索方式。
 *
 * <p>⚠️ 召回参数取自知识库**当前**的 RAG 设置，不是本轮问答的精确入参重放
 * （P1 未做逐轮参数留痕）。排障时若发现参数与预期不符，要先确认设置是否被改过，
 * 不要直接断言「当时就是这么召回的」。
 */
export function KbQaSessionDetailDialog({
  sessionId,
  open,
  onOpenChange,
}: {
  sessionId: number | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const [detail, setDetail] = useState<KbQaSessionDetail | null>(null);
  const [tickets, setTickets] = useState<KbQaTicket[]>([]);
  const [loading, setLoading] = useState(false);
  const [ticketOpen, setTicketOpen] = useState(false);
  const [processOpen, setProcessOpen] = useState(false);
  const [processStatus, setProcessStatus] = useState<'handled' | 'ignored'>('handled');
  const [processNote, setProcessNote] = useState('');
  const [processing, setProcessing] = useState(false);

  const load = useCallback(async (id: number) => {
    setLoading(true);
    try {
      // 工单查询失败不应挡住主详情，故用 allSettled 而非 all
      const [d, t] = await Promise.allSettled([
        getOperationSessionDetail(id),
        listTicketsBySession(id),
      ]);
      if (d.status === 'fulfilled') {
        setDetail(d.value);
      } else {
        setDetail(null);
        toast.error(d.reason instanceof Error ? d.reason.message : '加载问答详情失败');
      }
      setTickets(t.status === 'fulfilled' ? t.value : []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open || sessionId == null) {
      setDetail(null);
      setTickets([]);
      return;
    }
    void load(sessionId);
  }, [open, sessionId, load]);

  async function onSubmitProcess(): Promise<void> {
    if (feedback == null) return;
    setProcessing(true);
    try {
      await markFeedbackProcessed(feedback.id, {
        status: processStatus,
        note: processNote.trim() || null,
      });
      toast.success(processStatus === 'handled' ? '已标记处理' : '已标记忽略');
      setProcessOpen(false);
      setProcessNote('');
      if (sessionId != null) {
        void load(sessionId);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '标记失败');
    } finally {
      setProcessing(false);
    }
  }

  const session = detail?.session ?? null;
  const messages = detail?.messages ?? [];
  const visibility = detail?.visibility ?? null;
  const recall = detail?.recallParams ?? null;
  const feedback = detail?.feedback ?? null;
  // 转工单自动带出的消息 id：取最后一条助手消息（反馈通常挂在最近的回答上）
  const assistantMessageId =
    messages.filter((m) => m.role === 'assistant').at(-1)?.id ?? null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] w-full max-w-4xl flex-col">
        <DialogHeader>
          <DialogTitle>问答详情 #{sessionId ?? '-'}</DialogTitle>
          <DialogDescription>
            只读回放；可见范围与召回参数为快照展示，召回参数取自知识库当前设置。
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-3 overflow-auto pr-1">
          {loading ? (
            <p className="py-10 text-center text-sm text-muted-foreground">加载中…</p>
          ) : detail == null ? (
            <p className="py-10 text-center text-sm text-muted-foreground">暂无数据</p>
          ) : (
            <>
              <Section title="质量反馈" icon={Eye}>
                {feedback == null ? (
                  <p className="text-xs text-muted-foreground">（用户未评价）</p>
                ) : (
                  <>
                    <div className="mb-2 flex flex-wrap items-center gap-1.5">
                      <Badge
                        variant={
                          (feedback.offtopic ?? 0) > 0 || (feedback.citeError ?? 0) > 0
                            ? 'destructive'
                            : 'success'
                        }
                      >
                        {qaSentimentLabel(
                          (feedback.offtopic ?? 0) > 0 || (feedback.citeError ?? 0) > 0
                            ? 'negative'
                            : 'positive',
                        )}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        综合分 {num(compositeScore(feedback), ' 分')}
                      </span>
                      {feedback.feedbackStatus ? (
                        <Badge
                          variant={KB_FEEDBACK_STATUS_META[feedback.feedbackStatus]?.variant ?? 'secondary'}
                        >
                          {feedbackStatusLabel(feedback.feedbackStatus)}
                        </Badge>
                      ) : null}
                      {tickets.some((t) => t.status === 'open' || t.status === 'processing') ? (
                        <Badge variant="warning">有关联工单</Badge>
                      ) : null}
                    </div>
                    <div className="grid grid-cols-2 gap-x-6 sm:grid-cols-4">
                      <Row label="准确性" value={num(feedback.accuracy)} />
                      <Row label="有用性" value={num(feedback.helpful)} />
                      <Row label="跑题度" value={num(feedback.offtopic)} />
                      <Row label="引用错误" value={num(feedback.citeError)} />
                    </div>
                    {feedback.feedbackStatus && feedback.feedbackStatus !== 'pending' ? (
                      <p className="mt-2 text-xs text-muted-foreground">
                        {feedbackStatusLabel(feedback.feedbackStatus)}
                        {feedback.handlerName ? ` · ${feedback.handlerName}` : ''}
                        {feedback.handledAt ? ` · ${formatTime(feedback.handledAt)}` : ''}
                        {feedback.handleNote ? ` · ${feedback.handleNote}` : ''}
                      </p>
                    ) : null}
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setTicketOpen(true)}
                        disabled={feedback.feedbackStatus === 'handled' || feedback.feedbackStatus === 'ignored'}
                      >
                        <Ticket className="h-4 w-4" />
                        转工单
                      </Button>
                      {feedback.feedbackStatus === 'pending' || feedback.feedbackStatus == null ? (
                        <>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setProcessStatus('handled');
                              setProcessNote('');
                              setProcessOpen(true);
                            }}
                          >
                            <Check className="h-4 w-4" />
                            标记已处理
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setProcessStatus('ignored');
                              setProcessNote('');
                              setProcessOpen(true);
                            }}
                          >
                            <X className="h-4 w-4" />
                            标记忽略
                          </Button>
                        </>
                      ) : null}
                    </div>
                  </>
                )}
              </Section>

              <Section title="会话信息" icon={User}>
                <div className="grid grid-cols-1 gap-x-6 sm:grid-cols-2">
                  <Row label="会话 ID" value={session?.id ?? '-'} />
                  <Row label="提问人 ID" value={session?.userId ?? '-'} />
                  <Row label="应用 ID" value={session?.appId ?? '-'} />
                  <Row label="创建时间" value={formatTime(session?.createdAt)} />
                </div>
              </Section>

              <Section title="可见范围快照" icon={Eye}>
                {visibility == null ? (
                  <p className="text-xs text-muted-foreground">（无可见范围信息）</p>
                ) : (
                  <>
                    <Row
                      label="密级"
                      value={
                        visibility.secrecy ? <SecrecyBadge secrecy={visibility.secrecy} /> : '-'
                      }
                    />
                    {visibility.acls && visibility.acls.length > 0 ? (
                      <div className="mt-2 overflow-hidden rounded-md border">
                        <table className="w-full text-left text-xs">
                          <thead className="bg-table-header text-muted-foreground">
                            <tr>
                              <th className="px-2 py-1.5 font-bold">主体类型</th>
                              <th className="px-2 py-1.5 font-bold">主体</th>
                              <th className="px-2 py-1.5 font-bold">动作</th>
                            </tr>
                          </thead>
                          <tbody>
                            {visibility.acls.map((a, i) => (
                              <tr key={`${a.subjectType}-${a.subjectId ?? i}-${a.action}`} className="border-t">
                                <td className="px-2 py-1.5">{subjectTypeLabel(a.subjectType)}</td>
                                <td className="px-2 py-1.5">
                                  {a.subjectName ?? (a.subjectId == null ? '-' : `#${a.subjectId}`)}
                                </td>
                                <td className="px-2 py-1.5">{aclActionLabel(a.action)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <p className="mt-1 text-xs text-muted-foreground">
                        无显式授权（若密级为「公开」则全员可见）
                      </p>
                    )}
                  </>
                )}
              </Section>

              <Section title="召回参数快照" icon={ScanSearch}>
                {recall == null ? (
                  <p className="text-xs text-muted-foreground">（无召回参数信息）</p>
                ) : (
                  <div className="grid grid-cols-1 gap-x-6 sm:grid-cols-2">
                    <Row label="topK" value={num(recall.topK)} />
                    <Row label="相似度阈值" value={num(recall.scoreThreshold)} />
                    <Row
                      label="重排"
                      value={recall.rerank == null ? '-' : recall.rerank ? '已启用' : '未启用'}
                    />
                    <Row label="检索方式" value={recall.retrievalMethod ?? '-'} />
                  </div>
                )}
              </Section>

              <Section title={`对话记录（${messages.length}）`} icon={Bot}>
                {messages.length === 0 ? (
                  <p className="text-xs text-muted-foreground">（无消息）</p>
                ) : (
                  <ul className="space-y-2">
                    {messages.map((m) => (
                      <li key={m.id} className="rounded-md border bg-background p-2.5">
                        <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
                          <span className="inline-flex items-center gap-1">
                            {m.role === 'user' ? (
                              <User className="h-3 w-3" />
                            ) : (
                              <Bot className="h-3 w-3" />
                            )}
                            {m.role === 'user' ? '提问' : '回答'}
                          </span>
                          <span>{formatTime(m.createdAt)}</span>
                        </div>
                        <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">
                          {m.content}
                        </p>
                        {m.role === 'assistant' ? <KbCitationList citations={m.citations} /> : null}
                      </li>
                    ))}
                  </ul>
                )}
              </Section>

              <Section title={`关联工单（${tickets.length}）`} icon={Ticket}>
                {tickets.length === 0 ? (
                  <p className="text-xs text-muted-foreground">（无关联工单）</p>
                ) : (
                  <ul className="space-y-1.5">
                    {tickets.map((t) => (
                      <li
                        key={t.id}
                        className="flex items-start gap-2 rounded-md bg-secondary/40 px-2.5 py-1.5 text-xs"
                      >
                        <span className="shrink-0 font-mono">#{t.id}</span>
                        <Badge variant="outline">{t.typeLabel ?? ticketTypeLabel(t.type)}</Badge>
                        <Badge variant={t.status === 'open' ? 'warning' : 'secondary'}>
                          {ticketStatusLabel(t.status)}
                        </Badge>
                        <span className="min-w-0 flex-1 break-words">{t.content ?? '-'}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </Section>
            </>
          )}
        </div>
      </DialogContent>

      <KbTicketDialog
        open={ticketOpen}
        onOpenChange={setTicketOpen}
        sessionId={sessionId}
        messageId={assistantMessageId}
        title="转工单"
        initialType={feedback == null ? null : ticketTypeForFeedback(feedback)}
        onCreated={() => {
          if (sessionId != null) {
            void load(sessionId);
          }
        }}
      />

      <Dialog open={processOpen} onOpenChange={setProcessOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{processStatus === 'handled' ? '标记已处理' : '标记忽略'}</DialogTitle>
            <DialogDescription>
              状态机 pending → handled/ignored 单向终态；确认后不可回退。
            </DialogDescription>
          </DialogHeader>
          <div>
            <label className="mb-[0.4rem] block text-sm font-medium text-foreground">
              处理备注（可选）
            </label>
            <Textarea
              value={processNote}
              onChange={(e) => setProcessNote(e.target.value)}
              placeholder="记录处理结论 / 原因"
              className="min-h-[5rem]"
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={processing}
              onClick={() => setProcessOpen(false)}
            >
              取消
            </Button>
            <Button disabled={processing} onClick={() => void onSubmitProcess()}>
              {processing ? '提交中…' : '确认'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Dialog>
  );
}
