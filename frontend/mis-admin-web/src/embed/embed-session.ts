/**
 * embed 多宿主会话隔离（T07'，配合 R47）。
 *
 * <p>01-architecture.md §5.5：sessionId 由 iframe 生成或父页 sessionHint 传入；
 * hostId 标识"端"。隔离策略：
 * - sessionId 带 hostId 前缀（embed-{hostId}-...），天然区分宿主
 * - localStorage key 按 hostId 分 key（mis.embed.session.{hostId}），避免多宿主共用会话串扰
 * - 父页 sessionHint（续接指定会话）优先；严格字符校验，防注入
 */

import { generateClientId } from '@/lib/chat/types';

const EMBED_SESSION_STORAGE_PREFIX = 'mis.embed.session';
/** sessionId 合法字符（防注入 localStorage key / 会话参数）。 */
const SESSION_ID_PATTERN = /^[a-zA-Z0-9_-]{1,128}$/;

/** 清洗 hostId：仅保留 [a-zA-Z0-9_-]，最长 64（防注入 key / 会话名）。 */
export function sanitizeHostId(raw: string | null | undefined): string {
  const cleaned = (raw ?? '').trim().replace(/[^a-zA-Z0-9_-]/g, '');
  return cleaned.slice(0, 64);
}

function storageKey(hostId: string): string {
  return `${EMBED_SESSION_STORAGE_PREFIX}.${hostId}`;
}

function readStored(hostId: string): string | null {
  try {
    const value = localStorage.getItem(storageKey(hostId));
    return value && SESSION_ID_PATTERN.test(value) ? value : null;
  } catch {
    return null;
  }
}

function writeStored(hostId: string, sessionId: string): void {
  try {
    localStorage.setItem(storageKey(hostId), sessionId);
  } catch {
    /* 隐私模式等场景忽略持久化失败 */
  }
}

/**
 * 构建（或恢复）宿主隔离的会话 id。
 * 优先：父页 sessionHint（续接指定会话）→ 本宿主已存会话 → 新生成（embed-{hostId}-...）。
 */
export function buildEmbedSessionId(hostId: string, sessionHint?: string | null): string {
  if (sessionHint && SESSION_ID_PATTERN.test(sessionHint)) {
    return sessionHint;
  }
  const host = sanitizeHostId(hostId) || 'anon';
  const existing = readStored(host);
  if (existing) return existing;
  const sid = `embed-${host}-${generateClientId('sess')}`;
  writeStored(host, sid);
  return sid;
}

/** 清空指定宿主的持久会话（新建会话用）。 */
export function clearEmbedSession(hostId: string): void {
  try {
    localStorage.removeItem(storageKey(sanitizeHostId(hostId) || 'anon'));
  } catch {
    /* ignore */
  }
}

/** 从路由参数恢复会话（/embed/chat/:sessionId 续接）。 */
export function resolveRouteSessionId(param: string | undefined): string | null {
  if (!param) return null;
  return SESSION_ID_PATTERN.test(param) ? param : null;
}
