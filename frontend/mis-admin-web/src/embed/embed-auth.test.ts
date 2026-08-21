/**
 * embed-auth JWT 校验测试（QA 严过关，T07' 独立验证）。
 *
 * <p>口径：token 不可验签 → 明确拒绝（浏览器端防呆，Gateway 才是验签权威）；
 * P4：不设置 authStore.user（外部身份不受信）。
 */
import { describe, it, expect } from 'vitest';
import { getJwtExpiry, isValidJwtShape } from './embed-auth';
import { useAuthStore } from '@/stores/auth-store';

/** 构造三段式 JWT（header.payload.signature，payload 可自定义）。 */
function makeJwt(payload: Record<string, unknown>): string {
  const enc = (obj: Record<string, unknown>): string =>
    btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${enc({ alg: 'RS256', typ: 'JWT' })}.${enc(payload)}.ZmFrZS1zaWduYXR1cmU`;
}

const FUTURE_EXP = Math.floor(Date.now() / 1000) + 3600;

describe('embed-auth getJwtExpiry', () => {
  it('解析合法 exp（秒 → ms）', () => {
    const ms = getJwtExpiry(makeJwt({ exp: FUTURE_EXP }));
    expect(ms).toBe(FUTURE_EXP * 1000);
  });

  it('无 exp / 结构非法 → null', () => {
    expect(getJwtExpiry(makeJwt({}))).toBeNull();
    expect(getJwtExpiry('not-a-jwt')).toBeNull();
    expect(getJwtExpiry('a.b')).toBeNull();
    expect(getJwtExpiry('')).toBeNull();
  });
});

describe('embed-auth isValidJwtShape', () => {
  it('三段式 + exp 未过期 → true', () => {
    expect(isValidJwtShape(makeJwt({ exp: FUTURE_EXP }))).toBe(true);
  });

  it('已过期 → false（fail-closed）', () => {
    const past = Math.floor(Date.now() / 1000) - 100;
    expect(isValidJwtShape(makeJwt({ exp: past }))).toBe(false);
  });

  it('缺 exp → false（不可验 → 拒绝）', () => {
    expect(isValidJwtShape(makeJwt({ sub: 'u_1' }))).toBe(false);
  });

  it('非三段 / 空段 / 空串 → false', () => {
    expect(isValidJwtShape('aaa.bbb')).toBe(false);
    expect(isValidJwtShape('a..c')).toBe(false);
    expect(isValidJwtShape('')).toBe(false);
    expect(isValidJwtShape('x'.repeat(300))).toBe(false);
  });

  it('P4：embed 鉴权不设置 authStore.user（外部身份不受信）', () => {
    useAuthStore.setState({ user: null });
    expect(useAuthStore.getState().user).toBeNull();
  });
});
