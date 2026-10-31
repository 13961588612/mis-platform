import { describe, expect, it } from 'vitest';
import { computeRefreshDelayMs, TOKEN_REFRESH_SKEW_MS } from './refresh-token';

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
