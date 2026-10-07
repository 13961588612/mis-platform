/**
 * chat-core 事件协议类型（T06' 迁入 mis-admin-web）。
 *
 * <p>按 A2UI 最终方案口径（docs/ai-fusion/a2ui/02-task-breakdown.md §4 共享知识）：
 * 事件协议 = AG-UI BaseEvent + ACTIVITY_SNAPSHOT（A2UI 渲染指令）+ dispatch.trace 自定义事件。
 * Gateway `EventConverter.baseEventToFrontendMessage` 将 BaseEvent 转为前端 SSE/WS 消息：
 * <pre>
 *   ACTIVITY_SNAPSHOT  → { type: 'a2ui_surface', operations: [...] }
 *   TEXT_MESSAGE_CHUNK → { type: 'stream', content: '...' }
 *   RUN_FINISHED       → { type: 'done' }
 *   RUN_ERROR          → { type: 'error', message: '...' }
 * </pre>
 *
 * <p>兼容旧协议（agent_event envelope 内嵌 text.delta / tool.call / ui.render /
 * approval.request / dispatch.trace / error / done），由 `adaptAgentEvent` 归一化。
 */

// ------------------------------------------------------------------ 对话消息

/** 消息角色（与 MIS agent-ops 口径一致）。 */
export type ChatRole = 'user' | 'assistant' | 'system' | 'tool';

/**
 * 附件（P0-1「先传后引」）。
 *
 * <p>前端上传后拿回 {@code fileId/url}，随文本经 WS 上行放入
 * {@link InboundMessage.metadata.attachments}；历史恢复时由
 * {@link SessionMessage.metadata.attachments} 映射而来。{@code url} 为
 * BFF 同源代理路径（见架构文档 §8），禁止直连 ai-platform 内网。
 * {@code status} 仅本地发送态用，落库 / 历史恢复时恒为 {@code 'done'}。
 */
export interface Attachment {
  /** ai-platform 返回的文件 UUID。 */
  fileId: string;
  /** 原始文件名。 */
  name: string;
  /** MIME 类型（image/png / application/pdf ...）。 */
  mimeType: string;
  /** 字节大小。 */
  size: number;
  /** 经 BFF 同源代理的下载路径（如 /api/v1/agent-ops/files/{id}）。 */
  url: string;
  /** 本地发送态：uploading 上传中 / done 完成 / error 失败。 */
  status: 'uploading' | 'done' | 'error';
}

/** 消息渲染状态。 */
export type MessageStatus = 'sending' | 'streaming' | 'delivered' | 'error';

/** 单条对话消息（camelCase 前端形态）。 */
export interface ChatMessage {
  id: string;
  sessionId: string;
  role: ChatRole;
  content: string;
  status: MessageStatus;
  timestamp: string;
  /** 产生该消息的 Agent ID（assistant 消息可选）。 */
  agentId?: string;
  /** 后端消息 UUID（SSE done 帧 messageId；评价锚点，缺失时评价按钮禁用）。 */
  backendMessageId?: string;
  /** 后端平台会话 UUID（SSE done 帧 sessionId；与本地会话 id 不同，评价提交路径参数）。 */
  backendSessionId?: string;
  /** 工具名（tool 消息）。 */
  toolName?: string;
  /** 工具入参摘要（tool 消息）。 */
  toolArgs?: string;
  /** 错误信息（status=error）。 */
  error?: string;
  /** A2UI 渲染描述（旧协议 ui.render 兼容，surfaceId 定位新协议 surface）。 */
  a2ui?: {
    component: string;
    props: Record<string, unknown>;
  };
  /** 关联的 A2UI Surface ID（a2ui_surface 事件渲染的卡片挂在消息上）。 */
  surfaceId?: string;
  /** 附件（P0-1，仅本地渲染 / 历史恢复展示；WS 上行经 metadata.attachments，向后兼容 optional）。 */
  attachments?: Attachment[];
  /** 点赞 / 吐槽；未评价为 undefined。 */
  feedback?: {
    rating: 'up' | 'down';
    comment?: string | null;
  };
}

