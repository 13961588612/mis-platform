// @vitest-environment jsdom
/**
 * 只读字段渲染器单测（方案 T2.2 验收标准）。
 *
 * 覆盖：number 千分位 / date 中文化 / select 与 multi 翻 label / bool 是-否 /
 * 非法日期原样显示 / 非法数值原样 / 0 与 false 不被吞成占位符 /
 * 逗号串容错 / 降级 ④ 未声明字段。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useEffect } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import {
  EMPTY_PLACEHOLDER,
  ReadOnlyBool,
  ReadOnlyDate,
  ReadOnlyField,
  ReadOnlyForm,
  ReadOnlyMulti,
  ReadOnlyNumber,
  ReadOnlyTag,
  ReadOnlyText,
  findLabel,
  formatDateCn,
  parseBoolValue,
  parseDateValue,
  toFiniteNumber,
  toStringList,
} from './index';

afterEach(cleanup);

describe('ReadOnlyText', () => {
  it('原样输出字符串', () => {
    render(<ReadOnlyText value="华东电子" />);
    expect(screen.getByText('华东电子')).toBeTruthy();
  });

  it('空值显示 -', () => {
    const { container } = render(<ReadOnlyText value={null} />);
    expect(container.textContent).toBe(EMPTY_PLACEHOLDER);
  });

  it('空白字符串也当空值', () => {
    const { container } = render(<ReadOnlyText value="   " />);
    expect(container.textContent).toBe(EMPTY_PLACEHOLDER);
  });

  it('multiline 保留换行（whitespace-pre-wrap）', () => {
    const { container } = render(<ReadOnlyText value={'第一行\n第二行'} multiline />);
    const el = container.querySelector('[data-testid="read-only-text"]');
    expect(el?.className).toContain('whitespace-pre-wrap');
    expect(el?.className).toContain('min-h-[72px]');
  });
});

describe('ReadOnlyNumber · 千分位', () => {
  it('128000 → 128,000', () => {
    render(<ReadOnlyNumber value={128000} />);
    expect(screen.getByTestId('read-only-number').textContent).toBe('128,000');
  });

  it('小数保留两位', () => {
    render(<ReadOnlyNumber value={128000.5} />);
    expect(screen.getByTestId('read-only-number').textContent).toBe('128,000.5');
  });

  it('负数带负号千分位', () => {
    render(<ReadOnlyNumber value={-1500} />);
    expect(screen.getByTestId('read-only-number').textContent).toBe('-1,500');
  });

  it('⚠️ 0 渲染成 0 而不是 -（金额 0 是有效业务值）', () => {
    render(<ReadOnlyNumber value={0} />);
    expect(screen.getByTestId('read-only-number').textContent).toBe('0');
  });

  it('带 unit 时拼在后面', () => {
    render(<ReadOnlyNumber value={128000} unit="元" />);
    expect(screen.getByTestId('read-only-number').textContent).toBe('128,000 元');
  });

  it('数字字符串也走千分位', () => {
    render(<ReadOnlyNumber value="128000" />);
    expect(screen.getByTestId('read-only-number').textContent).toBe('128,000');
  });

  it('⚠️ 无法解析成数字的值原样输出（不吞成 -）', () => {
    render(<ReadOnlyNumber value="PO-2026-0001" />);
    expect(screen.getByTestId('read-only-number-raw').textContent).toBe('PO-2026-0001');
  });

  it('空值显示 -', () => {
    const { container } = render(<ReadOnlyNumber value={null} />);
    expect(container.textContent).toBe(EMPTY_PLACEHOLDER);
  });

  it('toFiniteNumber 拒绝 NaN / Infinity / 空串', () => {
    expect(toFiniteNumber(Number.NaN)).toBeNull();
    expect(toFiniteNumber(Number.POSITIVE_INFINITY)).toBeNull();
    expect(toFiniteNumber('')).toBeNull();
    expect(toFiniteNumber('  ')).toBeNull();
    expect(toFiniteNumber(true)).toBeNull();
    expect(toFiniteNumber('12abc')).toBeNull();
    expect(toFiniteNumber('-3.5')).toBe(-3.5);
    expect(toFiniteNumber('1e3')).toBe(1000);
  });
});

describe('ReadOnlyDate · 中文化', () => {
  it('2026-10-09 → 2026年10月9日', () => {
    render(<ReadOnlyDate value="2026-10-09" />);
    expect(screen.getByTestId('read-only-date').textContent).toBe('2026年10月9日');
  });

  it('datetime 带出时分', () => {
    render(<ReadOnlyDate value="2026-10-09T14:30:00" showTime />);
    expect(screen.getByTestId('read-only-date').textContent).toBe('2026年10月9日 14:30');
  });

  it('⚠️ 不做时区偏移：YYYY-MM-DD 按本地日历解读（不用 new Date(str)）', () => {
    // 若用 new Date('2026-10-09') 会解析成 UTC 午夜，非东八区显示成 10月8日
    render(<ReadOnlyDate value="2026-10-09" />);
    expect(screen.getByTestId('read-only-date').textContent).toBe('2026年10月9日');
  });

  it('date 类型即使值里带时间也不显示时分', () => {
    render(<ReadOnlyDate value="2026-10-09T14:30:00" showTime={false} />);
    expect(screen.getByTestId('read-only-date').textContent).toBe('2026年10月9日');
  });

  it('⚠️ 非法日期值原样显示', () => {
    render(<ReadOnlyDate value="不是日期" />);
    expect(screen.getByTestId('read-only-date-raw').textContent).toBe('不是日期');
  });

  it('⚠️ 格式对但日期不存在（2026-02-30）原样显示', () => {
    render(<ReadOnlyDate value="2026-02-30" />);
    expect(screen.getByTestId('read-only-date-raw').textContent).toBe('2026-02-30');
  });

  it('⚠️ 时间越界（25:00）原样显示', () => {
    render(<ReadOnlyDate value="2026-10-09T25:00:00" showTime />);
    expect(screen.getByTestId('read-only-date-raw').textContent).toBe('2026-10-09T25:00:00');
  });

  it('空值显示 -', () => {
    const { container } = render(<ReadOnlyDate value={null} />);
    expect(container.textContent).toBe(EMPTY_PLACEHOLDER);
  });

  it('parseDateValue 支持斜杠分隔与单位数月日', () => {
    expect(parseDateValue('2026/1/9')).toEqual({ year: 2026, month: 1, day: 9 });
    expect(parseDateValue('2026-10-09 08:05')).toEqual({
      year: 2026,
      month: 10,
      day: 9,
      hour: 8,
      minute: 5,
      second: 0,
    });
  });

  it('parseDateValue 对非字符串返回 null', () => {
    expect(parseDateValue(20261009)).toBeNull();
    expect(parseDateValue(null)).toBeNull();
  });

  it('formatDateCn 单数字不补零（月日用中文数字习惯）', () => {
    expect(formatDateCn({ year: 2026, month: 1, day: 5 })).toBe('2026年1月5日');
  });
});

describe('ReadOnlyTag · select 翻 label', () => {
  const options = [
    { value: 'HIGH', label: '高' },
    { value: 'LOW', label: '低' },
  ];

  it('HIGH → 高', () => {
    render(<ReadOnlyTag value="HIGH" options={options} />);
    expect(screen.getByTestId('read-only-tag').textContent).toBe('高');
  });

  it('⚠️ 查不到选项时显示原值并标黄（发版不同步信号）', () => {
    render(<ReadOnlyTag value="URGENT" options={options} />);
    const el = screen.getByTestId('read-only-tag-unknown');
    expect(el.textContent).toBe('URGENT');
    expect(el.className).toContain('text-warning');
  });

  it('没有 options 时一律走未登记分支', () => {
    render(<ReadOnlyTag value="HIGH" />);
    expect(screen.getByTestId('read-only-tag-unknown').textContent).toBe('HIGH');
  });

  it('空值显示 -', () => {
    const { container } = render(<ReadOnlyTag value={null} options={options} />);
    expect(container.textContent).toBe(EMPTY_PLACEHOLDER);
  });

  it('findLabel 命中返回 label，未命中返回 null', () => {
    expect(findLabel(options, 'LOW')).toBe('低');
    expect(findLabel(options, 'NOPE')).toBeNull();
    expect(findLabel(undefined, 'LOW')).toBeNull();
  });
});

describe('ReadOnlyMulti · 多选翻 label', () => {
  const options = [
    { value: 'A', label: '高' },
    { value: 'B', label: '紧急' },
    { value: 'C', label: '加急' },
    { value: 'D', label: '超时' },
  ];

  it('逐项翻成中文标签', () => {
    render(<ReadOnlyMulti value={['A', 'B']} options={options} />);
    const box = screen.getByTestId('read-only-multi');
    expect(box.textContent).toContain('高');
    expect(box.textContent).toContain('紧急');
    expect(box.textContent).not.toContain('A,');
  });

  it('collapse=true 且 >3 项时前3 + 「等 N 项」', () => {
    render(<ReadOnlyMulti value={['A', 'B', 'C', 'D']} options={options} collapse />);
    const box = screen.getByTestId('read-only-multi');
    expect(box.textContent).toContain('高');
    expect(box.textContent).toContain('加急');
    expect(box.textContent).not.toContain('超时');
    expect(box.textContent).toContain('等 1 项');
  });

  it('collapse=true 但 <=3 项不折叠', () => {
    render(<ReadOnlyMulti value={['A', 'B', 'C']} options={options} collapse />);
    expect(screen.getByTestId('read-only-multi').textContent).not.toContain('等');
  });

  it('collapse 缺省（false）时全部展开', () => {
    render(<ReadOnlyMulti value={['A', 'B', 'C', 'D']} options={options} />);
    expect(screen.getByTestId('read-only-multi').textContent).toContain('超时');
  });

  it('⚠️ 未登记选项标黄但仍显示原值', () => {
    const { container } = render(<ReadOnlyMulti value={['A', 'ZZZ']} options={options} />);
    expect(container.textContent).toContain('ZZZ');
  });

  it('⚠️ 逗号分隔串也接受（历史数据容错）', () => {
    render(<ReadOnlyMulti value="A,B" options={options} />);
    const box = screen.getByTestId('read-only-multi');
    expect(box.textContent).toContain('高');
    expect(box.textContent).toContain('紧急');
  });

  it('单个标量当单元素数组', () => {
    render(<ReadOnlyMulti value="A" options={options} />);
    expect(screen.getByTestId('read-only-multi').textContent).toBe('高');
  });

  it('空数组显示 -', () => {
    const { container } = render(<ReadOnlyMulti value={[]} options={options} />);
    expect(container.textContent).toBe(EMPTY_PLACEHOLDER);
  });

  it('toStringList 丢弃空项', () => {
    expect(toStringList(['A', '', null, 'B'])).toEqual(['A', 'B']);
    expect(toStringList(' A , , B ')).toEqual(['A', 'B']);
    expect(toStringList(null)).toEqual([]);
    expect(toStringList(5)).toEqual(['5']);
  });
});

describe('ReadOnlyBool · 是/否', () => {
  it('true → 绿徽「是」', () => {
    render(<ReadOnlyBool value={true} />);
    const el = screen.getByTestId('read-only-bool');
    expect(el.textContent).toBe('是');
    expect(el.querySelector('span')?.className).toContain('text-success');
  });

  it('false → 灰徽「否」', () => {
    render(<ReadOnlyBool value={false} />);
    const el = screen.getByTestId('read-only-bool');
    expect(el.textContent).toBe('否');
    expect(el.querySelector('span')?.className).toContain('text-muted-foreground');
  });

  it('⚠️ false 不是空值（不能渲染成 -）', () => {
    render(<ReadOnlyBool value={false} />);
    expect(screen.getByTestId('read-only-bool').textContent).not.toBe(EMPTY_PLACEHOLDER);
  });

  it('null 显示 -', () => {
    const { container } = render(<ReadOnlyBool value={null} />);
    expect(container.textContent).toBe(EMPTY_PLACEHOLDER);
  });

  it('⚠️ 字符串 "false" 解析成否而不是真（Boolean("false") 是 true）', () => {
    expect(parseBoolValue('false')).toBe(false);
    expect(parseBoolValue('TRUE')).toBe(true);
    expect(parseBoolValue('0')).toBe(false);
    expect(parseBoolValue('1')).toBe(true);
  });

  it('无法判定的值原样输出而不是猜', () => {
    const { container } = render(<ReadOnlyBool value="maybe" />);
    expect(container.textContent).toBe('maybe');
  });

  it('parseBoolValue 对无法判定返回 null', () => {
    expect(parseBoolValue('maybe')).toBeNull();
    expect(parseBoolValue(2)).toBeNull();
    expect(parseBoolValue([])).toBeNull();
  });
});

describe('ReadOnlyField · 按 type 分发', () => {
  it('缺省 type 走 text', () => {
    const { container } = render(<ReadOnlyField field={{ key: 'a', label: 'A' }} value="hello" />);
    expect(screen.getByTestId('read-only-text').textContent).toBe('hello');
    expect(container.textContent).toBe('hello');
  });

  it('type=number 带 unit', () => {
    render(<ReadOnlyField field={{ key: 'a', label: 'A', type: 'number', unit: '元' }} value={1000} />);
    expect(screen.getByTestId('read-only-number').textContent).toBe('1,000 元');
  });

  it('type=multi 透传 collapseInReadonly', () => {
    render(
      <ReadOnlyField
        field={{ key: 'a', label: 'A', type: 'multi', options: [{ value: 'x', label: 'X' }], collapseInReadonly: true }}
        value={['x', 'x', 'x', 'x']}
      />,
    );
    expect(screen.getByTestId('read-only-multi').textContent).toContain('等 1 项');
  });
});

describe('ReadOnlyForm · 组合与降级 ④', () => {
  const fields = [
    { key: 'orderNo', label: '订单号' },
    { key: 'amount', label: '申请金额', type: 'number' as const, unit: '元' },
    { key: 'applyDate', label: '申请日期', type: 'date' as const },
    { key: 'priority', label: '优先级', type: 'select' as const, options: [{ value: 'HIGH', label: '高' }] },
    { key: 'urgent', label: '是否加急', type: 'bool' as const },
  ];

  it('按 schema 顺序渲染全部字段', () => {
    const { container } = render(
      <ReadOnlyForm
        fields={fields}
        value={{ orderNo: 'PO-001', amount: 128000, applyDate: '2026-10-09', priority: 'HIGH', urgent: true }}
      />,
    );
    const text = container.textContent ?? '';
    expect(text).toContain('订单号');
    expect(text).toContain('申请金额');
    expect(text).toContain('申请日期');
    expect(text).toContain('优先级');
    expect(text).toContain('是否加急');
    expect(text).toContain('128,000 元');
    expect(text).toContain('2026年10月9日');
    expect(text).toContain('高');
  });

  it('value 缺字段时该行显示 -，不整行消失', () => {
    const { container } = render(<ReadOnlyForm fields={fields} value={{ orderNo: 'PO-001' }} />);
    expect(container.textContent).toContain('申请金额');
    expect(container.textContent).toContain(EMPTY_PLACEHOLDER);
  });

  it('⚠️ schema 未声明的键以 details 追加列出（降级 ④）', () => {
    const { container } = render(<ReadOnlyForm fields={fields} value={{ orderNo: 'PO-001', mystery: 'v' }} />);
    const details = container.querySelector('details');
    expect(details).not.toBeNull();
    expect(details?.textContent).toContain('未在 schema 中声明的字段');
    expect(details?.textContent).toContain('mystery');
    expect(details?.textContent).toContain('v');
  });

  it('fields 与 value 都空时显示空态', () => {
    render(<ReadOnlyForm fields={[]} value={{}} emptyText="暂无表单数据" />);
    expect(screen.getByText('暂无表单数据')).toBeTruthy();
  });

  it('fields 为空但 value 有值时仍列出未声明字段', () => {
    const { container } = render(<ReadOnlyForm fields={[]} value={{ a: 1 }} />);
    expect(container.querySelector('details')?.textContent).toContain('a');
  });
});

describe('只读态不实例化业务组件 · 机制', () => {
  /**
   * `ReadOnlyForm` 的 props 里**根本没有 component 字段**（只有 fields + value），
   * 所以只读渲染路径在类型层面就无法渲染业务组件。
   * 完整的行为级证明（挂载带副作用的组件、断言 effect 未执行）在
   * `form-shell.test.tsx` —— 那里才有「本该渲染组件却没渲染」的分支。
   *
   * 这里守的是另一条：确认副作用探针本身是有效的（避免别处的断言是假阳性）。
   */
  it('副作用探针有效：组件真的被渲染时 useEffect 会执行', () => {
    const effectSpy = vi.fn();
    function SpyForm() {
      useEffect(() => {
        effectSpy();
      }, []);
      return null;
    }
    render(<SpyForm />);
    expect(effectSpy).toHaveBeenCalledTimes(1);
  });
});
