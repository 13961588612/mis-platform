/**
 * CopilotPanel — 原生 AI Copilot 对话面板（T06'）。
 *
 * <p>02 文档 §1 T06'：废弃 iframe（CopilotH5Frame），原生 Sheet + ChatShell + SSE 直连
 * Gateway。本组件由 `components/layout/copilot-panel.tsx` 经 React.lazy 按需加载
 * （Sheet 打开才拉 chat-core + A2UI 渲染层 chunk）。
 *
 * <p>职责：对话消息渲染 + A2UI Surface 渲染（A2uiProvider + SurfaceRenderer）
 * + 输入发送 + 会话管理。chat-core（useChat）与 A2UI 渲染层全量在本 chunk 内。
 */

import { useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent } from 'react';
import { Loader2, MessageSquarePlus, Paperclip, SendHorizonal, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { MarkdownView } from '@/components/common/markdown-view';
import { useChat } from '@/lib/chat/useChat';
import { useAttachmentComposer } from '@/lib/chat/useAttachmentComposer';
import { AttachmentChips } from '@/components/chat/AttachmentChips';
import { AttachmentList } from '@/components/chat/AttachmentList';
import { SurfaceRenderer } from '@/lib/a2ui/SurfaceRenderer';
import { useSurfaceStore } from '@/lib/a2ui/surface-store';
import { A2uiProvider } from '@/components/a2ui/A2uiProvider';
import { A2uiPermissionGate } from '@/components/a2ui/A2uiPermissionGate';
import { getA2uiRegistryEntry, isKnownA2uiComponent } from '@/components/a2ui/registry';
import type { A2uiComponentName } from '@/lib/a2ui/types';
import type { ChatMessage } from '@/lib/chat/types';

/** 旧协议 ui.render 单条渲染（registry 组件 + 权限门控）。 */
function A2uiMessageRenderer({ render }: { render: NonNullable<ChatMessage['a2ui']> }) {
  const entry = getA2uiRegistryEntry(render.component);
  if (!entry || !isKnownA2uiComponent(render.component)) {
    return (
      <div className="rounded-lg border border-dashed border-border/70 bg-muted/30 p-3 text-xs text-muted-foreground">
        <div className="font-medium">未知 A2UI 组件：{render.component}</div>
        <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-all">
          {JSON.stringify(render.props ?? {}, null, 2)}
        </pre>
      </div>
    );
  }
  const Comp = entry.component;
  return (
    <A2uiPermissionGate requiredPermission={entry.requiredPermission} deniedText={entry.deniedText}>
      <Comp component={render.component as A2uiComponentName} props={render.props} />
    </A2uiPermissionGate>
  );
}

export function CopilotPanel() {
  const chat = useChat();
  const composer = useAttachmentComposer();
  const activeSurfaceId = useSurfaceStore((s) => s.activeSurfaceId);
  const [input, setInput] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  /** surface 已进 store 但尚未挂到气泡时，用兜底渲染避免「有回包界面空白」。 */
  const orphanSurface =
    activeSurfaceId != null &&
    !chat.messages.some((m) => m.surfaceId === activeSurfaceId);

  // 打开面板即确保会话存在（本地生成 + 持久化 + 自动加载历史）
  useEffect(() => {
    void chat.ensureSession();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const canSend =
    !chat.isGenerating &&
    !composer.hasUploading &&
    (input.trim().length > 0 || composer.attachments.length > 0) &&
    chat.connectionState !== 'connecting';

  const handleSend = (): void => {
    if (!canSend) return;
    const ready = composer.attachments.filter((a) => a.status === 'done');
    chat.sendMessage(input, ready.length > 0 ? ready : undefined);
    setInput('');
    composer.clear();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key !== 'Enter' || e.shiftKey) return;
    e.preventDefault();
    handleSend();
  };

  // 粘贴图片自动转附件（P0-1.3）
  const onPaste = (e: React.ClipboardEvent<HTMLTextAreaElement>): void => {
    const items = e.clipboardData?.items;
    if (!items) return;
    const files: File[] = [];
    for (const item of items) {
      if (item.kind === 'file' && item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) files.push(file);
      }
    }
    if (files.length > 0) {
      e.preventDefault();
      void composer.addFiles(files);
    }
  };

  // 拖拽覆盖层（P0-1.2）
  const onDrop = (e: DragEvent<HTMLDivElement>): void => {
    e.preventDefault();
    setDragOver(false);
    const files = Array.from(e.dataTransfer?.files ?? []);
    if (files.length > 0) void composer.addFiles(files);
  };

  const statusBadge = useMemo(() => {
    switch (chat.connectionState) {
      case 'connected':
        return <Badge variant="success">已连接</Badge>;
      case 'connecting':
      case 'reconnecting':
        return (
          <Badge variant="warning">
            <Loader2 className="h-3 w-3 animate-spin" />
            {chat.connectionState === 'connecting' ? '连接中' : '重连中'}
          </Badge>
        );
      case 'error':
        return <Badge variant="destructive">连接异常</Badge>;
      default:
        return <Badge variant="secondary">未连接</Badge>;
    }
  }, [chat.connectionState]);

  return (
    <A2uiProvider dispatchAction={chat.dispatchA2uiAction}>
      <div
        className={cn('relative flex h-full min-h-0 flex-col', dragOver && 'ring-2 ring-primary/60')}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={(e) => {
          // 仅当离开容器本身（非子元素）才取消高亮
          if (e.currentTarget === e.target) setDragOver(false);
        }}
        onDrop={onDrop}
      >
        {/* 拖拽覆盖层 */}
        {dragOver ? (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-lg border-2 border-dashed border-primary bg-primary/5 text-sm text-primary">
            释放以添加附件
          </div>
        ) : null}

        {/* 头部 */}
        <div className="flex shrink-0 items-center gap-2 border-b px-4 py-2.5">
          <Sparkles className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold">AI Copilot</span>
          <span className="ml-auto flex items-center gap-2">{statusBadge}</span>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            title="新建会话"
            onClick={chat.closeSession}
          >
            <MessageSquarePlus className="h-4 w-4" />
          </Button>
        </div>

        {/* 错误条（常驻，非 toast） */}
        {chat.error ? (
          <Alert variant="destructive" className="mx-3 mt-2 rounded-md py-2">
            <AlertTitle className="text-xs font-semibold">对话错误</AlertTitle>
            <AlertDescription className="break-all text-xs">{chat.error}</AlertDescription>
          </Alert>
        ) : null}

        {/* 消息区：单层滚动，禁内层滚动 */}
        <div className="min-h-0 flex-1 overflow-auto px-3 py-3">
          {chat.historyState === 'loading' ? (
            // 历史加载骨架屏（P0-2.1）
            <div className="space-y-3">
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className={cn(
                    'flex',
                    i % 2 === 0 ? 'justify-end' : 'justify-start',
                  )}
                >
                  <div className="h-12 w-2/3 animate-pulse rounded-lg bg-muted/60" />
                </div>
              ))}
            </div>
          ) : chat.messages.length === 0 && !chat.isGenerating ? (
            <div className="flex h-full min-h-[12rem] items-center justify-center">
              <p className="max-w-md text-center text-sm text-muted-foreground">
                我是 AI Copilot。可以问我业务问题，需要生成表单 / 表格 / 审批卡片时，我会直接在这里渲染可交互界面。
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {chat.messages.map((msg) => (
                <ChatBubble key={msg.id} message={msg} />
              ))}
              {orphanSurface ? <SurfaceRenderer className="w-full" /> : null}
              {chat.isGenerating ? (
                <div className="flex items-center gap-2 rounded-lg border bg-card p-3 text-xs text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  正在思考…
                </div>
              ) : null}
            </div>
          )}
        </div>

        {/* 输入区 */}
        <div className="shrink-0 border-t px-3 py-3">
          {/* 待发送附件区（P0-1.4） */}
          <AttachmentChips
            attachments={composer.attachments}
            onRemove={composer.removeAt}
            onRetry={composer.retryAt}
            disabled={chat.isGenerating}
            className="mb-2"
          />
          {composer.rejectionHint ? (
            <p className="mb-2 text-[11px] text-destructive">{composer.rejectionHint}</p>
          ) : null}
          <div className="flex items-end gap-2">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".png,.jpg,.jpeg,.gif,.webp,.pdf,.doc,.docx,.xlsx,.csv,.txt,.md,image/*,application/pdf"
              className="hidden"
              onChange={(e) => {
                const files = Array.from(e.target.files ?? []);
                if (files.length > 0) void composer.addFiles(files);
                e.target.value = '';
              }}
            />
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="h-9 w-9 shrink-0"
              title="添加附件"
              disabled={!composer.canAddMore || chat.isGenerating}
              onClick={() => fileInputRef.current?.click()}
            >
              <Paperclip className="h-4 w-4" />
            </Button>
            <Textarea
              rows={2}
              value={input}
              disabled={chat.isGenerating}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              onPaste={onPaste}
              placeholder="输入消息，Enter 发送，Shift+Enter 换行；可拖拽或粘贴图片"
              className="min-h-[3.25rem] flex-1 resize-none"
            />
            <Button
              type="button"
              size="sm"
              disabled={!canSend}
              onClick={handleSend}
              className="h-9 shrink-0"
            >
              {chat.isGenerating ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <SendHorizonal className="h-4 w-4" />
              )}
              发送
            </Button>
          </div>
          <p className="mt-1.5 text-[11px] text-muted-foreground">
            {chat.connectionState === 'connected' ? '已直连 Agent 网关 · 界面由 A2UI 动态生成' : '等待连接…'}
          </p>
        </div>
      </div>
    </A2uiProvider>
  );
}

