/**
 * embed-env 白名单解析测试（QA 严过关，T07' 独立验证）。
 *
 * <p>口径：01-architecture.md §5.3 — VITE_PARENT_ORIGINS 逗号分隔父域白名单；
 * 空白名单 = 拒绝一切（fail-closed）。EmbedAuthBridge 与事件桥共用本模块。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { parseParentOrigins, isAllowedParentOrigin, isEmbeddedFrame } from './embed-env';

describe('embed-env 父域白名单', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('未配置 VITE_PARENT_ORIGINS → 空白名单（fail-closed）', () => {
    expect(parseParentOrigins()).toEqual([]);
    expect(isAllowedParentOrigin('https://crm.example.com')).toBe(false);
  });

  it('逗号分隔解析：去空白、忽略空项', () => {
    vi.stubEnv('VITE_PARENT_ORIGINS', ' https://crm.example.com , , https://supply.example.com ');
    expect(parseParentOrigins()).toEqual([
      'https://crm.example.com',
      'https://supply.example.com',
    ]);
  });

  it('白名单精确匹配（含端口/路径差异拒绝）', () => {
    vi.stubEnv('VITE_PARENT_ORIGINS', 'https://crm.example.com:8443');
    expect(isAllowedParentOrigin('https://crm.example.com:8443')).toBe(true);
    // 端口不同 / 子域不同 / 带路径 → 全部拒绝
    expect(isAllowedParentOrigin('https://crm.example.com')).toBe(false);
    expect(isAllowedParentOrigin('https://sub.crm.example.com:8443')).toBe(false);
    expect(isAllowedParentOrigin('https://crm.example.com:8443/foo')).toBe(false);
  });

  it('空字符串 origin → 拒绝', () => {
    vi.stubEnv('VITE_PARENT_ORIGINS', 'https://crm.example.com');
    expect(isAllowedParentOrigin('')).toBe(false);
    expect(isAllowedParentOrigin('null')).toBe(false);
  });
});

describe('embed-env isEmbeddedFrame', () => {
  it('无 window 环境（node）→ 保守按嵌入处理（true）', () => {
    // try/catch 兜底：访问 window 抛错时按嵌入处理（保守安全）
    expect(isEmbeddedFrame()).toBe(true);
  });
});
