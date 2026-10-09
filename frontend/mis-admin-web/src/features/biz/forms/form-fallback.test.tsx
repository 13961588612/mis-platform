// @vitest-environment jsdom
/**
 * 兜底与边界单测（方案 T2.3验收标准：四级降级逐条可测）。
 *
 * 核心用例是最后一块「只读态不实例化业务组件」：
 * 注册一个在 `useEffect` 里打标记的组件，渲染只读视图，断言标记**未被写入**。
 * 这测的是**真实逻辑**——`ReadOnlyFormView` 真的走了一遍 resolveForm 分支，
 * 而不是用一个「已知只读」的替身绕开判断。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useEffect } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ReadOnlyFormView } from './read-only-form-view';
import { FormEmptyHint, FormMissing } from './form-missing';
import { FormErrorBoundary } from './form-error-boundary';
import { isEmptyFormData, isNoData, parseFormData } from './parse-form-data';
import { __resetRegistryForTest, registerForms, resolveForm } from './registry';
import type { FormComponent, FormFieldSchema, FormProps } from './types';

const FIELDS: FormFieldSchema[] = [
  { key: 'orderNo', label: '订单号' },
  { key: 'amount', label: '申请金额', type: 'number', unit: '元' },
  { key: 'applyDate', label: '申请日期', type: 'date' },
  { key: 'priority', label: '优先级', type: 'select', options: [{ value: 'HIGH', label: '高' }] },
  { key: 'urgent', label: '是否加急', type: 'bool' },
];

/**
 * 会打标记的业务组件：模拟真实组件「进详情页就发请求」的副作用。
 * ⚠️ 这个标记是本文件的核心断言对象。
 */
const businessEffect = vi.fn();
const businessRender = vi.fn();

function SpyBusinessForm(_props: FormProps) {
  businessRender();
  useEffect(() => {
    businessEffect('mounted');
  }, []);
  return <div data-testid="business-form">业务组件内部内容</div>;
}

function registerSpyForm(formCode = 'PUR_FORM') {
  registerForms([
    {
      formCode,
      name: '采购申请单',
      component: SpyBusinessForm as FormComponent,
      fields: FIELDS,
    },
  ]);
}

beforeEach(() => {
  __resetRegistryForTest();
  businessEffect.mockClear();
  businessRender.mockClear();
  // React 的 error boundary 兜底会打日志，测试里静音避免污染输出
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('parseFormData', () => {
  it('解析合法扁平对象', () => {
    const r = parseFormData('{"a":1,"b":"x"}');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data).toEqual({ a: 1, b: 'x' });
  });

  it('null / undefined / 空串判为失败', () => {
    expect(parseFormData(null).ok).toBe(false);
    expect(parseFormData(undefined).ok).toBe(false);
    expect(parseFormData('   ').ok).toBe(false);
  });

  it('非法 JSON 判为失败并保留原文', () => {
    const r = parseFormData('{oops');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.raw).toBe('{oops');
  });

  it('⚠️ 解析成功但形状不对（数组/标量/null）也判为失败', () => {
    // 按对象渲染数组会渲染出空表单，比明确报错更糟
    expect(parseFormData('[1,2]').ok).toBe(false);
    expect(parseFormData('123').ok).toBe(false);
    expect(parseFormData('null').ok).toBe(false);
    expect(parseFormData('"str"').ok).toBe(false);
  });

  it('isEmptyFormData 判空对象', () => {
    expect(isEmptyFormData({})).toBe(true);
    expect(isEmptyFormData({ a: 1 })).toBe(false);
  });

  it('⚠️ isNoData 与 !parsed.ok 必须区分（否则真数据故障会被显示成「没提交数据」）', () => {
    // 「压根没数据」
    expect(isNoData(null)).toBe(true);
    expect(isNoData(undefined)).toBe(true);
    expect(isNoData('')).toBe(true);
    expect(isNoData('   ')).toBe(true);
    // 「有数据但是坏的」—— isNoData 必须为 false，否则降级文案跑偏
    expect(isNoData('{oops')).toBe(false);
    expect(isNoData('{}')).toBe(false);
    expect(isNoData('[1,2]')).toBe(false);
  });
});

