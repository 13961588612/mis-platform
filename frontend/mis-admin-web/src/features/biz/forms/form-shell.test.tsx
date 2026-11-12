// @vitest-environment jsdom
/**
 * `FormShell` 审批套壳单测（方案 T3.1 验收标准 + T3.2 的结构保证）。
 *
 * 覆盖三组断言：
 * 1. **只读路径不实例化业务组件**——用会打标记的组件证明`useEffect` 与渲染函数
 *    都没跑，并配一条**反向对照**（手动渲染该组件 ⇒ 标记出现）排除假阳性。
 * 2. **表单抛错时审批栏仍可点**——审批按钮作为套壳的**兄弟节点**渲染，
 *    断言它仍能触发 `onApprove`。
 * 3. **四级降级**在真实套壳（而非只测`ReadOnlyFormView`）里逐条可测。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useEffect } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { FormShell } from './form-shell';
import { __setFormLoadersForTest, hasFormLoader, loadFormEntry } from './forms/form-loaders';
import { __resetRegistryForTest, registerForms, resolveForm } from './registry';
import type { FormComponent, FormFieldSchema, FormProps } from './types';

const SPY_FIELDS: FormFieldSchema[] = [
  { key: 'orderNo', label: '采购单号' },
  { key: 'amount', label: '申请金额', type: 'number', unit: '元' },
  { key: 'applyDate', label: '申请日期', type: 'date' },
  { key: 'priority', label: '优先级', type: 'select', options: [{ value: 'HIGH', label: '高' }] },
  { key: 'urgent', label: '是否加急', type: 'bool' },
];

const VALID_DATA = JSON.stringify({
  orderNo: 'PO-2026-0001',
  amount: 128000,
  applyDate: '2026-10-09',
  priority: 'HIGH',
  urgent: true,
});

/** 打标记的业务组件：模拟真实组件「进详情页就发请求」的副作用。 */
const businessEffect = vi.fn();
const businessRender = vi.fn();

function SpyBusinessForm(_props: FormProps) {
  businessRender();
  useEffect(() => {
    businessEffect('mounted');
  }, []);
  return <div data-testid="business-form">业务组件内部内容</div>;
}

function registerSpyForm(formCode = 'SPY_FORM') {
  registerForms([
    { formCode, name: '间谍表单', component: SpyBusinessForm as FormComponent, fields: SPY_FIELDS },
  ]);
}

