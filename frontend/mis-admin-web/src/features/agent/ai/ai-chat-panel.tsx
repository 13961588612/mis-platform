/**
 * ai-chat-panel.tsx — A2UI 对话面板（T09，从 旧版独立前端 ChatPanel + ChatPage 迁移）。
 *
 * <p>知识库问答 / 问数两页共用的对话壳：
 * - chat-core（useChat，RS256 MIS JWT）直连 Gateway，A2UI opt-in 默认开启
 * - 助手正文渲染 Markdown + 知识库引用折叠（KbChatSourceList / KbChatSourceFigures）
 * - A2UI Surface 渲染（SurfaceRenderer：data-table / entity-select / approval-card / form-sheet）
 * - dispatch.trace 调度轻提示（Coordinator → Worker，不暴露 Worker 选择器）
 * - 旧协议 ui.render / approval.request 兼容
 *
 * <p>**连接门控**：chat-core 的全局 store 单活动会话（Copilot 面板 / 本页共用）。
 * 页面级对话壳只在**当前路由激活**时 `autoConnect`，避免 keep-alive 多 Tab
 * 同时挂两个 SSE 订阅导致消息重复入 store。
 */

import { useEffect, useMemo, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { Loader2, MessageSquarePlus, SendHorizonal, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { MarkdownView } from '@/components/common/markdown-view';
import { useChat } from '@/lib/chat/useChat';
import { useChatStore } from '@/stores/chat-store';
import { SurfaceRenderer } from '@/lib/a2ui/SurfaceRenderer';
import { A2uiProvider } from '@/components/a2ui/A2uiProvider';
import { A2uiPermissionGate } from '@/components/a2ui/A2uiPermissionGate';
import { getA2uiRegistryEntry, isKnownA2uiComponent } from '@/components/a2ui/registry';
import {
  KbChatSourceFigures,
  KbChatSourceList,
  splitKbSources,
} from '@/components/common/kb-chat-sources';
import { IqdCitationBlock, splitIqdCitations } from './components/iqd-citation-block';
import { IqdPlanSteps, splitIqdPlan } from './components/iqd-plan-steps';
import { IqdFeedbackButtons } from './components/iqd-feedback-buttons';
import type { A2uiComponentName } from '@/lib/a2ui/types';
import type { ChatMessage } from '@/lib/chat/types';
import type { DispatchTraceEntry } from '@/lib/chat/types';

export interface AiChatPanelProps {
  /** 页标题（面板头部展示）。 */
  title: string;
  /** 空态提示语。 */
  emptyHint: string;
  /** 快捷提问示例（问数页展示，可空）。 */
  suggestions?: string[];
  /** 路由激活门控：仅当前路由激活时建立连接（避免 keep-alive 双订阅）。 */
  active: boolean;
  /** 智能体展示名（「问数」/「知识库问答」）；气泡尾部「由 X 智能体回答」标签的兜底值。 */
  agentLabel?: string;
}

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

/** dispatch.trace 调度轻提示（仅展示，不暴露 Worker 选择器）。 */
function DispatchTraceHint({ entries }: { entries: DispatchTraceEntry[] }) {
  if (entries.length === 0) return null;
  const latest = entries[entries.length - 1];
  const workerId = latest.worker_id ?? '';
  const status = latest.status ?? '';
  return (
    <div className="mx-3 mt-2 flex items-center gap-2 rounded-md border border-primary/20 bg-primary/5 px-3 py-2 text-xs text-muted-foreground">
      <Sparkles className="h-3.5 w-3.5 shrink-0 text-primary" />
      <span className="truncate">
        {latest.tool ?? '调度'}
        {workerId ? ` · ${workerId}` : ''}
        {status ? ` · ${status}` : ''}
      </span>
    </div>
  );
}

/** 单条消息气泡（user / assistant + kb-sources / tool / a2ui surface）。 */
function ChatBubble({
  message,
  sessionId,
  agentLabel,
  dispatchTrace,
}: {
  message: ChatMessage;
  sessionId: string | null;
  agentLabel?: string;
  dispatchTrace: DispatchTraceEntry[];
}) {
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

  // A2UI surface 消息：渲染 surface 卡片（data-table / entity-select / approval-card / form-sheet）
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

  // 助手正文：剥 kb-sources 围栏 → 正文 Markdown + 引用配图 + 引用折叠
  // 问数（iqd）计划/引用围栏在 kb-sources 之后剥（iqd-plan / iqd-citations）
  let body: ReactNode = message.content;
  let figures: ReactNode = null;
  let sourceList: ReactNode = null;
  let planBlock: ReactNode = null;
  let citationBlock: ReactNode = null;
  let totalMs: number | null = null;
  if (!isUser && message.content) {
    const { body: cleanBody, sources } = splitKbSources(message.content);
    const { body: bodyNoPlan, plan } = splitIqdPlan(cleanBody);
    const { body: bodyNoCitations, citations } = splitIqdCitations(bodyNoPlan);
    body = <MarkdownView content={bodyNoCitations} />;
    figures = <KbChatSourceFigures sources={sources} />;
    sourceList = <KbChatSourceList sources={sources} />;
    if (plan.length > 0) {
      // 本轮总耗时 = plan[].duration_ms 求和（数值一致性由 orchestrator 计时保证）
      totalMs = plan.reduce((acc, s) => acc + (s.duration_ms ?? 0), 0);
      planBlock = <IqdPlanSteps steps={plan} totalMs={totalMs} />;
    }
    if (citations.length > 0) {
      citationBlock = <IqdCitationBlock citations={citations} />;
    }
  }

  // 智能体路由归属：message.agentId ?? dispatchTrace.worker_id ?? agentLabel（feedback-enhance §2.4）。
  const latestWorkerId =
    dispatchTrace.length > 0 ? dispatchTrace[dispatchTrace.length - 1].worker_id : undefined;
  const agentDisplay = message.agentId ?? latestWorkerId ?? agentLabel;
  // 评价按钮仅挂已完成（非 streaming）的助手正文气泡。
  const showFeedback = !isUser && message.status !== 'streaming';

  return (
    <div className={cn('flex', isUser ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'max-w-[88%] rounded-lg px-3 py-2 text-sm',
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
            body
          )
        ) : (
          <span className="text-muted-foreground">…</span>
        )}
        {figures}
        {sourceList}
        {planBlock}
        {citationBlock}
        {!isUser && agentDisplay ? (
          <div className="mt-2 flex items-center gap-1.5">
            <Badge variant="secondary" className="gap-1 text-[11px]">
              <Sparkles className="h-3 w-3 text-primary" />
              由 {agentDisplay} 智能体回答
            </Badge>
          </div>
        ) : null}
        {showFeedback ? (
          <IqdFeedbackButtons
            sessionId={message.backendSessionId ?? sessionId}
            backendMessageId={message.backendMessageId}
            agentLabel={agentDisplay}
          />
        ) : null}
      </div>
    </div>
  );
}

/**
 * A2UI 对话面板：路由激活时建立 SSE/WS 连接，展示消息 + 动态界面 + 输入。
 */
export function AiChatPanel({
  title,
  emptyHint,
  suggestions = [],
  active,
  agentLabel,
}: AiChatPanelProps) {
  const location = useLocation();
  const chat = useChat({ autoConnect: active });
  const [input, setInput] = useState('');
  const dispatchTrace = useChatStore((s) => s.dispatchTrace);
  const connectionState = useChatStore((s) => s.connectionState);

  // 路由激活时确保会话存在（本地生成 + 持久化）；离开时不断开已建立的会话
  useEffect(() => {
    if (!active) return;
    void chat.ensureSession();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, location.pathname]);

  const canSend = active && !chat.isGenerating && input.trim().length > 0;

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
    switch (connectionState) {
      case 'connected':
        return <Badge variant="success">已连接</Badge>;
      case 'connecting':
      case 'reconnecting':
        return (
          <Badge variant="warning">
            <Loader2 className="h-3 w-3 animate-spin" />
            {connectionState === 'connecting' ? '连接中' : '重连中'}
          </Badge>
        );
      case 'error':
        return <Badge variant="destructive">连接异常</Badge>;
      default:
        return <Badge variant="secondary">未连接</Badge>;
    }
  }, [connectionState]);

  if (!active) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center text-sm text-muted-foreground">
        切换到本页后开始对话…
      </div>
    );
  }

  return (
    <A2uiProvider dispatchAction={chat.dispatchA2uiAction}>
      <div className="flex min-h-0 flex-1 flex-col rounded-lg border bg-card">
        {/* 头部 */}
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-4 py-2.5">
          <Sparkles className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold">{title}</span>
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
          <div className="mx-3 mt-2 flex items-start justify-between gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            <span className="break-all">{chat.error}</span>
            <button
              type="button"
              aria-label="关闭提示"
              className="shrink-0 rounded-md p-0.5 text-muted-foreground hover:text-foreground"
              onClick={() => useChatStore.getState().setError(null)}
            >
              ×
            </button>
          </div>
        ) : null}

        {/* 调度轻提示 */}
        <DispatchTraceHint entries={dispatchTrace} />

        {/* 消息区：单层滚动，禁内层滚动 */}
        <div className="min-h-0 flex-1 overflow-auto px-3 py-3">
          {chat.messages.length === 0 && !chat.isGenerating ? (
            <div className="flex h-full min-h-[14rem] flex-col items-center justify-center gap-3">
              <p className="max-w-md text-center text-sm text-muted-foreground">{emptyHint}</p>
              {suggestions.length > 0 ? (
                <div className="flex max-w-lg flex-wrap justify-center gap-2">
                  {suggestions.map((s) => (
                    <button
                      key={s}
                      type="button"
                      className="rounded-full border border-border bg-background px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
                      onClick={() => {
                        chat.sendMessage(s);
                      }}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ) : (
            <div className="space-y-3">
              {chat.messages.map((msg) => (
                <ChatBubble
                  key={msg.id}
                  message={msg}
                  sessionId={chat.sessionId}
                  agentLabel={agentLabel}
                  dispatchTrace={dispatchTrace}
                />
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
            {connectionState === 'connected' ? '已直连 Agent 网关 · 界面由 A2UI 动态生成' : '等待连接…'}
          </p>
        </div>
      </div>
    </A2uiProvider>
  );
}

export default AiChatPanel;