// ------------------------------------------------------------------ 流式事件（Gateway → 前端）

/** dispatch.trace 单条记录（Coordinator→Worker 调度轨迹，snake_case 端到端保留）。 */
export interface DispatchTraceEntry {
  intent?: string;
  worker_id?: string;
  tool?: string;
  status?: string;
  latency_ms?: number;
  task_id?: string;
  brief_rejected?: boolean;
}

/** dispatch.trace 载荷：固定形状 `{ entries: [...] }`。 */
export interface DispatchTracePayload {
  entries: DispatchTraceEntry[];
}

/** 单轮 token 用量。 */
export interface TokenUsage {
  prompt: number;
  completion: number;
  total: number;
}

/**
 * 前端流式事件（Gateway EventConverter 输出或旧协议归一化后）。
 *
 * <p>`type` 区分：
 * - `stream`：文本增量（TEXT_MESSAGE_CHUNK）
 * - `a2ui_surface`：A2UI 渲染指令（ACTIVITY_SNAPSHOT，operations 见 lib/a2ui/types）
 * - `dispatch.trace`：自定义事件透传
 * - `done` / `error`：run 生命周期
 * - `text.delta` / `tool.call` / `tool.result` / `ui.render` / `approval.request`：旧协议兼容
 */
export type ChatStreamEvent =
  | { type: 'stream'; content: string }
  | { type: 'a2ui_surface'; operations: import('../a2ui/types').A2uiOperation[]; surfaceId?: string }
  | { type: 'dispatch.trace'; trace: DispatchTracePayload }
  | { type: 'done'; tokenUsage?: TokenUsage; messageId?: string; sessionId?: string }
  | { type: 'error'; errorCode?: string; message: string }
  | { type: 'text.delta'; content?: string }
  | { type: 'tool.call'; toolName?: string; args?: Record<string, unknown> }
  | { type: 'tool.result'; toolName?: string; result?: Record<string, unknown> }
  | { type: 'ui.render'; component?: string; props?: Record<string, unknown> }
  | { type: 'approval.request'; skillId?: string; detail?: Record<string, unknown> };

/** SSE 原始行载荷（可能带 envelope）。 */
export interface RawStreamLine {
  type?: string;
  event?: ChatStreamEvent;
  data?: unknown;
  [key: string]: unknown;
}

// ------------------------------------------------------------------ 入站消息（前端 → Gateway，WebSocket）

/** 审批决策。 */
export type ApprovalDecision = 'approved' | 'rejected';

/** 实体选择动作。 */
export type EntitySelectAction = 'confirm' | 'manual' | 'cancel';

/**
 * WebSocket 入站消息（对齐 Gateway /ws/chat 处理器与旧 H5 协议）。
 * 发送通道 = `/ws/chat`（MIS RS256 JWT 经 query token 注入）。
 */
export interface InboundMessage {
  type:
    | 'chat'
    | 'approval'
    | 'entity_select'
    | 'a2ui_action'
    | 'generation.cancel'
    | 'ping'
    | 'session.close';
  sessionId: string;
  /** P4 身份不受信：Gateway 只认 JWT 验签结果，userId 仅供参考。 */
  userId?: string;
  agentId?: string;
  content?: string;
  messageType?: string;
  /** generation.cancel 可选：对应当前 A2UI runId。 */
  runId?: string;
  metadata?: {
    /** A2UI opt-in 标记。 */
    a2ui?: boolean;
    /** 附件引用（P0-1「先传后引」：上传后拿 fileId 随文本上行；向下兼容，存量 text 通道不携）。 */
    attachments?: Array<{ fileId: string; name: string; mimeType: string; size: number; url: string }>;
    [key: string]: unknown;
  };
  approvalResponse?: {
    approvalId: string;
    decision: ApprovalDecision;
    comment?: string;
  };
  entitySelectResponse?: {
    resumeToken: string;
    selectedCandidate?: Record<string, unknown>;
    action: EntitySelectAction;
  };
  /** A2UI 用户操作回传（02 文档 §4：`{ type: 'a2ui_action', action: A2uiClientAction }`）。 */
  action?: import('../a2ui/types').A2uiClientAction;
  timestamp: string;
}