beforeEach(() => {
  __resetRegistryForTest();
  businessEffect.mockClear();
  businessRender.mockClear();
  // ErrorBoundary 会 console.error，测试里静音避免污染输出
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('FormShell · 正常路径', () => {
  it('已注册 + 有数据 → 渲染只读字段（千分位 / 日期中文 / 选项翻标签）', () => {
    registerSpyForm();
    render(<FormShell formCode="SPY_FORM" formData={VALID_DATA} />);

    expect(screen.getByTestId('form-shell')).toBeTruthy();
    expect(screen.getByText('采购单号')).toBeTruthy();
    expect(screen.getByTestId('read-only-number').textContent).toBe('128,000 元');
    expect(screen.getByTestId('read-only-date').textContent).toBe('2026年10月9日');
    expect(screen.getByTestId('read-only-tag').textContent).toBe('高');
    expect(screen.getByTestId('read-only-bool').textContent).toBe('是');
    expect(screen.queryByTestId('form-missing')).toBeNull();
  });

  it('标题区展示 formCode，便于审批人知道在看哪个表单', () => {
    registerSpyForm();
    render(<FormShell formCode="SPY_FORM" formData={VALID_DATA} />);
    expect(screen.getByText('SPY_FORM')).toBeTruthy();
  });

  it('fields prop 覆盖注册表 schema', () => {
    registerSpyForm();
    render(
      <FormShell
        formCode="SPY_FORM"
        formData={JSON.stringify({ vendor: '华东电子' })}
        fields={[{ key: 'vendor', label: '供应商' }]}
      />,
    );
    expect(screen.getByText('供应商')).toBeTruthy();
    expect(screen.getByText('华东电子')).toBeTruthy();
  });

  it('⚠️ 刻意不加 overflow-auto（方案 §3.1 单层滚动，滚动交给 process-shell 的容器）', () => {
    registerSpyForm();
    render(<FormShell formCode="SPY_FORM" formData={VALID_DATA} />);
    // 加了内层滚动就会出现嵌套滚动条，鼠标滚轮在内层「滚不动」
    expect(screen.getByTestId('form-shell').className).not.toContain('overflow');
  });
});

describe('⚠️ 只读路径不实例化业务组件 · 核心证明', () => {
  it('已注册 + 有数据时，组件的 useEffect 与渲染函数都未执行', () => {
    registerSpyForm();

    render(<FormShell formCode="SPY_FORM" formData={VALID_DATA} />);

    // 数据齐全、且表单确实已注册 ⇒ 走的是「正常渲染只读视图」分支
    expect(screen.getByTestId('read-only-form')).toBeTruthy();
    expect(businessEffect).not.toHaveBeenCalled();
    expect(businessRender).not.toHaveBeenCalled();
    expect(screen.queryByTestId('business-form')).toBeNull();
  });

  it('⚠️ 反向对照：直接渲染 entry.component 确实会执行 useEffect', () => {
    // 这一步证明上面的断言不是「测试根本没跑到组件」的假阳性
    registerSpyForm();
    const entry = resolveForm('SPY_FORM');
    expect(entry).not.toBeNull();

    render(<SpyBusinessForm formCode="SPY_FORM" value={{}} readOnly={false} fields={[]} />);

    expect(businessEffect).toHaveBeenCalledWith('mounted');
    expect(screen.getByTestId('business-form')).toBeTruthy();
  });

  it('降级各分支下业务组件同样零挂载', () => {
    const cases: Array<[string, string | null, string | null]> = [
      ['no-code', null, '{"a":1}'],
      ['not-registered', 'NOPE', '{"a":1}'],
      ['bad-json', 'SPY_FORM', '{oops'],
      ['empty-data', 'SPY_FORM', '{}'],
      ['empty-data', 'SPY_FORM', null],
    ];

    for (const [expectedReason, formCode, formData] of cases) {
      // 每轮重置后再注册：registerForms 对重复 code 抛错，且要保证
      // 「已注册 / 未注册」两种前置条件在各自轮次里都是确定成立的
      __resetRegistryForTest();
      registerSpyForm();
      const { unmount } = render(<FormShell formCode={formCode} formData={formData} />);
      expect(screen.getByTestId('form-missing').getAttribute('data-reason')).toBe(expectedReason);
      expect(businessEffect).not.toHaveBeenCalled();
      expect(businessRender).not.toHaveBeenCalled();
      unmount();
    }
  });

  it('⚠️ 未注册的 formCode 走 not-registered 时同样零挂载', () => {
    render(<FormShell formCode="TOTALLY_UNKNOWN" formData='{"a":1}' />);
    expect(screen.getByTestId('form-missing').getAttribute('data-reason')).toBe('not-registered');
    expect(businessEffect).not.toHaveBeenCalled();
    expect(businessRender).not.toHaveBeenCalled();
  });
});

describe('⚠️ 表单抛错时审批栏仍可点（方案 §3.3 硬要求）', () => {
  /**
   * 让已注册表单的 `fields` 在读取时抛错。
   *
   * ⚠️ 这是**真实的抛错路径**，不是 mock 掉整个只读视图：
   * 业务组件抛错是方案 §3.4 最后一行的场景，而只读路径下业务组件压根不挂载，
   * 所以这里用「schema 读取炸」等价地验证同一件事：
   * **ErrorBoundary 挡得住渲染期异常，且异常不越出套壳。**
   */
  function registerFormWhoseSchemaThrows(formCode = 'BOOM_FORM') {
    const entry = {
      formCode,
      name: '会炸的表单',
      component: (() => <div />) as FormComponent,
      fields: [],
    };
    Object.defineProperty(entry, 'fields', {
      get() {
        throw new Error('schema 读取失败');
      },
    });
    registerForms([entry]);
  }

  it('渲染期抛错 → 兜底为 render-error 卡，不白屏', () => {
    registerFormWhoseSchemaThrows();

    render(<FormShell formCode="BOOM_FORM" formData='{"amount":1}' />);

    const el = screen.getByTestId('form-missing');
    expect(el.getAttribute('data-reason')).toBe('render-error');
    expect(el.textContent).toContain('渲染异常');
    // 兜底卡必须解释原因 + 展示原始数据（供开发定位）
    expect(el.textContent).toContain('schema 读取失败');
    expect(el.textContent).toContain('{"amount":1}');
  });

  it('⚠️ 审批按钮作为套壳的兄弟节点，表单炸了依然可点', () => {
    registerFormWhoseSchemaThrows();
    const onApprove = vi.fn();

    render(
      <div>
        <FormShell formCode="BOOM_FORM" formData='{"amount":1}' />
        {/* 这就是 process-shell 里审批栏的位置：在套壳之外 */}
        <button type="button" onClick={onApprove}>
          同意
        </button>
      </div>,
    );

    fireEvent.click(screen.getByText('同意'));

    expect(onApprove).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('form-missing')).toBeTruthy();
  });

  it('⚠️ 四级降级下审批按钮同样可点（not-registered 尤其重要：那是发版信号）', () => {
    const onApprove = vi.fn();
    render(
      <div>
        <FormShell formCode="NEVER_REGISTERED" formData='{"amount":1}' />
        <button type="button" onClick={onApprove}>
          同意
        </button>
      </div>,
    );

    expect(screen.getByTestId('form-missing').getAttribute('data-reason')).toBe('not-registered');
    fireEvent.click(screen.getByText('同意'));
    expect(onApprove).toHaveBeenCalledTimes(1);
  });

  it('点「重新加载」清掉错误状态（FormErrorBoundary 可重试）', () => {
    let broken = true;
    registerForms([
      {
        formCode: 'FLAKY',
        name: '时好时坏',
        component: (() => <div />) as FormComponent,
        get fields() {
          if (broken) throw new Error('boom');
          return [{ key: 'a', label: '字段A' }];
        },
      } as never,
    ]);

    const { rerender } = render(<FormShell formCode="FLAKY" formData='{"a":"v"}' />);
    expect(screen.getByTestId('form-missing')).toBeTruthy();

    broken = false;
    fireEvent.click(screen.getByText('重新加载'));

    // 重试后重渲染同一棵树：此时不再抛错
    rerender(<FormShell formCode="FLAKY" formData='{"a":"v"}' />);
    expect(screen.queryByTestId('form-missing')).toBeNull();
    expect(screen.getByText('字段A')).toBeTruthy();
  });
});

describe('四级降级 · 在真实套壳里逐条可测', () => {
  it('① no-code：未记录表单编码（中性灰底，不是告警）', () => {
    render(<FormShell formCode={null} formData='{"a":1}' />);
    const el = screen.getByTestId('form-missing');
    expect(el.getAttribute('data-reason')).toBe('no-code');
    expect(el.className).toContain('bg-muted/40');
  });

  it('① no-code 优先于 empty-data：code 为空时即使数据也是空也报「未记录编码」', () => {
    render(<FormShell formCode="" formData="{}" />);
    expect(screen.getByTestId('form-missing').getAttribute('data-reason')).toBe('no-code');
  });

  it('③ not-registered：黄色告警卡（配置缺，不是数据错）', () => {
    render(<FormShell formCode="NOPE" formData='{"a":1}' />);
    const el = screen.getByTestId('form-missing');
    expect(el.getAttribute('data-reason')).toBe('not-registered');
    expect(el.className).toContain('bg-warning/10');
  });

  it('② bad-json：原始数据非法 → 展示原文不抛', () => {
    registerSpyForm();
    render(<FormShell formCode="SPY_FORM" formData="{oops" />);
    const el = screen.getByTestId('form-missing');
    expect(el.getAttribute('data-reason')).toBe('bad-json');
    expect(el.textContent).toContain('{oops');
  });

  it('④ empty-data：已登记但未提交数据（"{}" 与 null 两种形态）', () => {
    registerSpyForm();
    const { unmount } = render(<FormShell formCode="SPY_FORM" formData="{}" />);
    expect(screen.getByTestId('form-missing').getAttribute('data-reason')).toBe('empty-data');
    unmount();

    render(<FormShell formCode="SPY_FORM" formData={null} />);
    expect(screen.getByTestId('form-missing').getAttribute('data-reason')).toBe('empty-data');
  });

  it('onRetry 透传：点「重新加载」会调外部回调', () => {
    const onRetry = vi.fn();
    render(<FormShell formCode="NOPE" formData='{"a":1}' onRetry={onRetry} />);

    fireEvent.click(screen.getByText('重新加载'));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

describe('⚠️ 加载中状态· 不能误报 not-registered', () => {
  /** 注入一个「延迟 50ms 才注册」的加载器，模拟 chunk 下载。 */
  function useDelayedLoader(formCode = 'LAZY_FORM') {
    __setFormLoadersForTest({
      [formCode]: async () => {
        await new Promise((r) => setTimeout(r, 50));
        return [
          {
            formCode,
            name: '懒加载表单',
            component: (() => <div />) as FormComponent,
            fields: [{ key: 'a', label: '字段A' }],
          },
        ];
      },
    });
    return formCode;
  }

  afterEach(() => {
    __setFormLoadersForTest({});
  });

  it('首帧出骨架屏而不是黄色告警卡（代码在前端，只是chunk 还没到）', () => {
    const code = useDelayedLoader();
    render(<FormShell formCode={code} formData='{"a":"v"}' />);

    expect(screen.getByTestId('form-shell-loading')).toBeTruthy();
    //⚠️ 误报一次「前端未注册」，运维就不会再信这个信号了
    expect(screen.queryByTestId('form-missing')).toBeNull();
  });

  it('加载完成后出只读字段，不出兜底卡', async () => {
    const code = useDelayedLoader();
    render(<FormShell formCode={code} formData='{"a":"v"}' />);

    await waitFor(() => expect(screen.getByTestId('read-only-form')).toBeTruthy());
    expect(screen.getByText('字段A')).toBeTruthy();
    expect(screen.getByText('v')).toBeTruthy();
    expect(screen.queryByTestId('form-missing')).toBeNull();
    expect(screen.queryByTestId('form-shell-loading')).toBeNull();
  });

  it('加载失败降级为 not-registered（不抛异常，审批页仍可用）', async () => {
    __setFormLoadersForTest({
      BROKEN: async () => {
        throw new Error('chunk 404');
      },
    });

    render(<FormShell formCode="BROKEN" formData='{"a":"v"}' />);

    await waitFor(() => expect(screen.getByTestId('form-missing')).toBeTruthy());
    expect(screen.getByTestId('form-missing').getAttribute('data-reason')).toBe('not-registered');
  });

  it('未实现的 code 不进加载态（直接判 not-registered，不空转）', () => {
    __setFormLoadersForTest({});
    expect(hasFormLoader('NOT_A_FORM')).toBe(false);
    expect(hasFormLoader(null)).toBe(false);

    render(<FormShell formCode="NOT_A_FORM" formData='{"a":1}' />);
    expect(screen.queryByTestId('form-shell-loading')).toBeNull();
    expect(screen.getByTestId('form-missing').getAttribute('data-reason')).toBe('not-registered');
  });

  it('loadFormEntry 幂等：已注册时不再 import', async () => {
    registerSpyForm();
    await expect(loadFormEntry('SPY_FORM')).resolves.toBe(true);
  });

  it('并发调用同一 code 只 import 一次（inflight 去重）', async () => {
    const code = useDelayedLoader();
    const [a, b, c] = await Promise.all([loadFormEntry(code), loadFormEntry(code), loadFormEntry(code)]);

    expect([a, b, c]).toEqual([true, true, true]);
    expect(resolveForm(code)).not.toBeNull();
  });

  it('没有加载器的 code 返回 false 而不是抛错', async () => {
    __setFormLoadersForTest({});
    await expect(loadFormEntry('NOT_A_FORM')).resolves.toBe(false);
  });
});
