import { describe, expect, it } from 'vitest';
import { formatInitiatorCompany } from './format-initiator';

describe('formatInitiatorCompany', () => {
  it('有公司时拼「姓名（公司）」', () => {
    expect(formatInitiatorCompany('张三', '华东分公司')).toBe('张三（华东分公司）');
  });

  it('无公司时只返回姓名', () => {
    expect(formatInitiatorCompany('张三', null)).toBe('张三');
    expect(formatInitiatorCompany('张三', '  ')).toBe('张三');
  });

  it('无姓名返回 null', () => {
    expect(formatInitiatorCompany(null, '华东分公司')).toBeNull();
    expect(formatInitiatorCompany('  ', '华东分公司')).toBeNull();
  });
});
