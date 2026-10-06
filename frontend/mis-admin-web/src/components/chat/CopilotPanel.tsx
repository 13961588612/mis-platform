/**
 * CopilotPanel — 原生 AI Copilot 对话面板（T06'）。
 *
 * <p>02 文档 §1 T06'：废弃 iframe（CopilotH5Frame），原生 Sheet + ChatShell + SSE 直连
 * Gateway。本组件由 `components/layout/copilot-panel.tsx` 经 React.lazy 按需加载
 * （Sheet 打开才拉 chat-core + A2UI 渲染层 chunk）。
 *
 * <p>职责：对话消息渲染 + A2UI Surface 渲染（A2uiProvider + SurfaceRenderer）
 * + 输入发送 + 会话管理。chat-core（useChat）与 A2UI 渲染层全量在本 chunk 内。
 *
 * <p>**放大模式（问题 3）**：组件通过 `expanded` 在「普通聊天」与「放大全屏」间切换布局——
 * 放大时左侧渲染「会话列表侧栏」+ 右侧聊天主区（并排）；普通时只显示聊天主区。
 * 会话列表调用 `listSessions()` 拉取最近会话，支持「新建会话」与「点击切换会话」，
 * 切换时 `closeSession()` 清空当前、`ensureSession(id)` 开新会话；本地无后端时降级空列表。
 */

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
} from 'react';
import {
  Loader2,
  Maximize2,
  MessageSquarePlus,
  Minimize2,
  PanelLeftClose,
  PanelLeftOpen,
  Paperclip,
  Plus,
  SendHorizonal,
  Sparkles,
  X,
} from 'lucide-react';
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
import { AssistantAvatar, UserAvatar } from '@/components/chat/CopilotAvatars';
import { MessageFeedbackBar } from '@/components/chat/MessageFeedbackBar';
import { SurfaceRenderer } from '@/lib/a2ui/SurfaceRenderer';
import { useSurfaceStore } from '@/lib/a2ui/surface-store';
import { A2uiProvider } from '@/components/a2ui/A2uiProvider';
import { A2uiPermissionGate } from '@/components/a2ui/A2uiPermissionGate';
import { getA2uiRegistryEntry, isKnownA2uiComponent } from '@/components/a2ui/registry';
import { normalizeNewlines } from '@/components/a2ui/components/A2uiText';
import {
  KbChatSourceFigures,
  KbChatSourceList,
  extractKbSourcesFromA2uiNodes,
  mergeKbSources,
  splitKbSources,
} from '@/components/common/kb-chat-sources';
import { KbSourceHostProvider } from '@/components/common/kb-source-host-context';
import type { A2uiComponentName } from '@/lib/a2ui/types';
import type { ChatMessage } from '@/lib/chat/types';
import { useAuthStore } from '@/stores/auth-store';
import { listSessions } from '@/features/agent/api/agent-ops-api';
import { formatTime, type Session } from '@/features/agent/types';

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

export interface CopilotPanelProps {
  /** 是否处于放大全屏模式（由 layout 层控制）。 */
  expanded?: boolean;
  /** 切换放大 / 还原。 */
  onToggleExpanded: () => void;
  /** 放大模式下「关闭 Copilot」的回调（回到普通关闭态）。 */
  onRequestClose?: () => void;
}

