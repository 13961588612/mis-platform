/**
 * Message-related type definitions for the frontend.
 *
 * Aligns with the Gateway's InboundMessage (gateway/src/types) and
 * the backend's session message model. All fields use camelCase
 * per frontend convention.
 */

// ===== Message Role =====

/** Role of a message sender. */
export type MessageRole = "user" | "assistant" | "system" | "tool";

// ===== Message Status =====

/** Delivery / processing status of a chat message. */
export type MessageStatus =
  | "pending"
  | "sending"
  | "streaming"
  | "delivered"
  | "error";

/** 助手回答的点赞 / 吐槽。 */
export type MessageFeedbackRating = "up" | "down";

export interface MessageFeedback {
  rating: MessageFeedbackRating;
  comment?: string | null;
}

/** Chat attachment reference (uploaded via /files/upload). */
export interface ChatAttachment {
  fileId: string;
  name: string;
  mimeType: string;
  size: number;
  /** Relative API path, e.g. /api/v1/files/{id} */
  url?: string;
}

// ===== Chat Message =====

/** A single chat message in a conversation. */
export interface ChatMessage {
  /** Unique message ID (UUID). */
  id: string;
  /** Session/conversation ID. */
  sessionId: string;
  /** Sender role. */
  role: MessageRole;
  /** Message text content. */
  content: string;
  /** Message status. */
  status: MessageStatus;
  /** ISO 8601 timestamp. */
  timestamp: string;
  /** Agent ID that produced this message (for assistant role). */
  agentId?: string;
  /** Uploaded attachments (images / files). */
  attachments?: ChatAttachment[];
  /** Tool name if this is a tool message. */
  toolName?: string;
  /** Tool call arguments (JSON string). */
  toolArgs?: string;
  /** Tool result (JSON string). */
  toolResult?: string;
  /** Whether this message requires approval. */
  requiresApproval?: boolean;
  /** Approval ID if this message is part of a HITL flow. */
  approvalId?: string;
  /** Error message if status is "error". */
  error?: string;
  /** Token usage for this message (if available). */
  tokenUsage?: TokenUsageSummary;
  /** A2UI 渲染描述（ui.render 事件），由组件注册表渲染（DEP-8）。 */
  a2ui?: {
    /** 组件名（须登记于组件注册表，如 approval-card / data-table / form-sheet）。 */
    component: string;
    /** 后端下发的纯数据 props（snake_case，渲染前由 A2uiRenderer camelize）。 */
    props: Record<string, unknown>;
  };
  /** 点赞 / 吐槽；未评价为 undefined。 */
  feedback?: MessageFeedback;
}

// ===== Token Usage Summary =====

/** Token usage summary for a message or session. */
export interface TokenUsageSummary {
  prompt: number;
  completion: number;
  total: number;
}

// ===== Inbound Message (WebSocket) =====

/**
 * Inbound message sent from the frontend to the Gateway via WebSocket.
 *
 * Aligns with gateway/src/types InboundMessage — the Gateway
 * forwards this to the Agent Core for processing.
 */
export interface InboundMessage {
  /** Message type identifier. */
  type:
    | "chat"
    | "approval"
    | "entity_select"
    | "ping"
    | "session.create"
    | "session.close";
  /** Session/conversation ID. */
  sessionId: string;
  /** User ID (from JWT). */
  userId: string;
  /** Agent ID to route to. */
  agentId?: string;
  /** Message text content (for chat type). */
  content?: string;
  /** Optional message type (text | image | file). */
  messageType?: string;
  /** Extra payload (e.g. attachments). */
  metadata?: Record<string, unknown>;
  /** Approval response (for approval type). */
  approvalResponse?: {
    approvalId: string;
    decision: "approved" | "rejected";
    comment?: string;
  };
  /** 表单填充 HITL 实体选择回执（entity_select 类型）。 */
  entitySelectResponse?: {
    /** 后端下发的 resumeToken（与 A2UI entity-select 卡片对应）。 */
    resumeToken: string;
    /** 用户选择的候选实体（confirm 动作时存在）。 */
    selectedCandidate?: Record<string, unknown>;
    /** 选择动作：confirm | manual | cancel。 */
    action: "confirm" | "manual" | "cancel";
  };
  /** Client timestamp for ordering. */
  timestamp: string;
}

// ===== Session Info =====

/** Session/conversation summary. */
export interface SessionInfo {
  sessionId: string;
  userId: string;
  agentId: string;
  title: string;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
  lastMessagePreview: string;
}

// ===== Unified API Response =====

/**
 * Unified API response format.
 * All backend APIs return: { code, data, message, traceId }
 */
export interface ApiResponse<T = unknown> {
  /** 0 = success, non-zero = error. */
  code: number;
  /** Response payload (null on error). */
  data: T | null;
  /** Human-readable message. */
  message: string;
  /** Request trace ID for correlation. */
  traceId: string;
}
