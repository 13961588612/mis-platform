import { useCallback, useEffect, useState } from 'react';
import { Loader2, Send } from 'lucide-react';
import { toast } from 'sonner';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ListError } from '@/components/common/empty-state';
import { FormShell } from '@/features/biz/forms/form-shell';
import {
  fetchMessageDetail,
  replyMessage,
  type MessageDetail,
} from '@/lib/api/messages';
import { fetchProcessDetail, type ProcessDetail } from '@/lib/api/workflow';
import { downloadMessageFile } from '@/lib/api/message-manage';
import { MessageHtmlView, messageHtmlBody, parseAttachmentList } from '@/features/portal/components/message-html-view';
import { useAuthStore } from '@/stores/auth-store';

function formatTime(iso: string | null | undefined): string {
  return iso ? iso.replace('T', ' ').slice(0, 16) : '-';
}

export interface MessageDetailDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 当前消息 ID；为 `null` 时不加载（抽屉关闭态）。 */
  messageId: string | null;
}

/**
 * 消息详情抽屉（T04，设计 §2.3 / §2.4）。
 *
 * <p>右侧划入（`Sheet`，宽度 `max-w-[560px]`）；内容体是**唯一滚动容器**
 * （`min-h-0 flex-1 overflow-auto`）。内嵌的 `FormShell` 只读渲染、**不得**再加
 * `overflow-auto`/`max-h`（单层滚动红线）。
 *
 * <p><b>两种形态</b>：
 * <ul>
 *   <li><b>普通消息</b>（`detail.instanceId == null`）：标题 + 摘要 + 元信息 + 完整正文 + 附件，
 *       不加载流程详情、不展示表单。</li>
 *   <li><b>流程通知</b>（`detail.instanceId != null`）：正文 + **只读表单**（`FormShell`，
 *       由 `fetchProcessDetail(instanceId, tenantId)` 取 `formData`）+ **回复区**。
 *       本轮仅「表单内容 + 回复区」，**不叠加审批进度 / 审批信息**（§11.3 定稿）。</li>
 * </ul>
 *
 * <p><b>回复入口显隐</b>：严格按后端 `canReply` 控制——`true` 显示输入框 + 「回复」；
 * `false` 隐藏入口并给一行提示。提交成功后就地回显「我的回复」并 `toast`（回复已作为
 * `wf_history(COMMENT)` 回写流程，语义由后端保证）。
 */
