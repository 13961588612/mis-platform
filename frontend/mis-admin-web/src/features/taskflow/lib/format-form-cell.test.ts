import { describe, expect, it } from 'vitest';
import type { FormFieldSchema } from '@/features/biz/forms/types';
import { formatFormCellValue, mergeFormListFields } from './format-form-cell';

const amount: FormFieldSchema = { key: 'amount', label: '申请金额', type: 'number', unit: '元' };
const pri: FormFieldSchema = {
  key: 'priority',
  label: '优先级',
  type: 'select',
  options: [{ value: 'HIGH', label: '高' }],
};
const cats: FormFieldSchema = {
  key: 'categories',
  label: '品类',
  type: 'multi',
  options: [{ value: 'HARDWARE', label: '硬件设备' }],
};
const urgent: FormFieldSchema = { key: 'urgent', label: '加急', type: 'bool' };

describe('formatFormCellValue', () => {
  it('空值显示 —', () => {
    expect(formatFormCellValue(undefined, null)).toBe('—');
    expect(formatFormCellValue(undefined, '')).toBe('—');
  });

  it('数字带千分位与单位', () => {
    expect(formatFormCellValue(amount, 128000)).toBe('128,000 元');
  });

  it('select / multi 显示 label', () => {
    expect(formatFormCellValue(pri, 'HIGH')).toBe('高');
    expect(formatFormCellValue(cats, ['HARDWARE'])).toBe('硬件设备');
  });

  it('bool 显示 是/否', () => {
    expect(formatFormCellValue(urgent, true)).toBe('是');
    expect(formatFormCellValue(urgent, false)).toBe('否');
  });

  it('mergeFormListFields 用 form_data 补齐 schema 没有的列', () => {
    const merged = mergeFormListFields(
      [{ key: 'orderNo', label: '采购单号' }],
      [{ orderNo: 'PO-1', supplier: '宜兴八佰伴' }],
    );
    expect(merged.map((f) => f.key)).toEqual(['orderNo', 'supplier']);
    expect(merged[1].label).toBe('supplier');
  });
});
