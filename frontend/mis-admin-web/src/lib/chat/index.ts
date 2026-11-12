/**
 * chat-core 桶导出（mis-admin-web 共享内核，T06'）。
 * 自身业务页（Copilot 面板）与 /embed/* 嵌入页（T07'）共用同一内核。
 */
export { useChat, type UseChatOptions } from './useChat';
export { subscribeChatStream, buildChatStreamUrl, type ChatSseController, type ChatSseOptions } from './sse-client';
export { ChatWsClient, buildChatWsUrl, type WsClientState, type WsClientOptions } from './ws-client';
export { parseStreamLine } from './event-adapter';
export { camelizeKeys } from './camelize';
export {
  generateClientId,
  type ChatMessage,
  type ChatRole,
  type MessageStatus,
  type ChatStreamEvent,
  type ChatConnectionState,
  type DispatchTraceEntry,
  type DispatchTracePayload,
  type TokenUsage,
  type InboundMessage,
  type ApprovalDecision,
  type EntitySelectAction,
  type SessionHandle,
  type UseChatReturn,
} from './types';