export function MessageDetailDrawer({ open, onOpenChange, messageId }: MessageDetailDrawerProps) {
  const user = useAuthStore((s) => s.user);
  // 单租户阶段固定 tenantId=1（与门户其它页同口径）。
  const tenantId = '1';
  const userId = user?.id ?? '';
  const userName = user?.realName ?? user?.username ?? '';

  const [detail, setDetail] = useState<MessageDetail | null>(null);
  /** 流程通知形态下加载的流程详情（仅用于取只读表单）。 */
  const [proc, setProc] = useState<ProcessDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [content, setContent] = useState('');
  const [replying, setReplying] = useState(false);
  /** 本次会话内已提交的回复（就地回显）。 */
  const [myReplies, setMyReplies] = useState<string[]>([]);

  const load = useCallback(async () => {
    if (!messageId) return;
    setLoading(true);
    setError(null);
    setDetail(null);
    setProc(null);
    setContent('');
    setMyReplies([]);
    try {
      const d = await fetchMessageDetail(messageId, userId);
      setDetail(d);
      if (d.instanceId) {
        // 表单加载失败**不阻断**正文 / 回复区（降级）。
        try {
          setProc(await fetchProcessDetail(d.instanceId, tenantId));
        } catch {
          setProc(null);
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载消息详情失败');
    } finally {
      setLoading(false);
    }
  }, [messageId, userId, tenantId]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleReply = useCallback(async () => {
    const text = content.trim();
    if (!messageId || !text) return;
    setReplying(true);
    try {
      await replyMessage(messageId, tenantId, userId, userName, text);
      setMyReplies((prev) => [...prev, text]);
      setContent('');
      toast.success('回复已提交');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '回复失败');
    } finally {
      setReplying(false);
    }
  }, [messageId, content, tenantId, userId, userName]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full max-w-[560px]">
        <SheetHeader>
          <SheetTitle>{detail ? detail.title : '消息详情'}</SheetTitle>
          <SheetDescription className="text-xs">
            {loading ? '加载中…' : (detail?.category ?? '消息')}
          </SheetDescription>
        </SheetHeader>

        {/* 唯一滚动容器：抽屉内容体。内嵌 FormShell 不得再出现 overflow-auto。 */}
        <div className="min-h-0 flex-1 space-y-4 overflow-auto px-5 py-4">
          {loading ? (
            <div className="flex h-40 items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              加载中…
            </div>
          ) : error ? (
            <ListError message={error} onRetry={() => void load()} />
          ) : detail ? (
            <>
              {/* 标题 + 摘要 */}
              <div className="space-y-1">
                <h3 className="text-[15px] font-semibold leading-snug">{detail.title}</h3>
                {detail.summary ? (
                  <p className="text-[13px] text-muted-foreground">{detail.summary}</p>
                ) : null}
              </div>

              {/* 元信息 */}
              <dl className="grid grid-cols-2 gap-x-3 gap-y-2 border-y py-3 text-[12px]">
                <div>
                  <dt className="text-muted-foreground">类型</dt>
                  <dd>{detail.msgType}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">分类</dt>
                  <dd>{detail.category}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">发送人</dt>
                  <dd>{detail.senderName ?? '系统'}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">时间</dt>
                  <dd>{formatTime(detail.createdAt)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">已读</dt>
                  <dd>
                    {detail.readCount}/{detail.totalCount}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">关联流程</dt>
                  <dd>{detail.instanceId ? '是' : '否'}</dd>
                </div>
              </dl>

              {/* 正文（完整，不截断） */}
              <div className="space-y-1">
                <h4 className="text-[13px] font-semibold">正文</h4>
                {messageHtmlBody(detail.content) ? (
                  <MessageHtmlView html={messageHtmlBody(detail.content) ?? ''} />
                ) : (
                  <div className="whitespace-pre-wrap break-words text-[13px] leading-relaxed">
                    {detail.content || detail.summary || '（无正文）'}
                  </div>
                )}
              </div>

              {parseAttachmentList(detail.attachments).length > 0 ? (
                <div className="space-y-1">
                  <h4 className="text-[13px] font-semibold">附件</h4>
                  <ul className="text-[13px]">
                    {parseAttachmentList(detail.attachments).map((file) => (
                      <li key={file.fileId}>
                        <button
                          type="button"
                          className="text-primary underline"
                          onClick={() => {
                            void downloadMessageFile(file.fileId).then((blob) => {
                              const url = URL.createObjectURL(blob);
                              const a = document.createElement('a');
                              a.href = url;
                              a.download = file.name;
                              a.click();
                              URL.revokeObjectURL(url);
                            });
                          }}
                        >
                          {file.name}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {/*
                流程通知形态：只读表单（FormShell）。
                ⚠️ 仅「表单内容」，不叠加审批进度 / 审批信息（§11.3）。
                FormShell 只读态不实例化业务组件（见 form-shell.tsx 硬约束 1）。
              */}
              {detail.instanceId ? (
                <div className="space-y-1">
                  <FormShell
                    formCode={proc?.instance.startedFormCode ?? null}
                    formData={proc?.formData ?? null}
                    onRetry={() => void load()}
                  />
                </div>
              ) : null}

              {/* 回复区：显隐严格按 canReply */}
              <div className="space-y-2 border-t pt-3">
                <h4 className="text-[13px] font-semibold">回复</h4>
                {detail.canReply ? (
                  <>
                    <div className="flex items-start gap-2">
                      <Input
                        value={content}
                        onChange={(e) => setContent(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            void handleReply();
                          }
                        }}
                        placeholder="输入回复内容…"
                        aria-label="回复内容"
                        className="h-9"
                      />
                      <Button
                        size="sm"
                        disabled={!content.trim() || replying}
                        onClick={() => void handleReply()}
                      >
                        <Send className="mr-1 h-3.5 w-3.5" />
                        回复
                      </Button>
                    </div>
                    {myReplies.length > 0 ? (
                      <ul className="space-y-1">
                        {myReplies.map((text, idx) => (
                          <li
                            key={`${idx}-${text}`}
                            className="rounded bg-primary/5 px-2 py-1 text-[12px]"
                          >
                            <span className="font-medium text-foreground">我的回复：</span>
                            <span className="whitespace-pre-wrap break-words">{text}</span>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </>
                ) : (
                  <p className="text-[12px] text-muted-foreground">该消息无关联流程，暂不支持回复</p>
                )}
              </div>
            </>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}

export default MessageDetailDrawer;
