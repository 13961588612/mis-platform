import { describe, expect, it } from 'vitest';
import {
  PROCESS_TITLE_REQUIRED_MESSAGE,
  readConfigTitleField,
  resolveProcessTitle,
  withConfigTitleField,
} from './resolve-process-title';

describe('resolveProcessTitle', () => {
  it('显式 title 优先', () => {
    expect(
      resolveProcessTitle({
        explicitTitle: '补录标题',
        formConfig: '{"titleField":"orderNo"}',
        formData: { orderNo: 'PO-1' },
      }),
    ).toBe('补录标题');
  });

  it('从 titleField + formData 取值', () => {
    expect(
      resolveProcessTitle({
        formConfig: '{"titleField":"orderNo"}',
        formData: { orderNo: 'PO-2026' },
      }),
    ).toBe('PO-2026');
  });

  it('缺 titleField 或字段空 → null', () => {
    expect(resolveProcessTitle({ formConfig: '{}', formData: { orderNo: 'x' } })).toBeNull();
    expect(
      resolveProcessTitle({ formConfig: '{"titleField":"orderNo"}', formData: { orderNo: '  ' } }),
    ).toBeNull();
  });

  it('固定补录文案常量', () => {
    expect(PROCESS_TITLE_REQUIRED_MESSAGE).toBe('请补录流程标题');
  });
});

describe('config titleField helpers', () => {
  it('read / with 往返', () => {
    expect(readConfigTitleField('{"titleField":"orderNo"}')).toBe('orderNo');
    expect(withConfigTitleField('{}', 'orderNo')).toBe('{"titleField":"orderNo"}');
    expect(JSON.parse(withConfigTitleField('{"titleField":"a"}', null))).toEqual({});
  });
});