/** 左侧会话列表侧栏（仅放大模式渲染）。无后端时降级为空列表 + 仅「新建会话」。 */
function SessionSidebar({
  sessions,
  loading,
  activeSessionId,
  collapsed,
  onToggleCollapsed,
  onNewSession,
  onSelectSession,
  onClose,
}: {
  sessions: Session[];
  loading: boolean;
  activeSessionId: string | null;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onNewSession: () => void;
  onSelectSession: (session: Session) => void;
  onClose: () => void;
}) {
  // 已折叠：渲染细条 + 展开按钮
  if (collapsed) {
    return (
      <div className="flex w-12 shrink-0 flex-col items-center gap-2 border-r bg-muted/30 py-2">
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="h-8 w-8"
          title="展开会话列表"
          onClick={onToggleCollapsed}
        >
          <PanelLeftOpen className="h-4 w-4" />
        </Button>
      </div>
    );
  }

  return (
    <div className="flex w-[280px] shrink-0 flex-col border-r bg-muted/30">
      <div className="flex shrink-0 items-center gap-2 border-b px-3 py-2.5">
        <span className="text-sm font-semibold">会话</span>
        <span className="ml-auto flex items-center gap-1">
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            title="新建会话"
            onClick={onNewSession}
          >
            <Plus className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            title="收起会话列表"
            onClick={onToggleCollapsed}
          >
            <PanelLeftClose className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            title="关闭 Copilot"
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </Button>
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-2">
        {loading ? (
          <p className="px-2 py-4 text-center text-xs text-muted-foreground">加载中…</p>
        ) : sessions.length === 0 ? (
          <p className="px-2 py-4 text-center text-xs text-muted-foreground">
            暂无历史会话，点击右上角「+」新建
          </p>
        ) : (
          <ul className="space-y-1">
            {sessions.map((s) => {
              const active = s.session_id === activeSessionId;
              return (
                <li key={s.session_id}>
                  <button
                    type="button"
                    onClick={() => onSelectSession(s)}
                    className={cn(
                      'w-full rounded-md border px-2.5 py-2 text-left text-xs transition-colors',
                      active
                        ? 'border-primary/40 bg-primary/5'
                        : 'border-transparent hover:bg-background',
                    )}
                  >
                    <div className="truncate font-medium text-foreground">
                      {s.title || s.agent_name || '未命名会话'}
                    </div>
                    <div className="mt-0.5 text-[11px] text-muted-foreground">
                      {formatTime(s.updated_at)} · {s.message_count} 条
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

export function CopilotPanel({
  expanded = false,
  onToggleExpanded,
  onRequestClose,
}: CopilotPanelProps) {
  const chat = useChat();
  const { closeSession, ensureSession, switchSession } = chat;
  const composer = useAttachmentComposer();
  const activeSurfaceId = useSurfaceStore((s) => s.activeSurfaceId);
  const [input, setInput] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  // 放大模式：会话列表状态（仅放大时拉取，避免普通模式无谓请求）
  const [sessions, setSessions] = useState<Session[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  /** 用于检测「生成结束」以便刷新侧栏时间/标题。 */
  const wasGeneratingRef = useRef(false);

  const loadSessions = async (): Promise<void> => {
    setSessionsLoading(true);
    try {
      const page = await listSessions({ page: 1, page_size: 50 });
      const items = Array.isArray(page.items) ? page.items : [];
      // Copilot 侧栏不展示空会话：ensure_session / 新建会立刻落库，否则每连一次就多一条「未命名」。
      setSessions(items.filter((s) => (s.message_count ?? 0) > 0));
    } catch {
      // 本地无后端 / 未登录 / 接口失败 → 降级空列表，不白屏
      setSessions([]);
    } finally {
      setSessionsLoading(false);
    }
  };

  useEffect(() => {
    if (expanded) void loadSessions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded]);

  // 本轮对话结束后刷新列表：更新当前项 updated_at / title / message_count，并去掉新产生的空壳
  useEffect(() => {
    if (!expanded) {
      wasGeneratingRef.current = chat.isGenerating;
      return;
    }
    if (wasGeneratingRef.current && !chat.isGenerating) {
      void loadSessions();
    }
    wasGeneratingRef.current = chat.isGenerating;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chat.isGenerating, expanded]);

  /** 新建会话：清空当前 → 强制新 sid（勿复用 localStorage）。空会话不进侧栏，无需立刻 loadSessions。 */
  const handleNewSession = (): void => {
    closeSession();
    void ensureSession(undefined, { forceNew: true });
  };

  /** 切换会话：软切换（不经 sessionId=null）并强制重拉历史。 */
  const handleSelectSession = (session: Session): void => {
    void switchSession(session.session_id);
  };

  /**
   * surface 已进 store 但尚未挂到气泡时，用兜底渲染避免「有回包界面空白」。
   * done 后会 scope 成 `{liveId}__msg__{messageId}`，此时 live active 仍可能残留，
   * 不得再当 orphan 裸渲（否则会出现「有气泡 + 无气泡」两遍）。
   */
  const orphanSurface =
    activeSurfaceId != null &&
    !chat.messages.some((m) => {
      if (!m.surfaceId) return false;
      if (m.surfaceId === activeSurfaceId) return true;
      return m.surfaceId.startsWith(`${activeSurfaceId}__msg__`);
    });

  // 打开面板即确保会话存在（本地生成 + 持久化 + 自动加载历史）
  useEffect(() => {
    void ensureSession();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 新消息 / 流式更新 / 思考态 → 滚到底部
  const lastContentLen =
    chat.messages.length > 0 ? (chat.messages[chat.messages.length - 1]?.content?.length ?? 0) : 0;
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
  }, [chat.messages.length, lastContentLen, chat.isGenerating, orphanSurface]);

  const canSend =
    !chat.isGenerating &&
    !composer.hasUploading &&
    (input.trim().length > 0 || composer.attachments.length > 0) &&
    chat.connectionState !== 'connecting';

  const handleSend = (): void => {
    if (!canSend) return;
    const ready = composer.attachments.filter((a) => a.status === 'done');
    const text = input.trim();
    const sid = chat.sessionId;
    chat.sendMessage(input, ready.length > 0 ? ready : undefined);
    setInput('');
    composer.clear();

    // 侧栏即时反馈：当前会话置顶并刷新时间；首条用户问题作标题（done 后再 loadSessions 对齐服务端）
    if (expanded && sid) {
      const now = new Date().toISOString();
      const titleSeed = text.replace(/\s+/g, ' ').slice(0, 60);
      setSessions((prev) => {
        const idx = prev.findIndex((s) => s.session_id === sid);
        if (idx >= 0) {
          const cur = prev[idx]!;
          const updated: Session = {
            ...cur,
            title: cur.title?.trim() ? cur.title : titleSeed || cur.title,
            updated_at: now,
            message_count: Math.max(cur.message_count ?? 0, 0) + 1,
          };
          return [updated, ...prev.slice(0, idx), ...prev.slice(idx + 1)];
        }
        if (!titleSeed && ready.length === 0) return prev;
        const created: Session = {
          session_id: sid,
          agent_id: chat.agentId ?? '',
          channel: 'web',
          title: titleSeed || '（附件）',
          message_count: 1,
          created_at: now,
          updated_at: now,
        };
        return [created, ...prev];
      });
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key !== 'Enter' || e.shiftKey) return;
    e.preventDefault();
    handleSend();
  };

  // 粘贴图片自动转附件（P0-1.3）
  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>): void => {
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
        className={cn(
          'relative flex h-full min-h-0',
          expanded ? 'flex-row' : 'flex-col',
          dragOver && 'ring-2 ring-primary/60',
        )}
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

        {/* 放大模式：左侧会话列表侧栏（可折叠） */}
        {expanded ? (
          <SessionSidebar
            sessions={sessions}
            loading={sessionsLoading}
            activeSessionId={chat.sessionId}
            collapsed={sidebarCollapsed}
            onToggleCollapsed={() => setSidebarCollapsed((v) => !v)}
            onNewSession={handleNewSession}
            onSelectSession={handleSelectSession}
            onClose={onRequestClose ?? (() => undefined)}
          />
        ) : null}

        {/* 右侧 / 下方：聊天主区 */}
        <div className="flex min-h-0 flex-1 flex-col">
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
              title={expanded ? '还原' : '放大'}
              onClick={onToggleExpanded}
            >
              {expanded ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
            </Button>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="h-7 w-7"
              title="新建会话"
              onClick={handleNewSession}
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

          {/* 消息区：单层滚动，禁内层滚动（放大模式宽度自适应，不强制收窄） */}
          <div className="min-h-0 flex-1 overflow-auto px-3 py-3">
            {chat.historyState === 'loading' ? (
              // 历史加载骨架屏（P0-2.1）：含头像占位，避免「提问头像消失」的错觉
              <div className="space-y-3">
                {[0, 1, 2].map((i) => (
                  <div
                    key={`bubble-skel-${i}`}
                    className={cn(
                      'flex items-start gap-3',
                      i % 2 === 0 ? 'justify-end' : 'justify-start',
                    )}
                  >
                    {i % 2 !== 0 ? (
                      <div className="mt-0.5 h-8 w-8 shrink-0 animate-pulse rounded-full bg-muted/60" />
                    ) : null}
                    <div className="h-12 w-2/3 animate-pulse rounded-lg bg-muted/60" />
                    {i % 2 === 0 ? (
                      <div className="mt-0.5 h-8 w-8 shrink-0 animate-pulse rounded-full bg-muted/60" />
                    ) : null}
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
                {chat.messages.map((msg, index) => {
                  const emptyAssistant =
                    msg.role === 'assistant' &&
                    !(msg.content?.trim()) &&
                    !msg.surfaceId &&
                    !msg.a2ui;
                  const laterHasPayload =
                    emptyAssistant &&
                    chat.messages.slice(index + 1).some(
                      (m) =>
                        m.role === 'assistant' &&
                        (Boolean(m.surfaceId) ||
                          Boolean(m.a2ui) ||
                          (m.content?.trim().length ?? 0) > 0),
                    );
                  return (
                    <ChatBubble
                      key={msg.role + "-" + msg.id + "-" + index}
                      message={msg}
                      hideEmptyDuplicate={laterHasPayload}
                    />
                  );
                })}
                {orphanSurface ? <SurfaceRenderer className="w-full" /> : null}
                {chat.isGenerating &&
                !chat.messages.some(
                  (m) =>
                    m.role === 'assistant' &&
                    (m.status === 'streaming' ||
                      Boolean(m.surfaceId) ||
                      Boolean(m.a2ui) ||
                      (m.content?.trim().length ?? 0) > 0),
                ) ? (
                  <div className="flex items-start gap-3 py-1">
                    <AssistantAvatar className="mt-0.5 h-8 w-8" />
                    <div className="flex items-center gap-2 rounded-2xl border bg-card px-3.5 py-2.5 text-xs text-muted-foreground shadow-sm">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      正在思考…
                    </div>
                  </div>
                ) : null}
                <div ref={messagesEndRef} />
              </div>
            )}
          </div>

          {/* 输入区：白底面板；附件/发送为右下角圆形图标 */}
          <div
            className={cn(
              'shrink-0 px-3 py-3',
              expanded && 'flex flex-col items-center',
            )}
          >
            <div
              className={cn(
                'w-full rounded-2xl border border-border/70 bg-white p-3 text-foreground shadow-sm',
                expanded && 'w-[60%] min-w-[min(100%,32rem)]',
              )}
            >
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
              <Textarea
                rows={2}
                value={input}
                disabled={chat.isGenerating}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={onKeyDown}
                onPaste={onPaste}
                placeholder="输入消息，Enter 发送，Shift+Enter 换行；可拖拽或粘贴图片"
                className="min-h-[3.25rem] w-full resize-none border-0 bg-transparent p-0 shadow-none focus-visible:ring-0"
              />
              <div className="mt-2 flex items-center justify-end gap-1.5">
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="h-9 w-9 shrink-0 rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
                  title="添加附件"
                  aria-label="添加附件"
                  disabled={!composer.canAddMore || chat.isGenerating}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Paperclip className="h-4 w-4" />
                </Button>
                <Button
                  type="button"
                  size="icon"
                  className={cn(
                    'h-9 w-9 shrink-0 rounded-full',
                    chat.isGenerating && 'disabled:opacity-100',
                  )}
                  disabled={!canSend}
                  title={chat.isGenerating ? '生成中…' : '发送'}
                  aria-label={chat.isGenerating ? '生成中' : '发送'}
                  aria-busy={chat.isGenerating}
                  onClick={handleSend}
                >
                  {chat.isGenerating ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <SendHorizonal className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </div>
            <p
              className={cn(
                'mt-1.5 text-[11px] text-muted-foreground',
                expanded ? 'w-[60%] min-w-[min(100%,32rem)] text-center' : undefined,
              )}
            >
              {chat.connectionState === 'connected'
                ? '已直连 Agent 网关 · 界面由 A2UI 动态生成'
                : '等待连接…'}
            </p>
          </div>
        </div>
      </div>
    </A2uiProvider>
  );
}

/** 单条消息气泡（对齐 ai-platform/frontend：头像 + Markdown 分块 + kb-sources 折叠）。 */
function ChatBubble({
  message,
  hideEmptyDuplicate,
}: {
  message: ChatMessage;
  /** 后面已有带内容的助手气泡时，隐藏本条空气泡（避免双「正在思考」）。 */
  hideEmptyDuplicate?: boolean;
}) {
  const userLabel =
    useAuthStore((s) => s.user?.realName || s.user?.username) ?? null;
  const surface = useSurfaceStore((s) =>
    message.surfaceId ? s.surfaces[message.surfaceId] : undefined,
  );

  const isUser = message.role === 'user';
  const isStreaming = !isUser && message.role !== 'tool' && message.status === 'streaming';
  const rawContent = normalizeNewlines(
    typeof message.content === 'string' ? message.content : String(message.content ?? ''),
  );
  const contentSplit =
    !isUser && message.role !== 'tool'
      ? splitKbSources(rawContent)
      : { body: rawContent, sources: [] as ReturnType<typeof splitKbSources>['sources'] };
  const surfaceSources =
    !isUser && surface?.components
      ? extractKbSourcesFromA2uiNodes(surface.components)
      : [];
  const sources = mergeKbSources(contentSplit.sources, surfaceSources);
  const body = contentSplit.body;

  // 仅隐藏「空助手」重复气泡；用户 / 系统消息绝不能被藏掉
  if (hideEmptyDuplicate && message.role === 'assistant') {
    return null;
  }

  if (message.role === 'tool') {
    return (
      <div className="flex items-start gap-3 py-1">
        <AssistantAvatar className="mt-0.5 h-8 w-8" />
        <div className="max-w-[85%] rounded-2xl border border-border/60 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          <div className="font-medium">⚙ {message.toolName ?? '工具调用'}</div>
          {message.toolArgs ? (
            <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap break-all text-[11px]">
              {message.toolArgs}
            </pre>
          ) : null}
        </div>
      </div>
    );
  }

  // 旧协议 ui.render（无正文、无 surface）
  if (message.a2ui && !message.content && !message.surfaceId) {
    return (
      <div className="flex items-start gap-3 py-1">
        <AssistantAvatar className="mt-0.5 h-8 w-8" />
        {/* A2UI 宽表/详情卡需要占满气泡可用宽度，避免再被 85% 二次挤压 */}
        <div className="min-w-0 w-full max-w-full">
          <A2uiMessageRenderer render={message.a2ui} />
        </div>
      </div>
    );
  }

  const hasSurface = Boolean(message.surfaceId) || Boolean(message.a2ui);
  const showThinkingPlaceholder =
    !isUser && isStreaming && body.trim().length === 0 && !hasSurface && sources.length === 0;

  const showBody = isUser
    ? Boolean(
        rawContent.trim() &&
          rawContent !== '（附件）' &&
          !(message.attachments?.length && rawContent.startsWith('（用户发送了附件）')),
      )
    : body.trim().length > 0 || showThinkingPlaceholder || hasSurface;

  const showEmptyDeliveredHint =
    !isUser &&
    !isStreaming &&
    body.trim().length === 0 &&
    !hasSurface &&
    sources.length === 0 &&
    message.status === 'delivered';

  const bubble = (
    <div
      className={cn(
        'rounded-2xl px-3.5 py-2.5 text-sm',
        // 含 A2UI/Surface 时占满行宽，避免 data-table 在 85% 气泡内被压扁
        isUser || !hasSurface ? 'max-w-[85%]' : 'min-w-0 w-full max-w-full',
        isUser
          ? 'bg-primary text-primary-foreground'
          : 'border bg-card text-foreground shadow-sm',
        message.status === 'error' && 'border-destructive/50 text-destructive',
      )}
    >
      <KbSourceHostProvider mode="host">
        {isUser ? (
          showBody ? (
            <p className="whitespace-pre-wrap break-words text-primary-foreground">{rawContent}</p>
          ) : message.attachments && message.attachments.length > 0 ? null : (
            <p className="text-xs text-primary-foreground/70">（无文本）</p>
          )
        ) : showBody || showEmptyDeliveredHint ? (
          <div className="space-y-1">
            {body.trim().length > 0 ? (
              <MarkdownView content={body} className="prose prose-sm max-w-none dark:prose-invert" />
            ) : showEmptyDeliveredHint ? (
              <p className="text-xs text-muted-foreground">未收到有效回复，可重试提问</p>
            ) : showThinkingPlaceholder ? (
              <div className="flex items-center gap-1 text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                <span>正在思考…</span>
              </div>
            ) : null}
            {isStreaming && body.trim().length > 0 ? (
              <span className="inline-block h-4 w-1.5 animate-pulse rounded-sm bg-foreground/40 align-middle" />
            ) : null}
          </div>
        ) : null}

        {message.attachments && message.attachments.length > 0 ? (
          <AttachmentList
            attachments={message.attachments}
            className={cn('mt-2', isUser ? 'justify-end' : 'justify-start')}
          />
        ) : null}

        {!isUser && message.a2ui ? (
          <div className="mt-2">
            <A2uiMessageRenderer render={message.a2ui} />
          </div>
        ) : null}

        {!isUser && message.surfaceId ? (
          <div className={cn(body.trim().length > 0 || showThinkingPlaceholder ? 'mt-2' : undefined)}>
            <SurfaceRenderer surfaceId={message.surfaceId} />
          </div>
        ) : null}

        {!isUser && sources.length > 0 ? (
          <>
            <KbChatSourceFigures sources={sources} />
            <KbChatSourceList sources={sources} />
          </>
        ) : null}

        {!isUser && message.status === 'delivered' ? (
          <MessageFeedbackBar message={message} />
        ) : null}

        {message.status === 'error' ? (
          <div className="mt-1 text-xs text-destructive">回复失败，可重试</div>
        ) : null}
      </KbSourceHostProvider>
    </div>
  );

  if (isUser) {
    return (
      <div className="flex items-start justify-end gap-3 py-1">
        {bubble}
        <UserAvatar name={userLabel} className="mt-0.5 h-8 w-8" />
      </div>
    );
  }

  return (
    <div className="flex items-start gap-3 py-1">
      <AssistantAvatar className="mt-0.5 h-8 w-8" />
      {bubble}
    </div>
  );
}

export default CopilotPanel;
