import { describe, expect, it } from 'vitest';
import {
  computeRefreshDelayMs,
  readJwtExpMs,
  TOKEN_REFRESH_SKEW_MS,
} from './refresh-token';

describe('computeRefreshDelayMs', () => {
  it('距过期超过 skew 时返回剩余时间减去 skew', () => {
    const now = 1_000_000;
    const expiresAt = now + TOKEN_REFRESH_SKEW_MS + 60_000;
    expect(computeRefreshDelayMs(expiresAt, now)).toBe(60_000);
  });

  it('已进入 skew 窗口返回 0', () => {
    const now = 1_000_000;
    const expiresAt = now + TOKEN_REFRESH_SKEW_MS - 1;
    expect(computeRefreshDelayMs(expiresAt, now)).toBe(0);
  });

  it('已过期返回 0', () => {
    const now = 1_000_000;
    expect(computeRefreshDelayMs(now - 1, now)).toBe(0);
  });
});

describe('readJwtExpMs', () => {
  it('解析 payload.exp 为毫秒', () => {
    const expSec = 1_700_000_000;
    const payload = btoa(JSON.stringify({ exp: expSec }))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    const token = `hdr.${payload}.sig`;
    expect(readJwtExpMs(token)).toBe(expSec * 1000);
  });

  it('非法 token 返回 null', () => {
    expect(readJwtExpMs('not-a-jwt')).toBeNull();
  });
});
