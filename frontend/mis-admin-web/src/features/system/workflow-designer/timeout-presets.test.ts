import { describe, expect, it } from 'vitest';
import { TIMEOUT_PRESETS, formatTimeoutHours } from './timeout-presets';

describe('timeout-presets', () => {
  it('快捷含 1天～1年并换算为小时', () => {
    expect(TIMEOUT_PRESETS.map((p) => p.label)).toEqual([
      '1天',
      '2天',
      '3天',
      '1周',
      '2周',
      '1月',
      '3月',
      '6月',
      '1年',
    ]);
    expect(TIMEOUT_PRESETS.find((p) => p.label === '1天')?.hours).toBe(24);
    expect(TIMEOUT_PRESETS.find((p) => p.label === '1周')?.hours).toBe(168);
    expect(TIMEOUT_PRESETS.find((p) => p.label === '1月')?.hours).toBe(720);
    expect(TIMEOUT_PRESETS.find((p) => p.label === '1年')?.hours).toBe(8760);
  });

  it('formatTimeoutHours 命中快捷显示中文', () => {
    expect(formatTimeoutHours(24)).toBe('1天');
    expect(formatTimeoutHours(25)).toBe('25h');
  });
});