describe('四级降级 · 从上到下依次判定', () => {
  it('① no-code：startedFormCode 为 null → 未记录表单编码（中性灰底）', () => {
    const { container } = render(<ReadOnlyFormView formCode={null} formData='{"a":1}' />);

    const el = screen.getByTestId('form-missing');
    expect(el.getAttribute('data-reason')).toBe('no-code');
    expect(el.textContent).toContain('本流程实例未记录表单编码');
    // 不是告警色
    expect(el.className).toContain('bg-muted/40');
  });

  it('① no-code：空串等同 null', () => {
    render(<ReadOnlyFormView formCode="" formData='{"a":1}' />);
    expect(screen.getByTestId('form-missing').getAttribute('data-reason')).toBe('no-code');
  });

  it('⚠️ no-code 优先于 empty-data：code 为空时即使数据也是空也报「未记录编码」', () => {
    render(<ReadOnlyFormView formCode={null} formData="{}" />);
    // 顺序错了会变成 empty-data，误导成「表单没有数据」
    expect(screen.getByTestId('form-missing').getAttribute('data-reason')).toBe('no-code');
  });

  it('④ not-registered：后台有前端无 → 黄色告警卡', () => {
    render(<ReadOnlyFormView formCode="NOT_REGISTERED" formData='{"a":1}' />);

    const el = screen.getByTestId('form-missing');
    expect(el.getAttribute('data-reason')).toBe('not-registered');
    expect(el.textContent).toContain('尚未在前端注册');
    expect(el.className).toContain('bg-warning/10');
  });

  it('④ not-registered 优先级高于 bad-json（先说「没注册」，再说数据问题）', () => {
    render(<ReadOnlyFormView formCode="NOT_REGISTERED" formData="{oops" />);
    expect(screen.getByTestId('form-missing').getAttribute('data-reason')).toBe('not-registered');
  });

  it('② bad-json：已注册但 form_data 非法 → 展示原文', () => {
    registerSpyForm();
    render(<ReadOnlyFormView formCode="PUR_FORM" formData="{oops" />);

    const el = screen.getByTestId('form-missing');
    expect(el.getAttribute('data-reason')).toBe('bad-json');
    expect(el.textContent).toContain('原始数据解析失败');
    expect(el.textContent).toContain('{oops');
  });

  it('③ empty-data：已注册但 form_data 为 "{}" ', () => {
    registerSpyForm();
    render(<ReadOnlyFormView formCode="PUR_FORM" formData="{}" />);

    const el = screen.getByTestId('form-missing');
    expect(el.getAttribute('data-reason')).toBe('empty-data');
    expect(el.textContent).toContain('已登记，但本次发起未提交任何数据');
  });

  it('③ empty-data：form_data 为 null', () => {
    registerSpyForm();
    render(<ReadOnlyFormView formCode="PUR_FORM" formData={null} />);
    expect(screen.getByTestId('form-missing').getAttribute('data-reason')).toBe('empty-data');
  });

  it('全部通过 → 渲染只读字段（无 form-missing）', () => {
    registerSpyForm();
    render(
      <ReadOnlyFormView
        formCode="PUR_FORM"
        formData={JSON.stringify({ orderNo: 'PO-001', amount: 128000, applyDate: '2026-10-09', priority: 'HIGH', urgent: true })}
      />,
    );

    expect(screen.queryByTestId('form-missing')).toBeNull();
    expect(screen.getByTestId('read-only-form')).toBeTruthy();
    expect(screen.getByText('订单号')).toBeTruthy();
    expect(screen.getByTestId('read-only-number').textContent).toBe('128,000 元');
  });

  it('fields prop覆盖注册表里的 schema', () => {
    registerSpyForm();
    render(
      <ReadOnlyFormView
        formCode="PUR_FORM"
        formData={JSON.stringify({ custom: 'v' })}
        fields={[{ key: 'custom', label: '自定义字段' }]}
      />,
    );
    expect(screen.getByText('自定义字段')).toBeTruthy();
    expect(screen.getByText('v')).toBeTruthy();
  });
});

