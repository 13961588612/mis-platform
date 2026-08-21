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

import { useEffect, useMemo, useState, type KeyboardEvent } from 'react';
import { Loader2, MessageSquarePlus, SendHorizonal, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { MarkdownView } from '@/components/common/markdown-view';
import { useChat } from '@/lib/chat/useChat';
import { SurfaceRenderer } from '@/lib/a2ui/SurfaceRenderer';
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
  const [input, setInput] = useState('');

  // 打开面板即确保会话存在（本地生成 + 持久化）
  useEffect(() => {
    void chat.ensureSession();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const canSend = !chat.isGenerating && input.trim().length > 0 && chat.connectionState !== 'connecting';

  const handleSend = (): void => {
    if (!canSend) return;
    chat.sendMessage(input);
    setInput('');
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key !== 'Enter' || e.shiftKey) return;
    e.preventDefault();
    handleSend();
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
      <div className="flex h-full min-h-0 flex-col">
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
          {chat.messages.length === 0 && !chat.isGenerating ? (
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
          <div className="flex items-end gap-2">
            <Textarea
              rows={2}
              value={input}
              disabled={chat.isGenerating}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="输入消息，Enter 发送，Shift+Enter 换行"
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
      </div>
    </div>
  );
}

export default CopilotPanel;
