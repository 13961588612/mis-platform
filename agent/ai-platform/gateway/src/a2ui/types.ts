/**
 * types.ts — A2UI 协议共享类型（Gateway 侧）
 *
 * 以 `02-task-breakdown.md` §4 共享知识 / §5 数据结构 为口径：
 * - 组件名：approval-card / data-table / form-sheet / entity-select
 * - 错误码：40301 / 40303 / 40304 / 40305 / 4004 / 40101
 * - catalogId：mis-a2ui-catalog-v1
 * - 事件协议：ACTIVITY_SNAPSHOT 的 a2ui_operations 中封装
 *   `{ version: 'v0.9', <one operation> }`
 * - 用户操作回传：WS 消息 `{ type: 'a2ui_action', action: A2uiClientAction }`
 *
 * @module a2ui/types
 */

// ============================================================================
// 口径常量（工程强制）
// ============================================================================

/** A2UI 协议 catalogId（协议版本锚点；资产 major ↔ Gateway catalog major 必须匹配） */
export const A2UI_CATALOG_ID = 'mis-a2ui-catalog-v1';

/** A2UI 协议版本（v0.9） */
export const A2UI_PROTOCOL_VERSION = 'v0.9';

/** 渲染权限码（组件级） */
export const PERMISSION_APPROVAL_VIEW = 'approval:view';
/** 操作权限码（事件级） */
export const PERMISSION_APPROVAL_DECIDE = 'approval:decide';
/** 操作权限码（事件级） */
export const PERMISSION_FORM_SUBMIT = 'form:submit';

/** 权限缓存 Redis key 前缀（三端共享：Java SkillPermissionChecker / Python MisPermissionResolver / Gateway SurfacePermissionFilter） */
export function skillPermissionKey(userId: string): string {
  return `mis:acl:skillperm:${userId}`;
}

/** 权限缓存 TTL（秒），与 02 文档口径一致 */
export const SKILL_PERMISSION_TTL_SEC = 60;

// ============================================================================
// A2UI 错误码（口径）
// ============================================================================

/** 缺权限码（渲染/操作）；D12 映射未命中/歧义（零权限语义） */
export const ERROR_FORBIDDEN = 40301;
/** 权限源不可用（fail-closed） */
export const ERROR_ACL_UNAVAILABLE = 40303;
/** 渲染被策略拒绝（组件权限不足的聚合形态） */
export const ERROR_A2UI_RENDER_FORBIDDEN = 40304;
/** 事件回传被策略拒绝（事件级 fail-closed） */
export const ERROR_A2UI_EVENT_FORBIDDEN = 40305;
/** 协议要素未映射到权限码（deny-unmapped=true） */
export const ERROR_A2UI_POLICY_UNMAPPED = 4004;
/** 外部身份令牌无效（D12 兑换端点） */
export const ERROR_EMBED_TOKEN_INVALID = 40101;

// ============================================================================
// A2UI 前端消息协议（BaseEvent → 前端 SSE/WS 消息）
// ============================================================================

/**
 * A2UI operation（A2UI v0.9 协议原语）。
 *
 * createSurface / updateComponents / updateDataModel 三类为主；
 * 组件树结构：components 数组内组件 `{ id, component, props, children? }`。
 */
export type A2UIOperation = Record<string, unknown>;

/**
 * 前端 a2ui_surface 消息（ACTIVITY_SNAPSHOT 转换产物）。
 *
 * `operations` 为 A2UI operations 数组，前端 MessageProcessor 逐条消费。
 */
export type A2UISurfaceMessage = {
  type: 'a2ui_surface';
  operations: A2UIOperation[];
  /** 关联的 runId（BaseEvent 携带） */
  runId?: string;
  /** 关联的 sessionId（过滤链路注入） */
  sessionId?: string;
};

/** 前端 stream 消息（TEXT_MESSAGE_CHUNK 转换产物） */
export type A2UIStreamMessage = {
  type: 'stream';
  content: string;
};

/** 前端 done 消息（RUN_FINISHED 转换产物） */
export type A2UIDoneMessage = {
  type: 'done';
};

/** 前端 error 消息（RUN_ERROR 转换产物） */
export type A2UIErrorMessage = {
  type: 'error';
  errorCode: string;
  message: string;
};