describe('FormMissing · 细节行为', () => {
  it('提供 onRetry 时才显示「重新加载」', () => {
    const { unmount } = render(<FormMissing reason="not-registered" formCode="X" />);
    expect(screen.queryByText('重新加载')).toBeNull();
    unmount();

    render(<FormMissing reason="not-registered" formCode="X" onRetry={() => {}} />);
    expect(screen.getByText('重新加载')).toBeTruthy();
  });

  it('点击「重新加载」触发 onRetry', () => {
    const onRetry = vi.fn();
    render(<FormMissing reason="not-registered" formCode="X" onRetry={onRetry} />);

    fireEvent.click(screen.getByText('重新加载'));

    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('rawData 为空时不展示「查看原始数据」', () => {
    render(<FormMissing reason="empty-data" formCode="X" rawData={null} />);
    expect(screen.queryByText('查看原始数据')).toBeNull();
  });

  it('rawData 为对象时 pretty-print', () => {
    render(<FormMissing reason="empty-data" formCode="X" rawData={{ a: 1 }} />);
    expect(screen.getByText(/"a": 1/)).toBeTruthy();
  });

  it('rawData 为空串时不展示（trim 后为空）', () => {
    render(<FormMissing reason="empty-data" formCode="X" rawData="   " />);
    expect(screen.queryByText('查看原始数据')).toBeNull();
  });

  it('not-registered + formName 时补充后台登记名', () => {
    render(<FormMissing reason="not-registered" formCode="PUR_FORM" formName="采购申请单" />);
    expect(screen.getByText(/后台登记名称：采购申请单/)).toBeTruthy();
  });

  it('每个 reason 的文案互不相同', () => {
    const reasons = ['no-code', 'empty-data', 'bad-json', 'not-registered', 'render-error'] as const;
    const titles = reasons.map((r) => {
      const { unmount } = render(<FormMissing reason={r} formCode="X" />);
      const text = screen.getByTestId('form-missing').textContent ?? '';
      unmount();
      return text;
    });
    expect(new Set(titles).size).toBe(reasons.length);
  });

  it('FormEmptyHint 渲染空态', () => {
    render(<FormEmptyHint>暂无表单数据</FormEmptyHint>);
    expect(screen.getByText('暂无表单数据')).toBeTruthy();
  });
});

describe('FormErrorBoundary', () => {
  /** 一个渲染期必定抛错的组件（业务组件典型 bug：值是 undefined 却调toFixed）。 */
  function BoomForm(): JSX.Element {
    throw new Error('amount is undefined');
  }

  it('子组件正常时原样渲染 children', () => {
    render(
      <FormErrorBoundary>
        <div data-testid="ok">正常内容</div>
      </FormErrorBoundary>,
    );
    expect(screen.getByTestId('ok')).toBeTruthy();
  });

  it('⚠️ 子组件抛错时兜底为 render-error 卡，不白屏', () => {
    render(
      <FormErrorBoundary formCode="PUR_FORM">
        <BoomForm />
      </FormErrorBoundary>,
    );

    const el = screen.getByTestId('form-missing');
    expect(el.getAttribute('data-reason')).toBe('render-error');
    expect(el.textContent).toContain('渲染异常');
  });

  it('⚠️ 兜底卡展示错误信息与原始数据（供开发定位）', () => {
    render(
      <FormErrorBoundary formCode="PUR_FORM" rawData='{"amount":null}'>
        <BoomForm />
      </FormErrorBoundary>,
    );

    expect(screen.getByText(/amount is undefined/)).toBeTruthy();
    // ⚠️ rawData 是字符串时**原样展示**（不 pretty-print）：
    // 排查数据故障时要看到后端返回的字节原貌，而不是我们改写过的版本。
    expect(screen.getByText('{"amount":null}')).toBeTruthy();
  });

  it('rawData 是对象时反而会 pretty-print（给人看）', () => {
    render(<FormMissing reason="bad-json" formCode="X" rawData={{ amount: null }} />);
    expect(screen.getByText(/"amount": null/)).toBeTruthy();
  });

  it('⚠️ 只挡表单不挡审批栏：兄弟节点的同意/驳回按钮依然可点', () => {
    const onApprove = vi.fn();
    render(
      <div>
        <FormErrorBoundary formCode="PUR_FORM">
          <BoomForm />
        </FormErrorBoundary>
        <button type="button" onClick={onApprove}>
          同意
        </button>
      </div>,
    );

    fireEvent.click(screen.getByText('同意'));

    expect(onApprove).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('form-missing')).toBeTruthy();
  });

  it('点「重新加载」清空错误状态并回调（可重新拉数据）', () => {
    const onRetry = vi.fn();
    let shouldThrow = true;
    function Flaky(): JSX.Element {
      if (shouldThrow) throw new Error('boom');
      return <div data-testid="recovered">修好了</div>;
    }

    render(
      <FormErrorBoundary onRetry={onRetry}>
        <Flaky />
      </FormErrorBoundary>,
    );
    expect(screen.getByTestId('form-missing')).toBeTruthy();

    shouldThrow = false;
    fireEvent.click(screen.getByText('重新加载'));

    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('recovered')).toBeTruthy();
    expect(screen.queryByTestId('form-missing')).toBeNull();
  });
});

