/**
 * chat-store（zustand）— chat-core 会话状态（T06'）。
 *
 * <p>从 agent/frontend `store/chatStore.ts` 迁入 mis-admin-web，裁剪为 T06' 需要的最小
 * 状态集：会话 / 消息 / 连接状态 / 生成态 / 错误 / dispatch.trace。A2UI Surface 状态
 * 独立存放于 `lib/a2ui/surface-store.ts`（渲染层自持，避免 chat-store 膨胀）。
 */

import { create } from 'zustand';
import type { ChatConnectionState, ChatMessage, DispatchTraceEntry, MessageStatus, TokenUsage } from '@/lib/chat/types';

/** 会话创建/恢复状态。 */
export type ChatSessionState = 'none' | 'creating' | 'ready' | 'error';

interface ChatState {
  sessionId: string | null;
  agentId: string | null;
  messages: ChatMessage[];
  connectionState: ChatConnectionState;
  isGenerating: boolean;
  error: string | null;
  dispatchTrace: DispatchTraceEntry[];
  tokenUsage: TokenUsage;
  sessionState: ChatSessionState;

  setSessionId: (sessionId: string | null) => void;
  setAgentId: (agentId: string | null) => void;
  setConnectionState: (state: ChatConnectionState) => void;
  setSessionState: (state: ChatSessionState) => void;
  addMessage: (message: ChatMessage) => void;
  updateMessage: (id: string, updates: Partial<ChatMessage>) => void;
  updateMessageStatus: (id: string, status: MessageStatus) => void;
  clearMessages: () => void;
  setMessages: (messages: ChatMessage[]) => void;
  setGenerating: (generating: boolean) => void;
  setError: (error: string | null) => void;
  setDispatchTrace: (entries: DispatchTraceEntry[]) => void;
  addTokenUsage: (usage: TokenUsage) => void;
  reset: () => void;
}

const INITIAL_TOKEN_USAGE: TokenUsage = { prompt: 0, completion: 0, total: 0 };

export const useChatStore = create<ChatState>((set) => ({
  sessionId: null,
  agentId: null,
  messages: [],
  connectionState: 'idle',
  isGenerating: false,
  error: null,
  dispatchTrace: [],
  tokenUsage: { ...INITIAL_TOKEN_USAGE },
  sessionState: 'none',

  setSessionId: (sessionId) => set({ sessionId }),
  setAgentId: (agentId) => set({ agentId }),
  setConnectionState: (connectionState) => set({ connectionState }),
  setSessionState: (sessionState) => set({ sessionState }),

  addMessage: (message) =>
    set((state) => ({ messages: [...state.messages, message] })),

  updateMessage: (id, updates) =>
    set((state) => ({
      messages: state.messages.map((m) => (m.id === id ? { ...m, ...updates } : m)),
    })),

  updateMessageStatus: (id, status) =>
    set((state) => ({
      messages: state.messages.map((m) => (m.id === id ? { ...m, status } : m)),
    })),

  clearMessages: () =>
    set({
      messages: [],
      dispatchTrace: [],
      tokenUsage: { ...INITIAL_TOKEN_USAGE },
      isGenerating: false,
    }),

  setMessages: (messages) =>
    set({
      messages,
      dispatchTrace: [],
      tokenUsage: { ...INITIAL_TOKEN_USAGE },
      isGenerating: false,
    }),

  setGenerating: (isGenerating) => set({ isGenerating }),
  setError: (error) => set({ error }),
  setDispatchTrace: (dispatchTrace) => set({ dispatchTrace }),

  addTokenUsage: (usage) =>
    set((state) => ({
      tokenUsage: {
        prompt: state.tokenUsage.prompt + usage.prompt,
        completion: state.tokenUsage.completion + usage.completion,
        total: state.tokenUsage.total + usage.total,
      },
    })),

  reset: () =>
    set({
      sessionId: null,
      agentId: null,
      messages: [],
      connectionState: 'idle',
      isGenerating: false,
      error: null,
      dispatchTrace: [],
      tokenUsage: { ...INITIAL_TOKEN_USAGE },
      sessionState: 'none',
    }),
}));

export default useChatStore;