/** 前端 custom 消息（CUSTOM 转换产物，如 dispatch.trace 透传） */
export type A2UICustomMessage = {
  type: 'custom';
  eventType: string;
  data: Record<string, unknown>;
};

/** 前端 tool 消息（TOOL_CALL_START/CHUNK/RESULT 转换产物，H5 原样透传） */
export type A2UIToolMessage = {
  type: 'tool';
  toolName: string;
  args?: Record<string, unknown>;
  result?: Record<string, unknown>;
};

/** BaseEvent → 前端统一消息（A2UIRuntime 经 SurfacePermissionFilter 过滤后下发） */
export type A2UIFrontendMessage =
  | A2UISurfaceMessage
  | A2UIStreamMessage
  | A2UIDoneMessage
  | A2UIErrorMessage
  | A2UICustomMessage
  | A2UIToolMessage;

// ============================================================================
// A2UI 用户操作回传（前端 → Gateway → 中间件 forwardedProps.a2uiAction）
// ============================================================================

/**
 * A2UI 用户操作（A2uiClientAction）。
 *
 * 前端组件（approval-card 通过/驳回、form-sheet 提交、entity-select 确认等）
 * 触发后经 WS 消息 `{ type: 'a2ui_action', action }` 回传 Gateway。
 * Gateway 只做协议透传（P3/P5：不做写操作授权），交给中间件 processUserAction
 * 合成 tool call 消息发回 Python。
 */
export interface A2uiClientAction {
  /** Surface ID（前端 SurfaceModel 的 surfaceId） */
  surfaceId: string;
  /** 组件 ID（触发操作的组件） */
  componentId: string;
  /** 操作名（approve / reject / submit / confirm ...） */
  action: string;
  /** 操作参数（表单值、选中实体等） */
  args?: Record<string, unknown>;
}

/** WS a2ui_action 入站消息（server.ts /ws/chat 分支解析） */
export interface A2uiActionWsMessage {
  type: 'a2ui_action';
  action: A2uiClientAction;
  sessionId?: string;
}

/** a2ui_action 处理结果（回传前端；以 02 文档为准：A2UI_EVENT_RESULT 或等价协议） */
export interface A2uiActionResult {
  type: 'a2ui_action_result';
  ok: boolean;
  /** 关联事件/操作 ID（如前端 eventId，原样回传） */
  eventId?: string;
  data?: Record<string, unknown>;
  error?: {
    code: number;
    message: string;
    missingPermissions?: string[];
  };
}

// ============================================================================
// Redis Streams 出站协议（Python → Gateway RedisStreamAgent）
// ============================================================================

/**
 * `aip:outbound:{sessionId}` 流消息字段（与 02 §6 时序图一致）。
 *
 * Python 在 A2UI run 期间将 AgentEvent（snake_case）XADD 到该会话私有流：
 * ```
 * XADD aip:outbound:{sessionId} * eventType text.delta event '<json>'
 * ```
 * Gateway RedisStreamAgent 逐条读取 → EventConverter 转 BaseEvent → Observable。
 */
export interface OutboundStreamMessage {
  /** 会话 ID */
  sessionId: string;
  /** AgentEvent 类型（冗余，便于流过滤） */
  eventType: string;
  /** AgentEvent JSON（snake_case，与 parseBackendAgentEvent 兼容） */
  event: string;
  /** 时间戳（ISO 8601） */
  timestamp?: string;
}

/** 构造 `aip:outbound:{sessionId}` 流键名（与 02 文档键名逐字一致） */
export function outboundStreamKey(sessionId: string): string {
  return `aip:outbound:${sessionId}`;
}

/** A2UI run 入站消息 messageType（Python 侧识别 A2UI run 的新消息类型） */
export const A2UI_RUN_MESSAGE_TYPE = 'a2ui_run';

/** InboundMessage.metadata.a2ui 载体（RunAgentInput 序列化） */
export interface A2uiInboundMeta {
  /** A2UI run 标识（UUID） */
  runId: string;
  /** 协议版本锚点 */
  catalogId: string;
  /** 中间件处理后的完整 RunAgentInput（JSON 可序列化） */
  runAgentInput: Record<string, unknown>;
}
