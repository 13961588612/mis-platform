/**
 * embed 嵌入上下文 store（T07'，从 旧版独立前端 `store/embedStore.ts` 迁移扩展）。
 *
 * <p>01-architecture.md §5.2：PAGE_CONTEXT 扩展 hostId / embedMode / contextRef /
 * sessionHint；会话隔离（R47）依赖 hostId。鉴权状态机：
 * waiting（已发 AUTH_READY）→ authenticated（收到合法 AUTH_TOKEN）| rejected | timeout。
 */

import { create } from 'zustand';
import { useAuthStore } from '@/stores/auth-store';
import { getJwtExpiry } from './embed-auth';

export type EmbedAuthState = 'waiting' | 'authenticated' | 'rejected' | 'timeout';

/** PAGE_CONTEXT（01-architecture.md §5.2 扩展字段）。 */
export interface EmbedPageContext {
  /** 宿主标识（crm-web / supply-chain-web），用于会话隔离。 */
  hostId: string;
  /** 嵌入形态。 */
  embedMode: 'iframe' | 'standalone';
  /** 宿主页面上下文（路由/业务标识，透传展示，不参与鉴权）。 */
  contextRef?: Record<string, unknown> | null;
  /** 父页指定会话提示（续接指定会话，配合会话隔离）。 */
  sessionHint?: string | null;
  route?: string;
  module?: string;
  title?: string;
  /** 兑换响应中的权限码（BFF 签发，供前端 UX 权限门控）。 */
  permissions?: string[];
  /** 兑换响应的 mappedUserId（仅展示，P4 身份不受信）。 */
  mappedUserId?: string;
}

interface EmbedState {
  authState: EmbedAuthState;
  /** 父页推送的 MIS RS256 JWT。 */
  token: string | null;
  /** JWT 过期时间（ms epoch）；来自 token.exp。 */
  tokenExpiresAt: number | null;
  /** 已通过白名单校验的父页 origin（事件桥回包目标）。 */
  parentOrigin: string | null;
  pageContext: EmbedPageContext | null;
  authError: string | null;
  /** 是否正在等待父页响应 AUTH_TOKEN_REQUEST。 */
  refreshPending: boolean;
  setAuthenticated: (token: string, parentOrigin: string) => void;
  /** 续期热替换：保持 parentOrigin / session，仅换 token。 */
  refreshToken: (token: string) => void;
  setPageContext: (ctx: EmbedPageContext) => void;
  setRefreshPending: (pending: boolean) => void;
  setRejected: (reason: string) => void;
  setTimedOut: () => void;
  reset: () => void;
}

export const useEmbedStore = create<EmbedState>((set, get) => ({
  authState: 'waiting',
  token: null,
  tokenExpiresAt: null,
  parentOrigin: null,
  pageContext: null,
  authError: null,
  refreshPending: false,

  setAuthenticated: (token, parentOrigin) => {
    const expiresAt = getJwtExpiry(token);
    // 同步 chat-core 依赖的 auth-store（embed 入口已将其持久化切到内存，不污染 admin 本地会话）
    useAuthStore.setState({
      accessToken: token,
      expiresAt: expiresAt ?? Date.now() + 30 * 60 * 1000,
    });
    set({
      authState: 'authenticated',
      token,
      tokenExpiresAt: expiresAt,
      parentOrigin,
      authError: null,
      refreshPending: false,
    });
  },

  refreshToken: (token) => {
    const parentOrigin = get().parentOrigin;
    if (!parentOrigin) {
      set({ authState: 'rejected', authError: '续期失败：父页 origin 未知' });
      return;
    }
    const expiresAt = getJwtExpiry(token);
    useAuthStore.setState({
      accessToken: token,
      expiresAt: expiresAt ?? Date.now() + 30 * 60 * 1000,
    });
    set({
      authState: 'authenticated',
      token,
      tokenExpiresAt: expiresAt,
      authError: null,
      refreshPending: false,
    });
  },

  setPageContext: (pageContext) => {
    // 权限码（BFF 签发）同步到 auth-store，供 A2uiPermissionGate UX 门控
    if (pageContext.permissions && pageContext.permissions.length > 0) {
      useAuthStore.setState({ permissions: pageContext.permissions });
    }
    set({ pageContext });
  },

  setRefreshPending: (pending) => set({ refreshPending: pending }),

  setRejected: (reason) =>
    set({ authState: 'rejected', authError: reason, refreshPending: false }),
  setTimedOut: () =>
    set({
      authState: 'timeout',
      authError: '等待父页 AUTH_TOKEN 超时',
      refreshPending: false,
    }),
  reset: () =>
    set({
      authState: 'waiting',
      token: null,
      tokenExpiresAt: null,
      parentOrigin: null,
      pageContext: null,
      authError: null,
      refreshPending: false,
    }),
}));

export default useEmbedStore;
