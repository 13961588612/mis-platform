// @vitest-environment jsdom
/**
 * 5 个新控件单测（T2.4 验收标准：5 个控件可复用）。
 *
 * Radix 的 Popover/Select 在 jsdom 下需要额外 polyfill：
 * - `ResizeObserver`：浮层尺寸测量
 * - `DOMRect` / `PointerEvent`：定位与指针捕获
 * - `hasPointerCapture` / `scrollIntoView`：交互事件
 * 缺任一项会报环境错而不是断言错，掩盖真实问题，故统一在此补齐。
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { Checkbox } from './checkbox';
import { Switch } from './switch';
import { MultiSelect } from './multi-select';
import { DateField } from './date-field';
import { NumberField, parseNumericInput } from './number-field';

beforeAll(() => {
  // Radix 浮层在 jsdom 下的环境补齐
  if (!('ResizeObserver' in globalThis)) {
    class RO {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = RO;
  }
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false;
  }
  if (!Element.prototype.setPointerCapture) {
    Element.prototype.setPointerCapture = () => {};
  }
  if (!Element.prototype.releasePointerCapture) {
    Element.prototype.releasePointerCapture = () => {};
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
  }
  if (!globalThis.DOMRect) {
    (globalThis as unknown as { DOMRect: unknown }).DOMRect = class {
      constructor(
        public x = 0,
        public y = 0,
        public width = 0,
        public height = 0,
      ) {}
      top = 0;
      left = 0;
      right = 0;
      bottom = 0;
      toJSON() {
        return {};
      }
    };
  }
});

afterEach(cleanup);

describe('Checkbox', () => {
  it('渲染 role=checkbox 且默认未选中', () => {
    render(<Checkbox aria-label="加急" />);
    const el = screen.getByRole('checkbox');
    expect(el.getAttribute('aria-checked')).toBe('false');
    expect(el.getAttribute('data-state')).toBe('unchecked');
  });

  it('checked 反映选中态', () => {
    render(<Checkbox aria-label="加急" checked />);
    const el = screen.getByRole('checkbox');
    expect(el.getAttribute('aria-checked')).toBe('true');
    expect(el.getAttribute('data-state')).toBe('checked');
  });

  it('点击触发 onCheckedChange(true)', () => {
    const onCheckedChange = vi.fn();
    render(<Checkbox aria-label="加急" onCheckedChange={onCheckedChange} />);

    fireEvent.click(screen.getByRole('checkbox'));

    expect(onCheckedChange).toHaveBeenCalledWith(true);
  });

  it('已选中时点击回传 false', () => {
    const onCheckedChange = vi.fn();
    render(<Checkbox aria-label="加急" checked onCheckedChange={onCheckedChange} />);

    fireEvent.click(screen.getByRole('checkbox'));

    expect(onCheckedChange).toHaveBeenCalledWith(false);
  });

  it('indeterminate 渲染横杠图标', () => {
    render(<Checkbox aria-label="全选" checked="indeterminate" />);
    expect(screen.getByRole('checkbox').getAttribute('data-state')).toBe('indeterminate');
  });

  it('disabled 时不触发回调', () => {
    const onCheckedChange = vi.fn();
    render(<Checkbox aria-label="加急" disabled onCheckedChange={onCheckedChange} />);

    fireEvent.click(screen.getByRole('checkbox'));

    expect(onCheckedChange).not.toHaveBeenCalled();
  });
});

describe('Switch', () => {
  it('渲染 role=switch（ARIA 标准角色）', () => {
    render(<Switch aria-label="加急" />);
    const el = screen.getByRole('switch');
    expect(el.getAttribute('aria-checked')).toBe('false');
    expect(el.getAttribute('data-state')).toBe('unchecked');
  });

  it('受控：checked 决定状态', () => {
    render(<Switch aria-label="加急" checked />);
    expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('true');
  });

  it('点击回传 !当前值', () => {
    const onCheckedChange = vi.fn();
    render(<Switch aria-label="加急" onCheckedChange={onCheckedChange} />);

    fireEvent.click(screen.getByRole('switch'));

    expect(onCheckedChange).toHaveBeenCalledWith(true);
  });

  it('非受控：内部自维护状态', () => {
    render(<Switch aria-label="加急" defaultChecked={false} />);
    const el = screen.getByRole('switch');

    fireEvent.click(el);

    expect(el.getAttribute('aria-checked')).toBe('true');
  });

  it('受控时点击不改变内部状态（父组件说了算）', () => {
    const onCheckedChange = vi.fn();
    render(<Switch aria-label="加急" checked={false} onCheckedChange={onCheckedChange} />);
    const el = screen.getByRole('switch');

    fireEvent.click(el);

    // 回调发了，但父组件没改 checked ⇒ 状态不应自变
    expect(onCheckedChange).toHaveBeenCalledWith(true);
    expect(el.getAttribute('aria-checked')).toBe('false');
  });

  it('disabled 时不触发回调', () => {
    const onCheckedChange = vi.fn();
    render(<Switch aria-label="加急" disabled onCheckedChange={onCheckedChange} />);

    fireEvent.click(screen.getByRole('switch'));

    expect(onCheckedChange).not.toHaveBeenCalled();
  });

  it('滑块位置随状态变化', () => {
    const { rerender } = render(<Switch aria-label="加急" checked={false} />);
    expect(screen.getByTestId('switch-thumb').className).toContain('translate-x-0');

    rerender(<Switch aria-label="加急" checked />);
    expect(screen.getByTestId('switch-thumb').className).toContain('translate-x-4');
  });

  it('受控包装：点击能驱动父组件 state', () => {
    function Controlled() {
      const [on, setOn] = useState(false);
      return (
        <>
          <Switch aria-label="加急" checked={on} onCheckedChange={setOn} />
          <span data-testid="mirror">{String(on)}</span>
        </>
      );
    }
    render(<Controlled />);

    fireEvent.click(screen.getByRole('switch'));

    expect(screen.getByTestId('mirror').textContent).toBe('true');
  });
});

describe('MultiSelect', () => {
  const options = [
    { value: 'HIGH', label: '高' },
    { value: 'LOW', label: '低' },
    { value: 'URGENT', label: '紧急' },
  ];

  it('无选中时显示占位文案', () => {
    render(<MultiSelect options={options} />);
    expect(screen.getByTestId('multi-select-trigger').textContent).toContain('请选择');
  });

  it('value 非空时显示中文标签而非原始值', () => {
    render(<MultiSelect options={options} value={['HIGH', 'URGENT']} />);
    const trigger = screen.getByTestId('multi-select-trigger');
    expect(trigger.textContent).toContain('高');
    expect(trigger.textContent).toContain('紧急');
    expect(trigger.textContent).not.toContain('HIGH');
  });

  it('未登记的值原样显示（不丢数据）', () => {
    render(<MultiSelect options={options} value={['MYSTERY']} />);
    expect(screen.getByTestId('multi-select-trigger').textContent).toContain('MYSTERY');
  });

  it('点「清空」清空全部选中', () => {
    const onChange = vi.fn();
    render(<MultiSelect options={options} value={['HIGH', 'LOW']} onChange={onChange} />);

    fireEvent.click(screen.getByTestId('multi-select-clear'));

    expect(onChange).toHaveBeenCalledWith([]);
  });

  it('无选中时不显示清空按钮', () => {
    render(<MultiSelect options={options} value={[]} />);
    expect(screen.queryByTestId('multi-select-clear')).toBeNull();
  });

  it('点击触发器打开浮层并列出全部选项', () => {
    render(<MultiSelect options={options} />);

    fireEvent.click(screen.getByTestId('multi-select-trigger'));

    expect(screen.getAllByTestId('multi-select-option')).toHaveLength(3);
    expect(screen.getByText('低')).toBeTruthy();
  });

  it('浮层内勾选后回调带上新值', async () => {
    const onChange = vi.fn();
    render(<MultiSelect options={options} value={[]} onChange={onChange} />);
    fireEvent.click(screen.getByTestId('multi-select-trigger'));

    const checkboxes = screen.getAllByRole('checkbox');
    fireEvent.click(checkboxes[0]);

    expect(onChange).toHaveBeenCalledWith(['HIGH']);
  });

  it('再次点击已选项则移除', async () => {
    const onChange = vi.fn();
    render(<MultiSelect options={options} value={['HIGH']} onChange={onChange} />);
    fireEvent.click(screen.getByTestId('multi-select-trigger'));

    fireEvent.click(screen.getAllByRole('checkbox')[0]);

    expect(onChange).toHaveBeenCalledWith([]);
  });

  it('options 为空时浮层内显示空态', () => {
    render(<MultiSelect options={[]} />);
    fireEvent.click(screen.getByTestId('multi-select-trigger'));
    expect(screen.getByText('暂无可选项')).toBeTruthy();
  });

  it('非受控：内部维护选中值', () => {
    render(<MultiSelect options={options} defaultValue={[]} />);
    fireEvent.click(screen.getByTestId('multi-select-trigger'));

    fireEvent.click(screen.getAllByRole('checkbox')[1]);

    expect(screen.getByTestId('multi-select-trigger').textContent).toContain('低');
  });

  it('自定义 placeholder 生效', () => {
    render(<MultiSelect options={options} placeholder="选择优先级" />);
    expect(screen.getByTestId('multi-select-trigger').textContent).toContain('选择优先级');
  });

  it('disabled 时触发器不可点', () => {
    render(<MultiSelect options={options} disabled />);
    expect(screen.getByTestId('multi-select-trigger')).toHaveProperty('disabled', true);
  });

  it('选项面板有最大高度（超出滚动，不撑破浮层）', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ value: `V${i}`, label: `选项${i}` }));
    render(<MultiSelect options={many} maxHeight={120} />);
    fireEvent.click(screen.getByTestId('multi-select-trigger'));

    const scroller = screen.getByText('选项0').parentElement?.parentElement;
    expect(scroller?.style.maxHeight).toBe('120px');
  });
});

describe('DateField', () => {
  it('渲染 type=date 的原生输入', () => {
    render(<DateField />);
    const el = screen.getByTestId('date-field');
    expect(el.getAttribute('type')).toBe('date');
  });

  it('受控：显示传入的 yyyy-MM-dd', () => {
    render(<DateField value="2026-10-09" />);
    expect(screen.getByTestId('date-field')).toHaveProperty('value', '2026-10-09');
  });

  it('变更时回调字符串（不是 Date，避免调用方再序列化一次）', () => {
    const onChange = vi.fn();
    render(<DateField value="" onChange={onChange} />);

    fireEvent.change(screen.getByTestId('date-field'), { target: { value: '2026-10-09' } });

    expect(onChange).toHaveBeenCalledWith('2026-10-09');
  });

  it('清空时同时触发 onClear', () => {
    const onChange = vi.fn();
    const onClear = vi.fn();
    render(<DateField value="2026-10-09" onChange={onChange} onClear={onClear} />);

    fireEvent.change(screen.getByTestId('date-field'), { target: { value: '' } });

    expect(onChange).toHaveBeenCalledWith('');
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it('非受控：内部维护值', () => {
    render(<DateField defaultValue="2026-01-01" />);
    const el = screen.getByTestId('date-field');

    fireEvent.change(el, { target: { value: '2026-12-31' } });

    expect(el).toHaveProperty('value', '2026-12-31');
  });

  it('透传 min / max（原生控件负责范围校验）', () => {
    render(<DateField min="2026-01-01" max="2026-12-31" />);
    const el = screen.getByTestId('date-field');
    expect(el).toHaveProperty('min', '2026-01-01');
    expect(el).toHaveProperty('max', '2026-12-31');
  });

  it('无 value 时默认空串（不是 undefined，避免 React 受控警告）', () => {
    render(<DateField />);
    expect(screen.getByTestId('date-field')).toHaveProperty('value', '');
  });
});

describe('NumberField', () => {
  it('渲染 type=number', () => {
    render(<NumberField />);
    expect(screen.getByTestId('number-field').getAttribute('type')).toBe('number');
  });

  it('受控：显示传入数字', () => {
    render(<NumberField value={42} />);
    expect(screen.getByTestId('number-field')).toHaveProperty('value', '42');
  });

  it('变更时回调数字', () => {
    const onChange = vi.fn();
    render(<NumberField value={0} onChange={onChange} />);

    fireEvent.change(screen.getByTestId('number-field'), { target: { value: '128.5' } });

    expect(onChange).toHaveBeenCalledWith(128.5);
  });

  it('⚠️ 中间态（空串）回调 null 而不是 NaN', () => {
    const onChange = vi.fn();
    render(<NumberField value={1} onChange={onChange} />);

    fireEvent.change(screen.getByTestId('number-field'), { target: { value: '' } });

    expect(onChange).toHaveBeenCalledWith(null);
    expect(onChange.mock.calls[0][0]).not.toBeNaN();
  });

  it('⚠️ 负数与小数正确解析', () => {
    const onChange = vi.fn();
    render(<NumberField value={0} onChange={onChange} />);

    fireEvent.change(screen.getByTestId('number-field'), { target: { value: '-3.75' } });

    expect(onChange).toHaveBeenCalledWith(-3.75);
  });

  it('⚠️ 输入非法串时浏览器会净化 DOM value，但回调拿到 null 而非 NaN', () => {
    const onChange = vi.fn();
    render(<NumberField defaultValue={0} onChange={onChange} />);
    const el = screen.getByTestId('number-field');

    // ⚠️ 实测结论（不是推测）：`type="number"` 走 HTML 规范的 value sanitization 算法，
    // 非法串（'-' / '1e'）会被浏览器清成 ''。所以**不存在**「非法串显示在输入框里」
    // 这种状态 —— 无需自己维护中间态字符串。
    // 但**回调仍然会拿到这个被净化成 '' 的串**，此时必须给 null：
    // Number('') === 0，直接透传会把用户「正在清空」误记成「金额为 0」。
    fireEvent.change(el, { target: { value: '-' } });

    expect(onChange).toHaveBeenCalledWith(null);
    expect(onChange.mock.calls[0][0]).not.toBeNaN();
    expect(el).toHaveProperty('value', '');
  });

  it('带 unit 时渲染单位后缀', () => {
    const { container } = render(<NumberField unit="元" />);
    expect(container.textContent).toContain('元');
  });

  it('parseNumericInput 拒绝非数字串', () => {
    expect(parseNumericInput('')).toBeNull();
    expect(parseNumericInput('  ')).toBeNull();
    expect(parseNumericInput('abc')).toBeNull();
    expect(parseNumericInput('Infinity')).toBeNull();
    expect(parseNumericInput('0')).toBe(0);
    expect(parseNumericInput('-1e3')).toBe(-1000);
  });

  it('透传 min / max / step', () => {
    render(<NumberField min={0} max={100} step={0.01} />);
    const el = screen.getByTestId('number-field');
    expect(el).toHaveProperty('min', '0');
    expect(el).toHaveProperty('step', '0.01');
  });

  it('受控包装：清空时父组件收到 null', () => {
    function Controlled() {
      const [v, setV] = useState<number | null>(5);
      return (
        <>
          <NumberField value={v} onChange={setV} />
          <span data-testid="mirror">{String(v)}</span>
        </>
      );
    }
    render(<Controlled />);

    fireEvent.change(screen.getByTestId('number-field'), { target: { value: '' } });

    expect(screen.getByTestId('mirror').textContent).toBe('null');
  });
});
