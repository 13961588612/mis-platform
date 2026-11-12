import { useCallback, useEffect, useState } from 'react';
import { ExternalLink, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { ListError } from '@/components/common/empty-state';
import { ProcessShell } from '@/features/taskflow/process-shell';
import {
  fetchMessageDetail,
  type MessageDetail,
} from '@/lib/api/messages';
import type { WfInstance } from '@/lib/api/workflow';
import { downloadMessageFile } from '@/lib/api/message-manage';
import { MessageHtmlView, messageHtmlBody, parseAttachmentList } from '@/features/portal/components/message-html-view';
import { useAuthStore } from '@/stores/auth-store';
import { cn } from '@/lib/utils';

function formatTime(iso: string | null | undefined): string {
  return iso ? iso.replace('T', ' ').slice(0, 16) : '-';
}

/** 流程实例状态徽标（与待办抽屉口径一致）。 */
const PROCESS_STATUS: Record<string, { text: string; cls: string }> = {
  RUNNING: { text: '进行中', cls: 'bg-info/10 text-info' },
  COMPLETED: { text: '已完成', cls: 'bg-success/10 text-success' },
  TERMINATED: { text: '已终止', cls: 'bg-destructive/10 text-destructive' },
  SUSPENDED: { text: '已挂起', cls: 'bg-warning/10 text-warning' },
};

export interface MessageDetailDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 当前消息 ID；为 `null` 时不加载（抽屉关闭态）。 */
  messageId: string | null;
  /**
   * 流程动作（同意/驳回/转办）成功后的回调：由父组件关抽屉 + 刷新列表。
   * 普通消息（无关联流程）不会触发。
   */
  onDone?: () => void;
}

/**
 * 消息详情抽屉。
 *
 * <p><b>两种形态</b>：
 * <ul>
 *   <li><b>关联流程</b>（`detail.instanceId != null`）：嵌入 {@link ProcessShell}
 *       （`embedded`）——表单 + 进度 + 审批信息。当前用户若是待办审批人，可立即同意/驳回
 *       （意见写在审批栏 comment）；否则只读，底部提示「当前节点由他人处理」。</li>
 *   <li><b>普通消息</b>（无 `instanceId`）：标题 + 摘要 + 元信息 + 正文 + 附件；
 *       <b>不提供</b>独立「回复」入口（回复语义已收敛为审批人意见）。</li>
 * </ul>
 *
 * <p>独立 `replyMessage` / `canReply` 自由回复已关闭；后端 `canReply` 恒为 false。
 */
export function MessageDetailDrawer({
  open,
  onOpenChange,
  messageId,
  onDone,
}: MessageDetailDrawerProps) {
  const user = useAuthStore((s) => s.user);
  const userId = user?.id ?? '';

  const [detail, setDetail] = useState<MessageDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** 关联流程时由 ProcessShell.onLoaded 回填，用于 SheetHeader。 */
  const [header, setHeader] = useState<WfInstance | null>(null);

  const load = useCallback(async () => {
    if (!messageId) return;
    setLoading(true);
    setError(null);
    setDetail(null);
    setHeader(null);
    try {
      setDetail(await fetchMessageDetail(messageId, userId));
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载消息详情失败');
    } finally {
      setLoading(false);
    }
  }, [messageId, userId]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleLoaded = useCallback((inst: WfInstance) => setHeader(inst), []);

  const handleActionDone = useCallback(() => {
    onDone?.();
  }, [onDone]);

  function openFullPage() {
    const instanceId = detail?.instanceId;
    if (!instanceId) return;
    const path = `/task/process-view/${instanceId}`;
    const url = `${window.location.origin}${path}`;
    const name = `mis-process-view-${instanceId}`;
    const win = window.open(url, name);
    if (win) {
      try {
        win.focus();
      } catch {
        /* ignore */
      }
    } else {
      toast.error('无法打开完整页', {
        description: '可能已被浏览器拦截，或该流程已在其他标签中打开，请检查标签栏。',
      });
    }
  }

  const hasProcess = Boolean(detail?.instanceId);
  const statusMeta = header ? PROCESS_STATUS[header.status] ?? PROCESS_STATUS.RUNNING : null;

  const sheetTitle = hasProcess
    ? header
      ? header.title?.trim() || header.businessId
      : detail?.title ?? '消息详情'
    : detail
      ? detail.title
      : '消息详情';

  return (
    <Sheet
      open={open}
      onOpenChange={(o) => {
        if (!o) setHeader(null);
        onOpenChange(o);
      }}
    >
      <SheetContent side="right" className="w-full max-w-[560px]">
        <SheetHeader>
          <SheetTitle>{sheetTitle}</SheetTitle>
          <SheetDescription className={hasProcess && header ? 'sr-only' : 'text-xs'}>
            {loading ? '加载中…' : hasProcess ? '流程详情' : (detail?.category ?? '消息')}
          </SheetDescription>
          {statusMeta ? (
            <span
              className={cn(
                'mt-1 inline-flex w-fit items-center rounded px-1.5 py-0.5 text-[10px]',
                statusMeta.cls,
              )}
            >
              {statusMeta.text}
            </span>
          ) : null}
        </SheetHeader>

        <div className="min-h-0 flex-1 overflow-auto px-5 py-4">
          {loading ? (
            <div className="flex h-40 items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              加载中…
            </div>
          ) : error ? (
            <ListError message={error} onRetry={() => void load()} />
          ) : detail?.instanceId ? (
            <ProcessShell
              key={detail.instanceId}
              instanceId={detail.instanceId}
              variant="embedded"
              onLoaded={handleLoaded}
              onActionDone={handleActionDone}
            />
          ) : detail ? (
            <div className="space-y-4">
              {detail.summary ? (
                <p className="text-[13px] text-muted-foreground">{detail.summary}</p>
              ) : null}

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
              </dl>

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
            </div>
          ) : null}
        </div>

        {hasProcess ? (
          <SheetFooter>
            <Button variant="outline" size="sm" onClick={openFullPage}>
              <ExternalLink className="mr-1 h-3.5 w-3.5" />
              在完整页打开
            </Button>
          </SheetFooter>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

export default MessageDetailDrawer;