describe('⚠️ 只读态不实例化业务组件 · 核心证明', () => {
  it('已注册 + 有数据时，组件的 useEffect 与渲染函数都未被执行', () => {
    registerSpyForm();

    render(
      <ReadOnlyFormView
        formCode="PUR_FORM"
        formData={JSON.stringify({ orderNo: 'PO-001', amount: 128000 })}
      />,
    );

    // 数据齐全、且表单确实已注册 ⇒ 走的是「正常渲染只读视图」分支
    expect(screen.getByTestId('read-only-form')).toBeTruthy();
    // 关键断言：业务组件零挂载
    expect(businessEffect).not.toHaveBeenCalled();
    expect(businessRender).not.toHaveBeenCalled();
    expect(screen.queryByTestId('business-form')).toBeNull();
  });

  it('⚠️ 反向对照：录入态（渲染 entry.component）确实会执行 useEffect', () => {
    // 这一步证明上面的断言不是「测试根本没跑到组件」的假阳性
    registerSpyForm();
    const entry = resolveForm('PUR_FORM');
    expect(entry).not.toBeNull();
    const BusinessForm = entry!.component;

    render(<BusinessForm formCode="PUR_FORM" value={{}} readOnly={false} fields={[]} />);

    expect(businessEffect).toHaveBeenCalledWith('mounted');
    expect(screen.getByTestId('business-form')).toBeTruthy();
  });

  it('降级各分支下业务组件同样零挂载', () => {
    registerSpyForm();
    const cases: Array<[string, string | null]> = [
      ['no-code', '{"a":1}'],
      ['not-registered', '{"a":1}'],
      ['bad-json', '{oops'],
      ['empty-data', '{}'],
    ];

    for (const [expectedReason, formData] of cases) {
      __resetRegistryForTest();
      registerSpyForm();
      const { unmount } = render(
        <ReadOnlyFormView formCode={expectedReason === 'no-code' ? null : expectedReason === 'not-registered' ? 'NOPE' : 'PUR_FORM'} formData={formData} />,
      );

      expect(screen.getByTestId('form-missing').getAttribute('data-reason')).toBe(expectedReason);
      expect(businessEffect).not.toHaveBeenCalled();
      expect(businessRender).not.toHaveBeenCalled();
      unmount();
    }
  });

  it('⚠️ 同一实例在只读/录入间切换时，只读帧不执行 effect', () => {
    registerSpyForm();
    const { rerender } = render(
      <ReadOnlyFormView formCode="PUR_FORM" formData={JSON.stringify({ orderNo: 'PO-001' })} />,
    );
    expect(businessEffect).not.toHaveBeenCalled();

    // 切到录入态：这次才应该挂载业务组件
    const entry = resolveForm('PUR_FORM');
    const BusinessForm = entry!.component;
    rerender(<BusinessForm formCode="PUR_FORM" value={{ orderNo: 'PO-001' }} readOnly={false} fields={FIELDS} />);

    expect(businessEffect).toHaveBeenCalledTimes(1);
  });
});
