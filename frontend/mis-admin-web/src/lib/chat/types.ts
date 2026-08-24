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
    | 'ping'
    | 'session.close';
  sessionId: string;
  /** P4 身份不受信：Gateway 只认 JWT 验签结果，userId 仅供参考。 */
  userId?: string;
  agentId?: string;
  content?: string;
  messageType?: string;
  metadata?: Record<string, unknown>;
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

/** chat-core 暴露给 UI 的接口。 */
export interface UseChatReturn {
  sessionId: string | null;
  agentId: string | null;
  messages: ChatMessage[];
  connectionState: ChatConnectionState;
  isGenerating: boolean;
  error: string | null;
  sendMessage: (content: string) => void;
  respondToApproval: (approvalId: string, decision: ApprovalDecision, comment?: string) => void;
  respondToEntitySelect: (data: {
    resumeToken: string;
    selectedCandidate?: Record<string, unknown>;
    action: EntitySelectAction;
  }) => void;
  dispatchA2uiAction: (action: import('../a2ui/types').A2uiClientAction) => void;
  ensureSession: () => Promise<string>;
  closeSession: () => void;
  reconnect: () => void;
}

/** 生成唯一 id（消息 / 本地会话）。 */
export function generateClientId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
