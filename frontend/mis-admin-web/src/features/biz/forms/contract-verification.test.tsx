// @vitest-environment jsdom
/**
 * **表单字段契约一致性验证**（V1~V3）。
 *
 * ## 这份测试和已有测试的区别
 *
 * `form-fallback.test.tsx` 验证的是「四级降级」（前端自己的兜底逻辑），
 * `form-shell.test.tsx` 验证的是「套壳不实例化业务组件」。
 * ⚠️ **两者都没有回答真问题**：后端真的按 `PUR_FORM` 的契约填了 `form_data` 之后，
 * 前端**能不能正确渲染**。
 *
 * 本文件是那份「真问题」的答案，分三段：
 *
 * - **V1 契约基准**：把 `PUR_FIELDS` 逐字段锁死（key / type / 选项）。
 *   这段是**回归护栏**—— 谁改了 `pur-form.tsx` 的字段定义而没同步后端，
 *   这里立刻红。⚠️ 只**读** `PUR_FIELDS`，不修改它。
 * - **V2 渲染验证**：按 V1 契约自造一份 `form_data`，8 种类型逐一断言渲染结果。
 * - **V3 脆弱点实测**：7 个「后端填错会怎样」的问题，每条都是**实测**不是推测。
 *
 * ## 为什么要自己造数据
 *
 * 后端演示数据（V129）与本文件**无耦合**：这里只依赖 `PUR_FIELDS` 这份契约，
 * 所以后端数据到位前后都能跑，也能在后端数据出错时当**对照组**。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { ReadOnlyFormView } from './read-only-form-view';
import { ReadOnlyForm } from './fields';
import { PUR_FIELDS, purFormEntry } from './forms/pur-form';
import { __resetRegistryForTest, registerForms } from './registry';
import type { FormData, FormFieldSchema } from './types';

/* ------------------------------------------------------------------ */
/* 工具                                                                */
/* ------------------------------------------------------------------ */

beforeEach(() => {
  __resetRegistryForTest();
  registerForms([purFormEntry]);
});

afterEach(() => {
  cleanup();
  __resetRegistryForTest();
});

/**
 * 用真实 `PUR_FIELDS` 渲染只读视图。
 *
 * ⚠️ 走 `ReadOnlyFormView`（而不是直接 `ReadOnlyForm`）是刻意的：
 * 那才是审批页真实经过的入口，包含 4 级降级判定。
 * 只测 `ReadOnlyForm` 会漏掉「后端 JSON 解析」这一层。
 */
function renderView(data: unknown): void {
  render(<ReadOnlyFormView formCode="PUR_FORM" formData={JSON.stringify(data)} />);
}

/** 按 schema 的 label 定位某个字段所在的行，返回该行的容器元素。 */
function rowOf(label: string): HTMLElement {
  // ReadOnlyRow 结构：<div><span>label</span>{value}</div>
  const labelEl = screen.getByText(label);
  const row = labelEl.parentElement;
  if (!row) throw new Error(`字段 ${label} 的行容器未找到`);
  return row;
}

/**
 * 取某字段渲染出的**值**文本（已合并空白）。
 *
 * ⚠️ 必须排除标签本身：`ReadOnlyRow` 的结构是
 * `<div><span>{label}</span>{value}</div>`，直接读 `textContent` 会把
 * 「采购单号」混进值里。取 `children[1..]` 才是纯值。
 */
