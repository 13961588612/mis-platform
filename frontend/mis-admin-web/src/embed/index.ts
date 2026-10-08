/**
 * embed 模块桶导出（T07'）。
 */
export {
  EmbedAuthBridge,
  EMBED_AUTH_TIMEOUT_MS,
  EMBED_TOKEN_REFRESH_LEAD_MS,
  EMBED_TOKEN_REFRESH_TIMEOUT_MS,
} from './EmbedAuthBridge';
export { useEmbedStore, type EmbedPageContext, type EmbedAuthState } from './embedStore';
export { configureEmbedAuthStore, getJwtExpiry, isValidJwtShape } from './embed-auth';
export { parseParentOrigins, isAllowedParentOrigin, isEmbeddedFrame } from './embed-env';
export {
  postA2uiEvent,
  onA2uiEventResult,
  createEmbedBffAdapter,
  EMBED_EVENT_TIMEOUT_MS,
  type A2uiBridgeEvent,
  type A2uiEventResultMessage,
  type EmbedWriteMode,
} from './embed-bridge';
export {
  buildEmbedSessionId,
  clearEmbedSession,
  resolveRouteSessionId,
  sanitizeHostId,
} from './embed-session';
export { EmbedChatPage } from './EmbedChatPage';
export { EmbedChatView } from './EmbedChatView';
export { EmbedApp } from './EmbedApp';
