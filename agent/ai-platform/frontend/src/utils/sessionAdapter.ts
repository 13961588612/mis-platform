/** Session API 响应归一化（Backend snake_case → Frontend） */

import type { ChatAttachment, ChatMessage, MessageRole } from "../types/message";

export interface RawCreateSessionResponse {
  session_id?: string;
  sessionId?: string;
  agent_id?: string;
  agentId?: string;
  user_id?: string;
  userId?: string;
  channel?: string;
  runtime_type?: string;
  runtimeType?: string;
}

export interface CreateSessionResult {
  sessionId: string;
  agentId: string;
  userId: string;
  channel: string;
}

export interface RawSessionDetail {
  session_id?: string;
  sessionId?: string;
  agent_id?: string;
  agentId?: string;
  user_id?: string;
  userId?: string;
  channel?: string;
  message_count?: number;
  messageCount?: number;
}

export interface SessionDetail {
  sessionId: string;
  agentId: string;
  userId: string;
  channel: string;
}

export interface RawSessionMessage {
  id?: string;
  role?: string;
  content?: string;
  metadata?: Record<string, unknown>;
  timestamp?: string;
}

export function normalizeCreateSessionResponse(
  raw: RawCreateSessionResponse,
): CreateSessionResult {
  const sessionId = raw.sessionId ?? raw.session_id ?? "";
  if (!sessionId) {
    throw new Error("创建会话失败：服务端未返回 session_id");
  }
  return {
    sessionId,
    agentId: raw.agentId ?? raw.agent_id ?? "",
    userId: raw.userId ?? raw.user_id ?? "",
    channel: raw.channel ?? "web",
  };
}

export function normalizeSessionDetail(raw: RawSessionDetail): SessionDetail {
  const sessionId = raw.sessionId ?? raw.session_id ?? "";
  if (!sessionId) {
    throw new Error("会话不存在或已过期");
  }
  return {
    sessionId,
    agentId: raw.agentId ?? raw.agent_id ?? "",
    userId: raw.userId ?? raw.user_id ?? "",
    channel: raw.channel ?? "web",
  };
}

const KNOWN_ROLES: MessageRole[] = ["user", "assistant", "system", "tool"];

function asRole(role: string | undefined): MessageRole {
  if (role && (KNOWN_ROLES as string[]).includes(role)) {
    return role as MessageRole;
  }
  return "assistant";
}

/** Map REST session messages into ChatMessage for the transcript UI. */
export function normalizeSessionMessages(
  sessionId: string,
  rawList: RawSessionMessage[] | null | undefined,
): ChatMessage[] {
  if (!Array.isArray(rawList)) {
    return [];
  }
  return rawList.map((raw, index) => {
    const meta = raw.metadata ?? {};
    const toolName =
      typeof meta.toolName === "string"
        ? meta.toolName
        : typeof meta.tool_name === "string"
          ? meta.tool_name
          : undefined;
    const toolArgs =
      typeof meta.toolArgs === "string"
        ? meta.toolArgs
        : meta.args != null
          ? JSON.stringify(meta.args, null, 2)
          : undefined;
    const toolResult =
      typeof meta.toolResult === "string"
        ? meta.toolResult
        : meta.result != null
          ? JSON.stringify(meta.result, null, 2)
          : undefined;

    const attachments = normalizeAttachments(meta.attachments);

    return {
      id: raw.id ?? `${sessionId}-msg-${index}`,
      sessionId,
      role: asRole(raw.role),
      content: raw.content ?? "",
      status: "delivered" as const,
      timestamp: raw.timestamp ?? new Date().toISOString(),
      attachments: attachments.length > 0 ? attachments : undefined,
      toolName,
      toolArgs,
      toolResult,
    };
  });
}

function normalizeAttachments(raw: unknown): ChatAttachment[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const out: ChatAttachment[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const fileId = String(rec.fileId ?? rec.file_id ?? "");
    if (!fileId) continue;
    out.push({
      fileId,
      name: String(rec.name ?? fileId),
      mimeType: String(rec.mimeType ?? rec.mime_type ?? ""),
      size: typeof rec.size === "number" ? rec.size : 0,
      url: typeof rec.url === "string" ? rec.url : `/api/v1/files/${fileId}`,
    });
  }
  return out;
}
