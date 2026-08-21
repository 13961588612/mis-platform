/**
 * embed 认证工具（T07'）。
 *
 * <p>embed 入口将 auth-store 的持久化存储切到内存：
 * - 外部兑换的短时 MIS RS256 JWT 只活在当前页面内存，不写入 localStorage('mis-auth')
 * - 避免覆盖管理员本地会话 / 跨 iframe 污染
 * chat-core（useChat）仍从 auth-store 读 token，零改动复用。
 */

import { createJSONStorage } from 'zustand/middleware';
import { useAuthStore } from '@/stores/auth-store';

/** 内存存储（替代 localStorage，仅当前页面存活）。 */
const memoryStorage = {
  getItem: (): null => null,
  setItem: (): void => undefined,
  removeItem: (): void => undefined,
};

/** embed 入口调用一次：将 auth-store 持久化切到内存。 */
export function configureEmbedAuthStore(): void {
  useAuthStore.persist.setOptions({
    storage: createJSONStorage(() => memoryStorage),
  });
}

/** 解析 JWT 的 exp（ms）；结构非法返回 null。 */
export function getJwtExpiry(token: string): number | null {
  try {
    const part = token.split('.')[1];
    if (!part) return null;
    const payload = JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/'))) as {
      exp?: unknown;
    };
    return typeof payload.exp === 'number' && Number.isFinite(payload.exp)
      ? payload.exp * 1000
      : null;
  } catch {
    return null;
  }
}

/**
 * JWT 结构校验：三段 base64url + exp 未过期。
 * 浏览器端无法验签，Gateway 才是验签权威；此处仅做"不可验 → 明确拒绝"的第一道防线。
 */
export function isValidJwtShape(token: string): boolean {
  if (typeof token !== 'string' || token.length === 0) return false;
  const parts = token.split('.');
  if (parts.length !== 3 || parts.some((p) => p.length === 0)) return false;
  const expiry = getJwtExpiry(token);
  return expiry !== null && expiry > Date.now();
}
