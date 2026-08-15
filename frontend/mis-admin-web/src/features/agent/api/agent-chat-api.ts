/**
 * Agent 运营台「本地对话」专用 HTTP 客户端。
 *
 * <p>与全局 {@code lib/api/client.ts}（15s）分离：§4.3 #32/#33 背后是完整 LLM 推理，
 * 且可能经 Coordinator→Worker 多跳，BFF {@code mis.agent-ops.chat-timeout-ms} 已放宽到 180s，
 * 前端必须对齐，否则浏览器先断。其它 agent-ops 接口仍走默认 15s 客户端，互不影响。
 */
import axios, { type AxiosError, type InternalAxiosRequestConfig } from 'axios';
import type { ApiResult, TokenResponse } from '@/types/api';
import { useAuthStore } from '@/stores/auth-store';
import { listSkills } from './agent-ops-api';
import type {
  Session,
  SessionMessage,
  SkillBuilderChatRequest,
  SkillBuilderChatResponse,
  SkillSummary,
} from '../types';

/** 与 BFF {@code mis.agent-ops.chat-timeout-ms} 对齐（毫秒）。 */
export const AGENT_CHAT_TIMEOUT_MS = 180_000;

const chatApi = axios.create({
  baseURL: '/api/v1',
  timeout: AGENT_CHAT_TIMEOUT_MS,
  withCredentials: true,
});

chatApi.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = useAuthStore.getState().accessToken;
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

let refreshPromise: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  if (!refreshPromise) {
    refreshPromise = chatApi
      .post<ApiResult<TokenResponse>>('/auth/refresh', {})
      .then((res) => {
        if (res.data.code !== 0 || !res.data.data) {
          throw new Error(res.data.message || 'refresh failed');
        }
        const { accessToken, expiresIn } = res.data.data;
        useAuthStore.getState().setAccessToken(accessToken, expiresIn);
        return accessToken;
      })
      .catch(() => {
        useAuthStore.getState().clearSession();
        return null;
      })
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
}

chatApi.interceptors.response.use(
  (response) => response,
  async (error: AxiosError<ApiResult<unknown>>) => {
    const original = error.config;
    if (!original || original.url?.includes('/auth/refresh') || original.url?.includes('/auth/login')) {
      return Promise.reject(error);
    }
    const status = error.response?.status;
    const code = error.response?.data?.code;
    const shouldRefresh = status === 401 || code === 40101;
    if (!shouldRefresh || (original as InternalAxiosRequestConfig & { _retry?: boolean })._retry) {
      return Promise.reject(error);
    }
    (original as InternalAxiosRequestConfig & { _retry?: boolean })._retry = true;
    const newToken = await refreshAccessToken();
    if (!newToken) {
      window.location.href = '/login';
      return Promise.reject(error);
    }
    original.headers.Authorization = `Bearer ${newToken}`;
    return chatApi(original);
  },
);

function unwrap<T>(res: { data: ApiResult<T> }, fallback: string): T {
  if (res.data.code !== 0) {
    throw new Error(res.data.message || fallback);
  }
  if (res.data.data === undefined || res.data.data === null) {
    throw new Error(fallback);
  }
  return res.data.data;
}

function seg(value: string): string {
  return encodeURIComponent(value);
}

/**
 * 「AI 对话创建」技能（C 功能）— agent:skill:manage。
 *
 * <p>走 180s 客户端（与 {@link sendChatMessage} 同文件）：本质是完整 LLM 推理，
 * 与下游 BFF `mis.agent-ops.chat-timeout-ms` 对齐，否则浏览器先断。
 * 后端 `POST /skills/builder/chat` 为 ephemeral 端点（不落库），仅回 AI 文本。
 */
export async function chatSkillBuilder(
  req: SkillBuilderChatRequest,
): Promise<SkillBuilderChatResponse> {
  const res = await chatApi.post<ApiResult<SkillBuilderChatResponse>>(
    '/agent-ops/skills/builder/chat',
    req,
  );
  return unwrap(res, 'AI 生成技能失败');
}

/** §4.3 #32 — agent:chat:use */
export async function createChatSession(agentId: string): Promise<Session> {
  const res = await chatApi.post<ApiResult<Session>>('/agent-ops/chat/sessions', {
    agent_id: agentId,
  });
  return unwrap(res, '创建对话会话失败');
}

/**
 * 内嵌选择器专用封装（T04）：复用 `listSkills` 拉取技能池，映射为精简
 * {@link SkillSummary}；搜索在客户端按 skill_id/name/description 子串过滤。
 *
 * <p>与 `chatSkillBuilder`（ephemeral）无关：选择器数据源是 `GET /skills`，
 * 不依赖 SSE tool 事件（design §4 / Q3）。
 */
export async function listSkillsForBuilder(keyword?: string): Promise<SkillSummary[]> {
  const all = await listSkills();
  const kw = (keyword ?? '').trim().toLowerCase();
  const filtered = kw
    ? all.filter(
        (s) =>
          s.skill_id.toLowerCase().includes(kw) ||
          s.name.toLowerCase().includes(kw) ||
          (s.description ?? '').toLowerCase().includes(kw),
      )
    : all;
  return filtered.map((s) => ({
    skill_id: s.skill_id,
    name: s.name,
    description: s.description,
    category: s.category,
  }));
}

/**
 * §4.3 #33 的真实 wire 形状（ai-platform send_message）。
 *
 * <p>助手回复在 {@code response}；{@code message_id} 是用户消息落库 id。
 */
interface ChatReplyWire {
  message_id?: string;
  response?: string;
  session_id?: string;
  warnings?: string[];
  tool_errors?: string[];
}

/**
 * §4.3 #33 — agent:chat:use。
 *
 * <p>适配为标准 {@link SessionMessage}，供对话页与 {@code AgentMessageStream} 消费。
 */
export async function sendChatMessage(
  sessionId: string,
  content: string,
): Promise<SessionMessage> {
  const res = await chatApi.post<ApiResult<ChatReplyWire>>(
    `/agent-ops/chat/sessions/${seg(sessionId)}/messages`,
    { content },
  );
  const wire = unwrap(res, '发送消息失败');

  const warnings = Array.isArray(wire.warnings) ? wire.warnings : [];
  const toolErrors = Array.isArray(wire.tool_errors) ? wire.tool_errors : [];
  const metadata: Record<string, unknown> = {};
  if (warnings.length > 0) metadata.warnings = warnings;
  if (toolErrors.length > 0) metadata.tool_errors = toolErrors;

  return {
    id: wire.message_id ? `${wire.message_id}-reply` : `reply-${Date.now()}`,
    session_id: wire.session_id ?? sessionId,
    role: 'assistant',
    content: wire.response ?? '',
    timestamp: new Date().toISOString(),
    metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
  };
}
