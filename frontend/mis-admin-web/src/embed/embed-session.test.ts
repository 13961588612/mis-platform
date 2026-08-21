/**
 * embed-session 多宿主会话隔离测试（QA 严过关，T07' 独立验证）。
 *
 * <p>口径：01-architecture.md §5.5 — sessionId 带 hostId 前缀（embed-{hostId}-...）；
 * localStorage key 按 hostId 分 key（mis.embed.session.{hostId}）；字符校验防注入。
 */
// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import {
  buildEmbedSessionId,
  clearEmbedSession,
  resolveRouteSessionId,
  sanitizeHostId,
} from './embed-session';

const STORAGE_PREFIX = 'mis.embed.session';

function storedKeys(): string[] {
  const keys: string[] = [];
  for (let i = 0; i < localStorage.length; i += 1) {
    keys.push(localStorage.key(i) ?? '');
  }
  return keys;
}

describe('embed-session sanitizeHostId', () => {
  it('保留 [a-zA-Z0-9_-]，去除其它字符，最长 64', () => {
    expect(sanitizeHostId('crm-web')).toBe('crm-web');
    expect(sanitizeHostId('a b/c')).toBe('abc');
    expect(sanitizeHostId('')).toBe('');
    expect(sanitizeHostId(null)).toBe('');
    expect(sanitizeHostId('x'.repeat(100))).toHaveLength(64);
  });
});

describe('embed-session 会话 id 构建', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('新会话：embed-{hostId}-{ts}-{rand} 前缀 + 合法字符', () => {
    const sid = buildEmbedSessionId('crm-web', null);
    expect(sid.startsWith('embed-crm-web-')).toBe(true);
    // 必须匹配会话合法字符集（防注入 localStorage key / 会话参数）
    expect(sid).toMatch(/^[a-zA-Z0-9_-]{1,128}$/);
  });

  it('同宿主重复构建 → 恢复已存会话（不新建）', () => {
    const sid1 = buildEmbedSessionId('crm-web', null);
    const sid2 = buildEmbedSessionId('crm-web', null);
    expect(sid2).toBe(sid1);
  });

  it('不同宿主 → 不同会话（按 host 分 key 隔离）', () => {
    const crm = buildEmbedSessionId('crm-web', null);
    const supply = buildEmbedSessionId('supply-chain-web', null);
    expect(crm.startsWith('embed-crm-web-')).toBe(true);
    expect(supply.startsWith('embed-supply-chain-web-')).toBe(true);
    expect(crm).not.toBe(supply);
  });

  it('localStorage key 按 host 分 key：mis.embed.session.{hostId}', () => {
    buildEmbedSessionId('crm-web', null);
    buildEmbedSessionId('supply-chain-web', null);
    const keys = storedKeys();
    expect(keys).toContain(`${STORAGE_PREFIX}.crm-web`);
    expect(keys).toContain(`${STORAGE_PREFIX}.supply-chain-web`);
  });

  it('sessionHint 合法 → 优先使用（续接指定会话）', () => {
    const sid = buildEmbedSessionId('crm-web', 'sess-abc-123');
    expect(sid).toBe('sess-abc-123');
  });

  it('sessionHint 非法（含注入字符）→ 忽略，走本宿主存储/新建', () => {
    const bad = buildEmbedSessionId('crm-web', 'sess" onclick="x()"');
    expect(bad).toMatch(/^[a-zA-Z0-9_-]{1,128}$/);
    expect(bad).not.toBe('sess" onclick="x()"');
  });

  it('clearEmbedSession 仅清当前宿主，不影响其它宿主', () => {
    buildEmbedSessionId('crm-web', null);
    buildEmbedSessionId('supply-chain-web', null);
    clearEmbedSession('crm-web');
    const keys = storedKeys();
    expect(keys).not.toContain(`${STORAGE_PREFIX}.crm-web`);
    expect(keys).toContain(`${STORAGE_PREFIX}.supply-chain-web`);
  });
});

describe('embed-session resolveRouteSessionId', () => {
  it('合法 :sessionId 续接', () => {
    expect(resolveRouteSessionId('sess-abc-123')).toBe('sess-abc-123');
    expect(resolveRouteSessionId(undefined)).toBeNull();
  });

  it('非法字符 → null（拒绝注入）', () => {
    expect(resolveRouteSessionId('abc/../../x')).toBeNull();
    expect(resolveRouteSessionId('a b')).toBeNull();
    expect(resolveRouteSessionId('x'.repeat(200))).toBeNull();
  });
});
