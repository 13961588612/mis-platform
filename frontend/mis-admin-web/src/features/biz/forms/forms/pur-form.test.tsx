// @vitest-environment jsdom
/**
 * `PUR_FORM` 示例表单 + 按需加载表单测（方案 T3.4）。
 *
 * 核心断言只有一条，但它决定了老演示流程会不会白屏：
 * **`PUR_FORM` 必须能在前端被解析出来**，否则
 * `PURCHASE_APPROVAL_DEMO`（V123:145 白名单 = `ARRAY['PUR_FORM']`）
 * 的审批页永远走 `not-registered`。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { FormShell } from '../form-shell';
import { PUR_FIELDS, PurForm, purFormEntry } from './pur-form';
import {
  __setFormLoadersForTest,
  hasFormLoader,
  listFormLoaderCodes,
  loadFormEntry,
} from './form-loaders';
import { __resetRegistryForTest, resolveForm } from '../registry';

/** 与V123 演示流程对齐的一份 form_data（扁平，一层不嵌套）。 */
const DEMO_FORM_DATA = JSON.stringify({
  orderNo: 'PO-2026-0001',
  supplier: '华东电子',
  amount: 128000,
  applyDate: '2026-10-09',
  priority: 'HIGH',
  categories: ['HARDWARE', 'SERVICE'],
  urgent: true,
  reason: '新产线投产需要配套硬件',
});

beforeEach(() => {
  __resetRegistryForTest();
});

afterEach(() => {
  cleanup();
  __setFormLoadersForTest({ PUR_FORM: async () => [(await import('./pur-form')).purFormEntry] });
  vi.restoreAllMocks();
});

describe('PUR_FORM · 与既有演示数据的对齐', () => {
  it('⚠️ formCode 必须是 PUR_FORM（V123:145 白名单就是它，写错则老演示流程审批页走兜底）', () => {
    expect(purFormEntry.formCode).toBe('PUR_FORM');
    expect(purFormEntry.component).toBe(PurForm);
    expect(purFormEntry.name).toBeTruthy();
    expect(purFormEntry.fields.length).toBeGreaterThan(0);
  });

  it('⚠️ 必须登记在按需加载表里（否则审批页永远 not-registered）', () => {
    expect(hasFormLoader('PUR_FORM')).toBe(true);
    expect(listFormLoaderCodes()).toContain('PUR_FORM');
  });

  it('loadFormEntry 后注册表能解析出 PUR_FORM', async () => {
    await expect(loadFormEntry('PUR_FORM')).resolves.toBe(true);
    expect(resolveForm('PUR_FORM')).not.toBeNull();
  });

  it('⚠️ 老演示流程审批页不再走兜底：真实套壳渲染出 PUR_FORM 的字段', async () => {
    render(<FormShell formCode="PUR_FORM" formData={DEMO_FORM_DATA} />);

    await waitFor(() => expect(screen.getByTestId('read-only-form')).toBeTruthy());
    expect(screen.queryByTestId('form-missing')).toBeNull();
    expect(screen.getByText('采购单号')).toBeTruthy();
    expect(screen.getByText('供应商')).toBeTruthy();
    expect(screen.getByText('新产线投产需要配套硬件')).toBeTruthy();
  });
});

describe('PUR_FORM · 只读呈现符合方案 §3.5（不能用 disabled）', () => {
  it('数值千分位 / 日期中文 / 选项翻 label / 多选标签化 / 布尔徽标', async () => {
    render(<FormShell formCode="PUR_FORM" formData={DEMO_FORM_DATA} />);
    await waitFor(() => expect(screen.getByTestId('read-only-form')).toBeTruthy());

    // 千分位 + 单位
    expect(screen.getByTestId('read-only-number').textContent).toBe('128,000 元');
    // 日期中文化
    expect(screen.getByTestId('read-only-date').textContent).toBe('2026年10月9日');
    // HIGH → 高（而不是裸 value）
    expect(screen.getByTestId('read-only-tag').textContent).toBe('高');
    // 多选逐项翻 label
    expect(screen.getByText('硬件设备')).toBeTruthy();
    expect(screen.getByText('技术服务')).toBeTruthy();
    // bool → 绿徽「是」
    expect(screen.getByTestId('read-only-bool').textContent).toBe('是');
  });

  it('⚠️ 只读视图里没有任何可编辑控件（不是 disabled 的 input）', async () => {
    render(<FormShell formCode="PUR_FORM" formData={DEMO_FORM_DATA} />);
    await waitFor(() => expect(screen.getByTestId('read-only-form')).toBeTruthy());

    // 审批人是读者不是编辑者：不该看到 input/textarea/select 之类
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.queryByRole('switch')).toBeNull();
  });

  it('缺失的字段显示 - 而不是空白（审批人要知道「没填」而不是「页面坏了」）', async () => {
    await loadFormEntry('PUR_FORM');
    render(<FormShell formCode="PUR_FORM" formData={JSON.stringify({ orderNo: 'PO-1' })} />);

    await waitFor(() => expect(screen.getByTestId('read-only-form')).toBeTruthy());
    expect(screen.getByText('采购单号')).toBeTruthy();
    expect(screen.getAllByText('-').length).toBeGreaterThan(0);
  });

  it('⚠️ 未在 schema 中声明的键追加 details 列出（降级 ④，键缺失 label 时直接显示 key）', async () => {
    await loadFormEntry('PUR_FORM');
    render(
      <FormShell
        formCode="PUR_FORM"
        formData={JSON.stringify({ orderNo: 'PO-1', 临时备注: '口头沟通后补' })}
      />,
    );

    await waitFor(() => expect(screen.getByTestId('read-only-form')).toBeTruthy());
    expect(screen.getByText(/未在 schema 中声明的字段/)).toBeTruthy();
    expect(screen.getByText('临时备注')).toBeTruthy();
  });
});