/**
 * 历史会话消息（P0-2 复用 #29 端点 {@code GET /api/v1/agent-ops/sessions/{id}/messages}）。
 *
 * <p>对齐 ai-platform `MessageResponse`：时间字段 {@code timestamp}（非 created_at），
 * 附加信息在 {@code metadata}（非 meta）。与 `features/agent/types` 的 `SessionMessage`
 * 同形但自持于 chat-core，避免 Copilot 耦合运营调试台类型定义。历史恢复时由
 * {@link mapSessionMessage} 映射为 {@link ChatMessage}（含 attachments + A2UI 还原）。
 */
export interface SessionMessage {
  id: string;
  session_id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  timestamp: string;
  metadata?: {
    /** 附件引用（与上行 metadata.attachments 同形）。 */
    attachments?: Array<{ fileId: string; name: string; mimeType: string; size: number; url: string }>;
    /** 其他历史 metadata 原样透传（A2UI 渲染指令等）。 */
    [key: string]: unknown;
  };
}

/** 历史恢复：单条 SessionMessage → ChatMessage 的映射函数签名。 */
export type SessionMessageMapper = (raw: SessionMessage) => ChatMessage;

// ------------------------------------------------------------------ 连接状态

/** chat-core 连接状态（SSE 接收 + WS 发送）。 */
export type ChatConnectionState =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'error'
  | 'closed';

/** 会话创建/恢复结果。 */
export interface SessionHandle {
  sessionId: string;
  agentId?: string;
}

/** 历史加载状态（P0-2 三态：加载中 / 已加载 / 失败降级空会话）。 */
export type ChatHistoryState = 'idle' | 'loading' | 'loaded' | 'error';

/** chat-core 暴露给 UI 的接口。 */
export interface UseChatReturn {
  sessionId: string | null;
  agentId: string | null;
  messages: ChatMessage[];
  connectionState: ChatConnectionState;
  isGenerating: boolean;
  error: string | null;
  /** 历史加载状态（P0-2）。 */
  historyState: ChatHistoryState;
  sendMessage: (content: string, attachments?: Attachment[]) => void;
  respondToApproval: (approvalId: string, decision: ApprovalDecision, comment?: string) => void;
  respondToEntitySelect: (data: {
    resumeToken: string;
    selectedCandidate?: Record<string, unknown>;
    action: EntitySelectAction;
  }) => void;
  dispatchA2uiAction: (action: import('../a2ui/types').A2uiClientAction) => void;
  /**
   * 确保存在会话 id（本地生成 + 持久化；Gateway 接受客户端 sessionId）。
   * 传入 `preferredSessionId` 时直接复用该会话（用于"切换会话"），否则复用
   * localStorage 记忆或生成本地新会话。
   * `options.forceNew=true` 时忽略已有 session 与 localStorage，强制生成新 sid（「新建会话」）。
   */
  ensureSession: (
    preferredSessionId?: string,
    options?: { forceNew?: boolean },
  ) => Promise<string>;
  /** P0-2 拉取历史并渲染（404 / 失败降级空会话不阻塞）。 */
  loadHistory: () => Promise<void>;
  /** 会话列表切换：不清成 null 中间态，强制重拉历史。 */
  switchSession: (sessionId: string) => Promise<void>;
  /** 主动停止当前生成（WS generation.cancel + 本地解锁）。 */
  stopGenerating: () => void;
  closeSession: () => void;
  reconnect: () => void;
}

/** 生成唯一 id（消息 / 本地会话）。 */
export function generateClientId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