/** 单条消息气泡（user / assistant / tool / a2ui surface）。 */
function ChatBubble({ message }: { message: ChatMessage }) {
  if (message.role === 'tool') {
    return (
      <div className="rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
        <div className="font-medium">⚙ {message.toolName ?? '工具调用'}</div>
        {message.toolArgs ? (
          <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap break-all text-[11px]">
            {message.toolArgs}
          </pre>
        ) : null}
      </div>
    );
  }

  // A2UI surface 消息：渲染 surface 卡片
  if (message.surfaceId) {
    return (
      <div className="flex justify-start">
        <div className="w-full max-w-full">
          <SurfaceRenderer surfaceId={message.surfaceId} />
        </div>
      </div>
    );
  }

  // 旧协议 ui.render 消息
  if (message.a2ui) {
    return (
      <div className="flex justify-start">
        <div className="w-full max-w-full">
          <A2uiMessageRenderer render={message.a2ui} />
        </div>
      </div>
    );
  }

  const isUser = message.role === 'user';
  return (
    <div className={cn('flex', isUser ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'max-w-[85%] rounded-lg px-3 py-2 text-sm',
          isUser
            ? 'bg-primary text-primary-foreground'
            : 'border bg-card text-foreground',
          message.status === 'error' && 'border-destructive/50 text-destructive',
        )}
      >
        {message.content ? (
          isUser ? (
            <p className="whitespace-pre-wrap break-words">{message.content}</p>
          ) : (
            <MarkdownView content={message.content} />
          )
        ) : (
          <span className="text-muted-foreground">…</span>
        )}
        {message.attachments && message.attachments.length > 0 ? (
          <AttachmentList
            attachments={message.attachments}
            className={cn('mt-2', isUser ? 'justify-end' : 'justify-start')}
          />
        ) : null}
      </div>
    </div>
  );
}

export default CopilotPanel;