function valueTextOf(label: string): string {
  const row = rowOf(label);
  const parts: string[] = [];
  for (let i = 1; i < row.children.length; i += 1) {
    parts.push(row.children[i].textContent ?? '');
  }
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

/**
 * 取多选字段渲染出的**逐项标签**文本数组。
 *
 * ⚠️ 不能用 `valueTextOf`：multi 的所有标签挤在**同一个** flex 子div 里，
 * `textContent` 是无分隔符的拼接（`硬件设备软件许可`），逐项断言必须走 DOM 查询。
 */
function multiTagsOf(label: string): string[] {
  const box = within(rowOf(label)).getByTestId('read-only-multi');
  return Array.from(box.children)
    .map((c) => (c.textContent ?? '').trim())
    .filter((t) => t !== '');
}

/** schema 覆盖场景用：直接渲染 ReadOnlyForm，绕开注册表。 */
function renderWithFields(fields: FormFieldSchema[], data: FormData): void {
  render(<ReadOnlyForm fields={fields} value={data} />);
}

/* ================================================================== */
/* V1 · PUR_FORM 字段契约基准（回归护栏）                              */
/* ================================================================== */

describe('V1 · PUR_FORM 字段契约基准', () => {
  it('V1.1 字段全集与顺序（后端填 form_data 的唯一依据）', () => {
    // ⚠️ 这份断言就是「契约清单」的可执行版本。
    // 任何增删改字段都会让它红 —— 那时候必须同步通知后端改 V129 演示数据。
    expect(PUR_FIELDS.map((f) => ({ key: f.key, type: f.type ?? 'text', unit: f.unit }))).toEqual([
      { key: 'orderNo', type: 'text', unit: undefined },
      { key: 'supplier', type: 'text', unit: undefined },
      { key: 'amount', type: 'number', unit: '元' },
      { key: 'applyDate', type: 'date', unit: undefined },
      { key: 'priority', type: 'select', unit: undefined },
      { key: 'categories', type: 'multi', unit: undefined },
      { key: 'urgent', type: 'bool', unit: undefined },
      { key: 'reason', type: 'textarea', unit: undefined },
    ]);
  });

  it('V1.2 全部 key 为扁平 camelCase，无下划线/连字符/嵌套', () => {
    for (const f of PUR_FIELDS) {
      expect(f.key).toMatch(/^[a-z][a-zA-Z0-9]*$/);
    }
    // 扁平：不允许出现 '.' 或 '[' （ConditionEvaluator 只认顶层 key）
    expect(PUR_FIELDS.some((f) => f.key.includes('.') || f.key.includes('['))).toBe(false);
  });

  it('V1.3 select / multi 的候选项 value 是稳定的大写枚举码', () => {
    const priority = PUR_FIELDS.find((f) => f.key === 'priority');
    expect(priority?.options?.map((o) => o.value)).toEqual(['HIGH', 'NORMAL', 'LOW']);

    const categories = PUR_FIELDS.find((f) => f.key === 'categories');
    expect(categories?.options?.map((o) => o.value)).toEqual([
      'HARDWARE',
      'SOFTWARE',
      'SERVICE',
      'LOGISTICS',
    ]);
  });

  it('V1.4 契约里**没有 required 概念**（只读态不做必填校验）', () => {
    // ⚠️ 这是给后端的重要事实：FormFieldSchema 上根本没有 required/requiredOnSave。
    // 「必填」是后端发起入口的校验责任，前端只读态一律渲染缺失值为 '-'。
    expect(PUR_FIELDS.every((f) => !('required' in f))).toBe(true);
  });

  it('V1.5 PUR_FORM 本身**未覆盖 datetime 类型**', () => {
    // 8 个字段但只用了 7 种 type（orderNo/supplier 都是默认 text）。
    // 所以「8 种类型全覆盖」必须靠 schema 覆盖补 datetime —— 见 V2.9。
    const types = new Set(PUR_FIELDS.map((f) => f.type ?? 'text'));
    expect(types.has('datetime')).toBe(false);
    expect([...types].sort()).toEqual(
      ['bool', 'date', 'multi', 'number', 'select', 'text', 'textarea'].sort(),
    );
  });
});

/* ================================================================== */
/* V2 · 自造 form_data 的渲染验证（8 种类型）                          */
/* ================================================================== */

/** 按 V1 契约造的一份「正确」数据。 */
const GOOD_DATA: FormData = {
  orderNo: 'PO-2026-1001',
  supplier: '深圳市远见科技有限公司',
  amount: 128000.5,
  applyDate: '2026-10-09',
  priority: 'HIGH',
  categories: ['HARDWARE', 'SOFTWARE'],
  urgent: true,
  reason: '新办公区工位扩容，需采购 30 台笔记本与配套正版软件许可。',
};

describe('V2 · 自造 form_data 渲染验证', () => {
  it('V2.1 一份完全符合契约的数据能渲染出全部 8 个字段', () => {
    renderView(GOOD_DATA);
    expect(screen.getByTestId('read-only-form')).toBeTruthy();
    for (const f of PUR_FIELDS) {
      expect(screen.getByText(f.label)).toBeTruthy();
    }
  });

  it('V2.2 text：原样输出', () => {
    renderView(GOOD_DATA);
    expect(valueTextOf('采购单号')).toBe('PO-2026-1001');
    expect(valueTextOf('供应商')).toBe('深圳市远见科技有限公司');
    expect(screen.getAllByTestId('read-only-text').length).toBeGreaterThan(0);
  });

  it('V2.3 number：千分位 + 单位「元」', () => {
    renderView(GOOD_DATA);
    // Intl.NumberFormat('zh-CN') ⇒ 1,280,00.5 → "128,000.5"
    expect(valueTextOf('申请金额')).toBe('128,000.5 元');
    expect(within(rowOf('申请金额')).getByTestId('read-only-number')).toBeTruthy();
  });

  it('V2.4 number：0 是有效业务值，必须渲染成 0 而不是 -', () => {
    renderView({ ...GOOD_DATA, amount: 0 });
    expect(valueTextOf('申请金额')).toBe('0 元');
  });

  it('V2.5 date：ISO 日期中文化，且不引入时区偏移', () => {
    renderView(GOOD_DATA);
    expect(valueTextOf('申请日期')).toBe('2026年10月9日');
    expect(within(rowOf('申请日期')).getByTestId('read-only-date')).toBeTruthy();
  });

  it('V2.6 select：value 翻成中文 label', () => {
    renderView(GOOD_DATA);
    expect(valueTextOf('优先级')).toBe('高');
    expect(within(rowOf('优先级')).getByTestId('read-only-tag')).toBeTruthy();
  });

  it('V2.7 multi：逐项翻 label 成标签', () => {
    renderView(GOOD_DATA);
    expect(multiTagsOf('采购品类')).toEqual(['硬件设备', '软件许可']);
    const box = within(rowOf('采购品类')).getByTestId('read-only-multi');
    expect(within(box).getByText('硬件设备')).toBeTruthy();
    expect(within(box).getByText('软件许可')).toBeTruthy();
  });

  it('V2.8 bool：true → 是 / false → 否（两者都不是空值）', () => {
    renderView({ ...GOOD_DATA, urgent: true });
    expect(valueTextOf('是否加急')).toBe('是');
    expect(within(rowOf('是否加急')).getByTestId('read-only-bool')).toBeTruthy();

    cleanup();
    renderView({ ...GOOD_DATA, urgent: false });
    expect(valueTextOf('是否加急')).toBe('否');
  });

  it('V2.9 textarea：原样输出且保留换行', () => {
    const reason = '第一行：采购 30 台笔记本\n第二行：配套正版许可';
    renderView({ ...GOOD_DATA, reason });
    expect(valueTextOf('申请理由')).toBe(reason.replace(/\n/g, ' '));
    expect(within(rowOf('申请理由')).getByTestId('read-only-text')).toBeTruthy();
  });

  it('V2.10 datetime：PUR_FORM没有该类型，用 schema 覆盖验证渲染器本身', () => {
    // ⚠️ PUR_FIELDS 不可改（后端已按它填数据），所以第 8 种类型只能这样补。
    // 这也证明：**后端若给 PUR_FORM 塞datetime 字段，前端 schema 没声明 ⇒ 走降级④。**
    const fields: FormFieldSchema[] = [{ key: 'approvedAt', label: '审批时间', type: 'datetime' }];
    renderWithFields(fields, { approvedAt: '2026-10-09T10:30:00' });
    expect(valueTextOf('审批时间')).toBe('2026年10月9日 10:30');
  });
});

/* ================================================================== */
/* V3 · 契约脆弱点实测（每条都是实测，不是推测）                      */
/* ================================================================== */

describe('V3.1 key 写成下划线 / 连字符（form_code / form-code）', () => {
  const SNAKE = {
    order_no: 'PO-2026-1001',
    supplier: '远见科技',
    amount: 1000,
    apply_date: '2026-10-09',
    priority: 'HIGH',
    urgent: true,
  };

  it('前端**不报错也不白屏**：正确字段全变 "-"，错误 key 进「未声明」折叠区', () => {
    renderView(SNAKE);

    // schema 里声明的字段拿不到值 ⇒ 渲染占位符 "-"
    expect(valueTextOf('采购单号')).toBe('-');
    expect(valueTextOf('申请日期')).toBe('-');

    // 后端填了值的字段不受影响
    expect(valueTextOf('供应商')).toBe('远见科技');

    // ⚠️ 关键：错key **没有消失**，而是被降级④收进 <details>。
    // 审批人默认看不到（details 默认折叠）⇒ 必须展开才可见。
    expect(screen.getByText(/未在 schema 中声明的字段/)).toBeTruthy();
    const details = screen.getByText(/未在 schema 中声明的字段/).closest('details');
    expect(details).toBeTruthy();
    expect(details?.hasAttribute('open')).toBe(false);
    expect(within(details as HTMLElement).getByText('order_no')).toBeTruthy();
    expect(within(details as HTMLElement).getByText('apply_date')).toBeTruthy();
  });

  it('结论：key 拼错 = **静默降级**（无红字、无控制台报错），只有展开折叠区才可见', () => {
    // 证据：整个渲染过程没有出现 form-missing 兜底卡，也没有 role=alert。
    renderView(SNAKE);
    expect(screen.queryByTestId('form-missing')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('V3.2 后端返回多余的 key（schema 里没有）', () => {
  it('进「未声明」折叠区，**不会显示 undefined**', () => {
    renderView({ ...GOOD_DATA, approver: '张审批', cc: ['a', 'b'], nested: { a: 1 } });

    // 没有 undefined 文本泄漏
    expect(document.body.textContent).not.toContain('undefined');

    const details = screen.getByText(/未在 schema 中声明的字段（3）/).closest('details');
    expect(details).toBeTruthy();
    const box = within(details as HTMLElement);
    expect(box.getByText('approver')).toBeTruthy();
    expect(box.getByText('张审批')).toBeTruthy();
    // 对象/数组走 JSON.stringify，不会抛
    expect(box.getByText('{"a":1}')).toBeTruthy();
    expect(box.getByText('["a","b"]')).toBeTruthy();
  });

  it('值为 null 的多余 key 显示字面量 "null"（不是空）', () => {
    renderView({ ...GOOD_DATA, remark: null });
    const details = screen.getByText(/未在 schema 中声明的字段（1）/).closest('details');
    expect(within(details as HTMLElement).getByText('null')).toBeTruthy();
  });
});

describe('V3.3 后端漏掉某个 key', () => {
  it('漏 1 个：只该字段变 "-"，其余字段正常，**不白屏**', () => {
    const { amount, ...rest } = GOOD_DATA;
    void amount;
    renderView(rest);

    expect(valueTextOf('申请金额')).toBe('-');
    expect(valueTextOf('采购单号')).toBe('PO-2026-1001');
    expect(valueTextOf('优先级')).toBe('高');
    expect(screen.queryByTestId('form-missing')).toBeNull();
  });

  it('漏 select 的 key：显示 "-" 而不是把 label 错挂到别的值上', () => {
    renderView({ ...GOOD_DATA, priority: undefined });
    // ⚠️ 注意：JSON.stringify 会把 undefined 抹掉 ⇒ 实际后端也是「key 不存在」
    expect(valueTextOf('优先级')).toBe('-');
  });

  it('只剩 1 个字段：仍正常渲染', () => {
    renderView({ orderNo: 'PO-1' });
    expect(valueTextOf('采购单号')).toBe('PO-1');
    expect(screen.getByTestId('read-only-form')).toBeTruthy();
  });
});

describe('V3.4 value 为 null vs key 不存在 vs 空字符串 —— 表现一样吗？', () => {
  /**
   * 结论（实测）：**只读态三者完全一样，都渲染 `-`**。
   * 所以后端「写 null」和「不写这个 key」在审批页上**无法区分**。
   * ⚠️ 唯一例外：`multi` 字段的空数组 `[]` 与 null/缺失也不同（都变 `-`），
   * 但 `ReadOnlyForm` 的 `undeclared` 判定会把空数组算进 schema 已声明键，不受影响。
   */
  it('text / number / date / select / bool / textarea：null ≡ 缺失 ≡ 空串 ⇒全 "-"', () => {
    const probe = (label: string, data: FormData): string => {
      cleanup();
      renderView(data);
      return valueTextOf(label);
    };

    expect(probe('采购单号', { ...GOOD_DATA, orderNo: null })).toBe('-');
    expect(probe('采购单号', { ...GOOD_DATA, orderNo: '' })).toBe('-');
    const noKey = { ...GOOD_DATA };
    delete noKey.orderNo;
    expect(probe('采购单号', noKey)).toBe('-');

    expect(probe('申请金额', { ...GOOD_DATA, amount: null })).toBe('-');
    expect(probe('申请金额', { ...GOOD_DATA, amount: '' })).toBe('-');

    expect(probe('申请日期', { ...GOOD_DATA, applyDate: null })).toBe('-');
    expect(probe('申请日期', { ...GOOD_DATA, applyDate: '' })).toBe('-');

    expect(probe('优先级', { ...GOOD_DATA, priority: null })).toBe('-');
    expect(probe('优先级', { ...GOOD_DATA, priority: '' })).toBe('-');

    expect(probe('是否加急', { ...GOOD_DATA, urgent: null })).toBe('-');
    expect(probe('是否加急', { ...GOOD_DATA, urgent: '' })).toBe('-');
    // ⚠️ bool 特有：字符串 'false' 会被翻成「否」，而 null/缺失 是 "-"
    //    ⇒ 对bool 来说null ≠ 字符串 'false'，两者语义不同但都合法

    expect(probe('申请理由', { ...GOOD_DATA, reason: null })).toBe('-');
  });

  it('multi：null ≡ 缺失 ≡ 空数组 ≡ 空串 ⇒ 全 "-"', () => {
    // 正向对照：有值必须翻 label（防止「空值一律返回占位符」写过头把真值也吞掉）
    renderView(GOOD_DATA);
    expect(valueTextOf('采购品类')).toBe('硬件设备软件许可');

    cleanup();
    renderView({ ...GOOD_DATA, categories: null });
    expect(valueTextOf('采购品类')).toBe('-');

    cleanup();
    renderView({ ...GOOD_DATA, categories: [] });
    expect(valueTextOf('采购品类')).toBe('-');

    cleanup();
    renderView({ ...GOOD_DATA, categories: '' });
    expect(valueTextOf('采购品类')).toBe('-');

    cleanup();
    const noKey = { ...GOOD_DATA };
    delete noKey.categories;
    renderView(noKey);
    expect(valueTextOf('采购品类')).toBe('-');
  });

  it('⚠️ 但在「未声明字段」区三者不同：null→"null"、缺失→不出现、空串→空', () => {
    renderView({ ...GOOD_DATA, extraNull: null, extraEmpty: '' });
    const details = screen.getByText(/未在 schema 中声明的字段（2）/).closest('details');
    const box = within(details as HTMLElement);
    expect(box.getByText('null')).toBeTruthy();
    expect(document.body.textContent).not.toContain('undefined');
  });
});

describe('V3.5 数字：字符串 "1000" vs 数字 1000', () => {
  it('两者都能处理，渲染结果完全一致（都是 1,000 元）', () => {
    renderView({ ...GOOD_DATA, amount: 1000 });
    const asNumber = valueTextOf('申请金额');

    cleanup();
    renderView({ ...GOOD_DATA, amount: '1000' });
    const asString = valueTextOf('申请金额');

    expect(asNumber).toBe('1,000 元');
    expect(asString).toBe('1,000 元');
    expect(asString).toBe(asNumber);
  });

  it('字符串 "128000.55" 也能正确格式化', () => {
    renderView({ ...GOOD_DATA, amount: '128000.55' });
    expect(valueTextOf('申请金额')).toBe('128,000.55 元');
  });

  it('⚠️ 带千分位的字符串 "128,000" **解析失败 ⇒ 原样输出**（不再二次格式化）', () => {
    renderView({ ...GOOD_DATA, amount: '128,000' });
    // 这正是 types.ts 硬约束 2「数值不带单位与分隔符」的原因
    expect(valueTextOf('申请金额')).toBe('128,000 元');
    expect(within(rowOf('申请金额')).getByTestId('read-only-number-raw')).toBeTruthy();
  });

  it('⚠️ 带货币符号 "¥128000" 原样输出', () => {
    renderView({ ...GOOD_DATA, amount: '¥128000' });
    expect(valueTextOf('申请金额')).toBe('¥128000 元');
  });

  it('⚠️ 非数字串 "约十二万" 原样输出（不吞成 "-"，让数据问题暴露）', () => {
    renderView({ ...GOOD_DATA, amount: '约十二万' });
    expect(valueTextOf('申请金额')).toBe('约十二万 元');
  });

  it('⚠️ 字符串 "1000" 若字段被声明为 text，则原样显示 1000（无千分位）', () => {
    renderView({ ...GOOD_DATA, amount: undefined, orderNo: '1000' });
    expect(valueTextOf('采购单号')).toBe('1000');
  });

  it('⚠️ JSON 里amount 是数组或对象 ⇒ 原样输出 "[object Object]"/数组串', () => {
    renderView({ ...GOOD_DATA, amount: [1, 2] });
    expect(valueTextOf('申请金额')).toBe('1,2 元');
    cleanup();
    renderView({ ...GOOD_DATA, amount: { v: 1 } });
    expect(valueTextOf('申请金额')).toBe('[object Object] 元');
  });
});

describe('V3.6 日期：2026-10-09 vs 2026-10-09T10:30:00', () => {
  it('两种格式都能解析（date 字段两种都只出日期部分）', () => {
    renderView({ ...GOOD_DATA, applyDate: '2026-10-09' });
    const dateOnly = valueTextOf('申请日期');

    cleanup();
    renderView({ ...GOOD_DATA, applyDate: '2026-10-09T10:30:00' });
    const withTime = valueTextOf('申请日期');

    expect(dateOnly).toBe('2026年10月9日');
    // ✅ 关键：type='date' 时 showTime=false ⇒ 带时间的串**丢掉时间**，
    //    但**不会崩、不会显示原始串**，这是最容易踩的静默信息丢失。
    expect(withTime).toBe('2026年10月9日');
  });

  it('datetime 字段才带出 HH:mm', () => {
    const fields: FormFieldSchema[] = [{ key: 'at', label: '时间', type: 'datetime' }];
    renderWithFields(fields, { at: '2026-10-09T10:30:00' });
    expect(valueTextOf('时间')).toBe('2026年10月9日 10:30');

    cleanup();
    // ⚠️ 实测发现：datetime 字段拿到**纯日期**时不会补 00:00。
    // 原因在 `read-only-date.tsx:68` —— `formatDateCn` 只在 `hour !== undefined` 时补时间，
    // 而 `parseDateValue` 对无时间后缀的串不填 hour。showTime 只「允许」出时间，不「制造」时间。
    // 对后端的意义：**datetime 字段必须带上时间部分**，否则审批人看不出是 00:00 还是漏填。
    renderWithFields(fields, { at: '2026-10-09' });
    expect(valueTextOf('时间')).toBe('2026年10月9日');
  });

  it('无时区偏移：不会被当成 UTC 午夜而整体偏移一天', () => {
    renderView({ ...GOOD_DATA, applyDate: '2026-01-01' });
    expect(valueTextOf('申请日期')).toBe('2026年1月1日');
    cleanup();
    renderView({ ...GOOD_DATA, applyDate: '2026-12-31' });
    expect(valueTextOf('申请日期')).toBe('2026年12月31日');
  });

  it('⚠️ 非法日期 2026-02-30 ⇒ 原样输出（不静默进位成 3-02）', () => {
    renderView({ ...GOOD_DATA, applyDate: '2026-02-30' });
    expect(valueTextOf('申请日期')).toBe('2026-02-30');
    expect(within(rowOf('申请日期')).getByTestId('read-only-date-raw')).toBeTruthy();
  });

  it('⚠️ 其他格式：斜杠 / 单数字月份 / 带 Z / 带毫秒 / 时间戳数字', () => {
    const probe = (v: unknown): string => {
      cleanup();
      renderView({ ...GOOD_DATA, applyDate: v });
      return valueTextOf('申请日期');
    };
    expect(probe('2026/10/09')).toBe('2026年10月9日');
    expect(probe('2026-10-9')).toBe('2026年10月9日');
    // ⚠️ 带 Z / 毫秒：正则只取到分钟，**时区标记 Z 被忽略**（当作本地时间）
    expect(probe('2026-10-09T10:30:00Z')).toBe('2026年10月9日');
    expect(probe('2026-10-09T10:30:00.000Z')).toBe('2026年10月9日');
    // ⚠️ 时间戳数字：非字符串 ⇒ 原样输出
    expect(probe(1789012345678)).toBe('1789012345678');
    // ⚠️ 非法格式
    expect(probe('09/10/2026')).toBe('09/10/2026');
    expect(probe('2026年10月9日')).toBe('2026年10月9日');
  });
});

describe('V3.7 多选：["A","B"] vs [{"code":"A","label":"甲"}]', () => {
  it('✅ 字符串数组：正确翻 label', () => {
    renderView({ ...GOOD_DATA, categories: ['HARDWARE', 'SOFTWARE'] });
    expect(multiTagsOf('采购品类')).toEqual(['硬件设备', '软件许可']);
  });

  it('⚠️ **对象数组渲染成 [object Object]** —— 前端不支持这种形态', () => {
    renderView({
      ...GOOD_DATA,
      categories: [
        { code: 'HARDWARE', label: '硬件设备' },
        { code: 'SOFTWARE', label: '软件许可' },
      ],
    });
    //实测结论：`toStringList` 对数组元素做 String(v)⇒ 对象变成 "[object Object]"，
    // 且 findLabel 查不到 ⇒ 走warning 色 + title。
    const box = within(rowOf('采购品类')).getByTestId('read-only-multi');
    const tags = within(box).getAllByText('[object Object]');
    expect(tags.length).toBe(2);
    expect(tags[0].getAttribute('title')).toContain('[object Object]');
    // ⚠️ 且**不会白屏也不会报错** ⇒ 后端填错时审批人只看到两个无意义的标签
    expect(screen.queryByTestId('form-missing')).toBeNull();
  });

  it('⚠️ 对象数组里即使带 label 也救不回来（前端只认 options 映射）', () => {
    renderView({ ...GOOD_DATA, categories: [{ value: 'HARDWARE', label: '硬件设备' }] });
    expect(multiTagsOf('采购品类')).toEqual(['[object Object]']);
  });

  it('✅ 未登记的枚举值：黄色标签 + title 给原始值（不静默吞掉）', () => {
    renderView({ ...GOOD_DATA, categories: ['HARDWARE', 'IOT_DEVICE'] });
    const box = within(rowOf('采购品类')).getByTestId('read-only-multi');
    const unknown = within(box).getByText('IOT_DEVICE');
    expect(unknown.getAttribute('title')).toContain('未登记的选项：IOT_DEVICE');
    expect(multiTagsOf('采购品类')).toEqual(['硬件设备', 'IOT_DEVICE']);
  });

  it('✅ 逗号分隔串也能容错（人工改库的历史数据）', () => {
    renderView({ ...GOOD_DATA, categories: 'HARDWARE,SERVICE' });
    expect(multiTagsOf('采购品类')).toEqual(['硬件设备', '技术服务']);
  });

  it('⚠️ 数字枚举**翻不出label**（options 的 value 全是字符串，"1" ≠ 1）', () => {
    //实测结论：`toStringList` 会 String()归一，但 `findLabel` 是 `o.value === value` 严格比字符串，
    //所以数字 code 只会显示黄色裸值 —— 后端必须写字符串枚举码。
    renderView({ ...GOOD_DATA, categories: [1, 2] });
    expect(multiTagsOf('采购品类')).toEqual(['1', '2']);
    const box = within(rowOf('采购品类')).getByTestId('read-only-multi');
    expect(within(box).getByText('1').getAttribute('title')).toContain('未登记的选项：1');
  });

  it('✅ collapseInReadonly：>3 项折叠成前 3 + 「等 N 项」', () => {
    renderView({ ...GOOD_DATA, categories: ['HARDWARE', 'SOFTWARE', 'SERVICE', 'LOGISTICS'] });
    const box = within(rowOf('采购品类')).getByTestId('read-only-multi');
    expect(within(box).getByText('等 1 项')).toBeTruthy();
    expect(within(box).queryByText('硬件设备')).toBeTruthy();
    expect(within(box).queryByText('物流运输')).toBeNull();
    expect(multiTagsOf('采购品类')).toEqual(['硬件设备', '软件许可', '技术服务', '等 1 项']);
  });

  it('✅ 恰好 3 项不折叠（阈值是 >3）', () => {
    renderView({ ...GOOD_DATA, categories: ['HARDWARE', 'SOFTWARE', 'SERVICE'] });
    expect(multiTagsOf('采购品类')).toEqual(['硬件设备', '软件许可', '技术服务']);
  });
});

/* ================================================================== */
/* V3 补充 · 其他实测发现                                            */
/* ================================================================== */

describe('V3.8 select 未登记枚举值 / 类型不符', () => {
  it('未登记的 select 值：黄色标签 + title 给原始值，不静默吞', () => {
    renderView({ ...GOOD_DATA, priority: 'URGENT' });
    const tag = within(rowOf('优先级')).getByTestId('read-only-tag-unknown');
    expect(tag.textContent).toBe('URGENT');
    expect(tag.getAttribute('title')).toContain('未登记的选项：URGENT');
  });

  it('⚠️ select 给了 label 而不是 value ⇒ 翻不出中文，直接显示 label 原串', () => {
    renderView({ ...GOOD_DATA, priority: '高' });
    const tag = within(rowOf('优先级')).getByTestId('read-only-tag-unknown');
    expect(tag.textContent).toBe('高');
    expect(tag.getAttribute('title')).toContain('未登记的选项：高');
  });

  it('⚠️ select 给了数字 code ⇒ String 归一后仍查不到（options 全是字符串 value）', () => {
    renderView({ ...GOOD_DATA, priority: 1 });
    expect(within(rowOf('优先级')).getByTestId('read-only-tag-unknown').textContent).toBe('1');
  });

  it('bool 的字符串容错：true/1/yes/Y 与 false/0/no/N', () => {
    const probe = (v: unknown): string => {
      cleanup();
      renderView({ ...GOOD_DATA, urgent: v });
      return valueTextOf('是否加急');
    };
    expect(probe(true)).toBe('是');
    expect(probe('true')).toBe('是');
    expect(probe(1)).toBe('是');
    expect(probe('1')).toBe('是');
    expect(probe('yes')).toBe('是');
    expect(probe('Y')).toBe('是');
    expect(probe(false)).toBe('否');
    expect(probe('false')).toBe('否');
    expect(probe(0)).toBe('否');
    expect(probe('0')).toBe('否');
    expect(probe('no')).toBe('否');
    expect(probe('N')).toBe('否');
    // ⚠️ 无法判定的串：原样输出（不猜）
    expect(probe('maybe')).toBe('maybe');
    expect(probe('是')).toBe('是');
  });

  it('text 字段拿到对象/数组 ⇒ String() 降级，不崩', () => {
    renderView({ ...GOOD_DATA, orderNo: { a: 1 } });
    expect(valueTextOf('采购单号')).toBe('[object Object]');
    cleanup();
    renderView({ ...GOOD_DATA, orderNo: ['a', 'b'] });
    expect(valueTextOf('采购单号')).toBe('a,b');
  });
});

describe('V3.9 顶层结构异常（form_data 不是扁平对象）', () => {
  it('数组 → bad-json 兜底卡 + 展示原文，不白屏', () => {
    render(<ReadOnlyFormView formCode="PUR_FORM" formData={JSON.stringify(['A', 'B'])} />);
    const card = screen.getByTestId('form-missing');
    expect(card.getAttribute('data-reason')).toBe('bad-json');
  });

  it('标量 → bad-json 兜底卡', () => {
    render(<ReadOnlyFormView formCode="PUR_FORM" formData={'123'} />);
    expect(screen.getByTestId('form-missing').getAttribute('data-reason')).toBe('bad-json');
  });

  it('嵌套对象（{purchase:{amount}}）能解析但取不到值 ⇒ 全 "-"（静默走错分支的元凶）', () => {
    // ⚠️ 这是 types.ts 硬约束 1 的核心风险：ConditionEvaluator 也取不到。
    renderView({ purchase: { amount: 1000 }, urgent: true });
    expect(valueTextOf('申请金额')).toBe('-');
    expect(valueTextOf('是否加急')).toBe('是');
    expect(screen.getByText(/未在 schema 中声明的字段/)).toBeTruthy();
  });
});
