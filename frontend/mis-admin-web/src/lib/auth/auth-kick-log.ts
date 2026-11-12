/**
 * 记录「401 → refresh 失败 → 强制跳登录」事件，便于排查忽然踢回登录页。
 *
 * <p>落 localStorage（跨跳转仍在）；控制台同步打 warn。
 * 读取：{@link readLastAuthKick} / 登录页提示 / DevTools → Application → localStorage。
 */

export const AUTH_KICK_LOG_KEY = 'mis_auth_kick_log';
const MAX_ENTRIES = 20;

export interface AuthKickEntry {
  /** ISO 时间 */
  at: string;
  /** 触发 401 的请求路径 */
  triggerUrl?: string;
  /** HTTP 方法 */
  triggerMethod?: string;
  /** HTTP 状态 */
  httpStatus?: number;
  /** 业务码 */
  bizCode?: number | string;
  /** 业务 message */
  bizMessage?: string;
  /** refresh 失败原因 */
  refreshError?: string;
  /** 来源客户端：main | chat */
  client: 'main' | 'chat';
  /** 当前页 path */
  pagePath?: string;
}

function safeParse(raw: string | null): AuthKickEntry[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as AuthKickEntry[]) : [];
  } catch {
    return [];
  }
}

/** 追加一条踢登录记录（失败静默，不影响鉴权主流程）。 */
export function recordAuthKick(entry: Omit<AuthKickEntry, 'at'> & { at?: string }): void {
  try {
    const full: AuthKickEntry = {
      ...entry,
      at: entry.at ?? new Date().toISOString(),
      pagePath: entry.pagePath ?? (typeof window !== 'undefined' ? window.location.pathname : undefined),
    };
    const prev = safeParse(localStorage.getItem(AUTH_KICK_LOG_KEY));
    const next = [full, ...prev].slice(0, MAX_ENTRIES);
    localStorage.setItem(AUTH_KICK_LOG_KEY, JSON.stringify(next));
    console.warn('[auth-kick] 强制跳转登录', full);
  } catch {
    // ignore quota / private mode
  }
}

export function readAuthKickLog(): AuthKickEntry[] {
  try {
    return safeParse(localStorage.getItem(AUTH_KICK_LOG_KEY));
  } catch {
    return [];
  }
}

export function readLastAuthKick(): AuthKickEntry | null {
  return readAuthKickLog()[0] ?? null;
}