describe('PUR_FORM · schema 约定（方案 §2.6，改字段前必读）', () => {
  it('⚠️ 键必须扁平 camelCase：嵌套会让条件表达式永远取不到值且静默走错分支', () => {
    for (const field of PUR_FIELDS) {
      expect(field.key).toMatch(/^[a-z][A-Za-z0-9]*$/);
      expect(field.key).not.toContain('.');
    }
  });

  it('键不重复（重复会让前一个字段永远渲染不出值）', () => {
    const keys = PUR_FIELDS.map((f) => f.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('label 非空（审批页展示的就是它）', () => {
    for (const field of PUR_FIELDS) {
      expect(field.label.trim()).not.toBe('');
    }
  });

  it('select / multi 字段必须声明 options，否则只读态只能显示裸 value', () => {
    for (const field of PUR_FIELDS) {
      if (field.type === 'select' || field.type === 'multi') {
        expect(field.options?.length ?? 0).toBeGreaterThan(0);
      }
    }
  });

  it('金额字段带单位（只读态会拼在数字后）', () => {
    const amount = PUR_FIELDS.find((f) => f.key === 'amount');
    expect(amount?.type).toBe('number');
    expect(amount?.unit).toBe('元');
  });
});

describe('PurForm 组件 · 录入态契约', () => {
  it('渲染出全部字段的录入控件', () => {
    render(<PurForm formCode="PUR_FORM" value={{}} readOnly={false} fields={[]} />);
    expect(screen.getByTestId('pur-form')).toBeTruthy();
    expect(screen.getByText('采购单号')).toBeTruthy();
    expect(screen.getByText('申请金额')).toBeTruthy();
  });

  it('⚠️ readOnly=true 时控件禁用，且不回调 onChange（审批页不允许改数据）', () => {
    const onChange = vi.fn();
    render(
      <PurForm formCode="PUR_FORM" value={{ orderNo: 'PO-1' }} readOnly fields={[]} onChange={onChange} />,
    );

    const input = screen.getByDisplayValue('PO-1') as HTMLInputElement;
    expect(input.disabled).toBe(true);

    fireEvent.change(input, { target: { value: 'PO-2' } });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('录入态改动通过 onChange 上抛合并后的新值', () => {
    const onChange = vi.fn();
    render(
      <PurForm
        formCode="PUR_FORM"
        value={{ orderNo: 'PO-1' }}
        readOnly={false}
        fields={[]}
        onChange={onChange}
      />,
    );

    fireEvent.change(screen.getByDisplayValue('PO-1'), { target: { value: 'PO-2' } });

    // 合并而非覆盖：其余字段不能被这次改动抹掉
    expect(onChange).toHaveBeenCalledWith({ orderNo: 'PO-2' });
  });

  it('⚠️ 审批只读路径压根不实例化本组件：DOM 里出现的是只读视图而非录入控件', async () => {
    render(<FormShell formCode="PUR_FORM" formData={DEMO_FORM_DATA} />);
    await waitFor(() => expect(screen.getByTestId('read-only-form')).toBeTruthy());

    // PurForm 的根标记是 pur-form；套壳渲染完成后它不该在DOM 里
    expect(screen.queryByTestId('pur-form')).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('fields prop 覆盖内置 schema（按流程定义版本切换字段集）', () => {
    render(
      <PurForm
        formCode="PUR_FORM"
        value={{}}
        readOnly={false}
        fields={[{ key: 'customOnly', label: '自定义字段' }]}
      />,
    );
    expect(screen.getByText('自定义字段')).toBeTruthy();
    expect(screen.queryByText('采购单号')).toBeNull();
  });
});
