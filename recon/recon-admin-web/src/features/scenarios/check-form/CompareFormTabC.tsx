import { useState } from 'react';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { checksApi } from '@/lib/api/checks';
import { errMsg } from '@/lib/api/client';
import { toast } from 'sonner';
import { Plus, Settings2, Trash2, Wand2 } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type {
  CompareRuleRow,
  CompareMode,
  TolType,
  ValueTransform,
  TabCState,
  KeySide,
  SumRuleRow,
} from './types';
import { nextKey, validateSumExpr } from './types';
import { JsonParamEditor, type JsonParamTemplate } from './JsonParamEditor';

/** 行级比较器参数模板（原型 v6.4 阶梯定价演示；真实参数由比较器实现类自解析） */
const TIER_TPL: JsonParamTemplate[] = [
  {
    label: '阶梯定价容差（custom 示例）',
    json: '{"tiers":[{"min":0,"max":100,"tolerance":0.5},{"min":100,"max":500,"tolerance":2}],"amount_field":"pay_amount","round":2}',
  },
];

const COMPARE_MODES: { value: CompareMode; label: string }[] = [
  { value: 'equal', label: '相等 equal' },
  { value: 'custom', label: '自定义比较 custom' },
  { value: 'string', label: '严格字符串 string' },
  { value: 'lte', label: '左 ≤ 右 lte' },
  { value: 'gte', label: '左 ≥ 右 gte' },
  { value: 'lt', label: '左 < 右 lt' },
  { value: 'gt', label: '左 > 右 gt' },
  { value: 'contains', label: '包含 contains' },
  { value: 'regex', label: '正则匹配 regex' },
];

const TOL_TYPES: { value: TolType; label: string }[] = [
  { value: 'null', label: '无容差' },
  { value: 'absolute', label: '绝对差 absolute' },
  { value: 'percentage', label: '比例差 percentage' },
  { value: 'both', label: '两者 both' },
];

const VALUE_TRANSFORMS: { value: ValueTransform; label: string }[] = [
  { value: 'none', label: '无 none' },
  { value: 'trim_comma', label: '去逗号 trim_comma' },
  { value: 'trim', label: '去首尾空白 trim' },
  { value: 'trim_space', label: '去空白 trim_space' },
  { value: 'uppercase', label: '转大写 uppercase' },
  { value: 'lower', label: '转小写 lower' },
  { value: 'abs', label: '取绝对值 abs' },
];

/**
 * Tab C 比较规则：两两策略 = 逐字段比较（结构化表单）；sum_check = 勾稽表达式编辑器
 * （left_expr = right_expr，单数据源内部勾稽，见 T05-spec-sum-check / 原型 v5.9）。
 */
export function CompareFormTabC({
  state,
  onChange,
  left,
  right,
  strategy = 'exact_key',
  alias = '',
  fields = [],
}: {
  state: TabCState;
  onChange: (s: TabCState) => void;
  left: KeySide | null;
  right: KeySide | null;
  /** 当前匹配策略：sum_check → 勾稽表达式形态；custom/custom_check → 规则表（custom_check 由外层隐藏 Tab C） */
  strategy?: 'exact_key' | 'composite_key' | 'sum_check' | 'custom' | 'custom_check';
  /** 当前单源别名（sum_check，恒 = ds_code） */
  alias?: string;
  /** 当前单源字段映射（sum_check 字段引用候选 / 校验） */
  fields?: string[];
}) {
  const isSum = strategy === 'sum_check';

  /* 比较器类名失焦实时校验（§3.4.1/§3.5）：按行 key 记录红字 */
  const [cmpClassErrs, setCmpClassErrs] = useState<Record<string, string>>({});
  /* 行级「参数配置」展开面板（原型 v6.4，默认收起） */
  const [openParams, setOpenParams] = useState<Record<string, boolean>>({});
  async function verifyComparatorClass(row: CompareRuleRow) {
    const c = row.comparator_class.trim();
    if (!c) {
      setCmpClassErrs((m) => {
        const n = { ...m };
        delete n[row.key];
        return n;
      });
      return;
    }
    try {
      await checksApi.validateCustomClass(c, 'custom_compare');
      setCmpClassErrs((m) => {
        const n = { ...m };
        delete n[row.key];
        return n;
      });
    } catch (e) {
      setCmpClassErrs((m) => ({ ...m, [row.key]: errMsg(e) }));
    }
  }

  function setRule(i: number, p: Partial<CompareRuleRow>) {
    onChange({ ...state, rules: state.rules.map((r, k) => (k === i ? { ...r, ...p } : r)) });
  }

  /* ---------------- sum_check 勾稽表达式 ---------------- */

  function setSumRule(i: number, p: Partial<SumRuleRow>) {
    onChange({ ...state, sumRules: state.sumRules.map((r, k) => (k === i ? { ...r, ...p } : r)) });
  }

  function removeSumRule(i: number) {
    if (state.sumRules.length <= 1) {
      toast.warning('勾稽规则至少保留 1 行');
      return;
    }
    onChange({ ...state, sumRules: state.sumRules.filter((_, k) => k !== i) });
  }

  /** 字段引用候选：点击插入 alias.field，已有内容以 ` + ` 连接 */
  function insertField(expr: string, ref: string): string {
    const e = expr.trim();
    return e ? `${e} + ${ref}` : ref;
  }

  /** 填入示例（总额=分量之和）：首字段=左式，随后最多 3 个字段 ` + ` 连接=右式 */
  function autoSumDefault() {
    if (!alias || fields.length < 2) return;
    const leftExpr = `${alias}.${fields[0]}`;
    const rightExpr = fields.slice(1, 4).map((f) => `${alias}.${f}`).join(' + ');
    onChange({
      ...state,
      sumRules: [
        ...state.sumRules,
        {
          key: nextKey(),
          name: '总量 = 分量之和',
          left_expr: leftExpr,
          right_expr: rightExpr,
          tolerance_type: 'null',
          tolerance_value: '',
          is_amount: true,
        },
      ],
    });
  }

  /* ---------------- 两两策略：逐字段比较 ---------------- */

  /* 左右字段选项：值 = 别名.字段名，显示 = 别名 · 字段 */
  const fieldOptions = (side: 'left' | 'right'): { value: string; label: string }[] => {
    const meta = side === 'left' ? left : right;
    if (!meta) return [];
    return meta.fields.map((f) => ({ value: `${meta.alias}.${f}`, label: `${meta.alias} · ${f}` }));
  };
  const leftOpts = fieldOptions('left');
  const rightOpts = fieldOptions('right');

  return (
    <div className="space-y-3">
      {isSum ? (
        <>
          <div className="flex items-center justify-between">
            <Label>
              勾稽表达式 <span className="en">sum_rules</span>
            </Label>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={autoSumDefault}
                disabled={!alias || fields.length < 2}
                title="首字段 = 左侧总量，随后最多 3 个字段之和 = 右侧分量"
              >
                <Wand2 className="mr-1 h-3.5 w-3.5" /> 填入示例（总额=分量之和）
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  onChange({
                    ...state,
                    sumRules: [
                      ...state.sumRules,
                      {
                        key: nextKey(),
                        name: '',
                        left_expr: '',
                        right_expr: '',
                        tolerance_type: 'null',
                        tolerance_value: '',
                        is_amount: true,
                      },
                    ],
                  })
                }
              >
                <Plus className="mr-1 h-3.5 w-3.5" /> 添加规则
              </Button>
            </div>
          </div>

          <div className="rounded-md border border-primary/20 bg-primary/5 px-3 py-2 text-[13px]">
            同一数据源内部勾稽：left_expr 与 right_expr 必须引用{' '}
            <span className="font-mono">{alias || '（待选数据源）'}</span> 的字段，支持{' '}
            <span className="font-mono">+ - * / ( )</span> 算术表达式（如{' '}
            <span className="font-mono">{alias ? `${alias}.a + ${alias}.b - ${alias}.c` : 'alias.a + alias.b'}</span>）；
            差异直接 confirmed、不进两轮确认（单数据源自证）
          </div>

          {state.sumRules.length === 0 && (
            <div className="rounded-md border border-dashed p-6 text-center text-[13px] text-muted-foreground">
              暂无勾稽规则，点击「添加规则」或「填入示例」配置总量 = 分量之和
            </div>
          )}

          <div className="space-y-3">
            {state.sumRules.map((r, i) => {
              const leftErr = r.left_expr.trim() ? validateSumExpr(r.left_expr, alias, fields) : null;
              const rightErr = r.right_expr.trim() ? validateSumExpr(r.right_expr, alias, fields) : null;
              return (
                <div key={r.key} className="space-y-2 rounded-md border p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[12px] font-medium text-muted-foreground">勾稽规则 #{i + 1}</span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => removeSumRule(i)}
                    >
                      <Trash2 className="h-3.5 w-3.5 text-destructive" />
                    </Button>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <Label className="text-[12px]">
                        规则名 <span className="en">name</span>
                      </Label>
                      <Input
                        placeholder="如 订单总额 = 各支付方式之和"
                        value={r.name}
                        onChange={(e) => setSumRule(i, { name: e.target.value })}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[12px]">
                        容差 <span className="en">tolerance</span>
                      </Label>
                      <div className="flex gap-2">
                        <Select
                          value={r.tolerance_type}
                          onValueChange={(v) => setSumRule(i, { tolerance_type: v as TolType })}
                        >
                          <SelectTrigger className="flex-1">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {TOL_TYPES.map((t) => (
                              <SelectItem key={t.value} value={t.value}>
                                {t.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {r.tolerance_type !== 'null' && (
                          <Input
                            className="w-24 font-mono"
                            placeholder="值"
                            value={r.tolerance_value}
                            onChange={(e) => setSumRule(i, { tolerance_value: e.target.value })}
                          />
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="space-y-1">
                    <Label className="text-[12px]">
                      左侧表达式 <span className="en">left_expr</span> *
                    </Label>
                    <Input
                      className={`font-mono ${leftErr ? 'border-destructive' : ''}`}
                      placeholder={alias ? `${alias}.total_amount` : 'alias.total_amount'}
                      value={r.left_expr}
                      onChange={(e) => setSumRule(i, { left_expr: e.target.value })}
                    />
                    {r.left_expr.trim() && (
                      <p className={`text-[11px] ${leftErr ? 'text-destructive' : 'text-emerald-600'}`}>
                        {leftErr ? `✘ ${leftErr}` : '✔ 语法合法，引用有效'}
                      </p>
                    )}
                    {fields.length > 0 && (
                      <div className="flex flex-wrap items-center gap-1 pt-0.5">
                        <span className="text-[11px] text-muted-foreground">字段引用：</span>
                        {fields.map((f) => (
                          <button
                            key={f}
                            type="button"
                            className="rounded border px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground hover:bg-accent"
                            onClick={() => setSumRule(i, { left_expr: insertField(r.left_expr, `${alias}.${f}`) })}
                          >
                            {alias}.{f}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="space-y-1">
                    <Label className="text-[12px]">
                      右侧表达式 <span className="en">right_expr</span> *
                    </Label>
                    <Input
                      className={`font-mono ${rightErr ? 'border-destructive' : ''}`}
                      placeholder={alias ? `${alias}.a + ${alias}.b - ${alias}.c` : 'alias.a + alias.b'}
                      value={r.right_expr}
                      onChange={(e) => setSumRule(i, { right_expr: e.target.value })}
                    />
                    {r.right_expr.trim() && (
                      <p className={`text-[11px] ${rightErr ? 'text-destructive' : 'text-emerald-600'}`}>
                        {rightErr ? `✘ ${rightErr}` : '✔ 语法合法，引用有效'}
                      </p>
                    )}
                    {fields.length > 0 && (
                      <div className="flex flex-wrap items-center gap-1 pt-0.5">
                        <span className="text-[11px] text-muted-foreground">字段引用：</span>
                        {fields.map((f) => (
                          <button
                            key={f}
                            type="button"
                            className="rounded border px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground hover:bg-accent"
                            onClick={() => setSumRule(i, { right_expr: insertField(r.right_expr, `${alias}.${f}`) })}
                          >
                            {alias}.{f}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-2 text-[13px]">
                    <input
                      id={`sum-amount-${r.key}`}
                      type="checkbox"
                      className="h-4 w-4 rounded border-input"
                      checked={r.is_amount}
                      onChange={(e) => setSumRule(i, { is_amount: e.target.checked })}
                    />
                    <label htmlFor={`sum-amount-${r.key}`} className="cursor-pointer">
                      金额字段 <span className="en">is_amount</span>
                      <span className="f-note ml-1">
                        按「分」存储，UI 显示 ¥ 元；开启后金额按容差比对，非金额按原值比较
                      </span>
                    </label>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      ) : (
        <>
          <div className="flex items-center justify-between">
            <Label>
              比较规则 <span className="en">rules_json</span>
            </Label>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                onChange({
                  ...state,
                  rules: [
                    ...state.rules,
                    {
                      key: nextKey(),
                      name: '',
                      left_field: '',
                      right_field: '',
                      compare_mode: 'equal',
                      tolerance_type: 'null',
                      tolerance_value: '',
                      is_amount: true,
                      value_transform: 'none',
                      zero_unmatched_skip: false,
                      diff_unit: 'none',
                      comparator_class: '',
                      comparator_params: '',
                    },
                  ],
                })
              }
            >
              <Plus className="mr-1 h-3.5 w-3.5" /> 添加规则
            </Button>
          </div>

          {state.rules.length === 0 && (
            <div className="rounded-md border border-dashed p-6 text-center text-[13px] text-muted-foreground">
              暂无比较规则，点击「添加规则」逐条配置左右字段比对；左右字段下拉自清单第 1/2 行数据源字段（别名.字段名）
            </div>
          )}

          <div className="space-y-3">
            {state.rules.map((r, i) => (
              <div key={r.key} className="space-y-2 rounded-md border p-3">
                <div className="flex items-center justify-between">
                  <span className="text-[12px] font-medium text-muted-foreground">规则 #{i + 1}</span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => onChange({ ...state, rules: state.rules.filter((_, k) => k !== i) })}
                  >
                    <Trash2 className="h-3.5 w-3.5 text-destructive" />
                  </Button>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label className="text-[12px]">
                      规则名 <span className="en">name</span>
                    </Label>
                    <Input
                      placeholder="如 微信支付金额"
                      value={r.name}
                      onChange={(e) => setRule(i, { name: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[12px]">
                      比较方式 <span className="en">compare_mode</span>
                    </Label>
                    <Select
                      value={r.compare_mode}
                      onValueChange={(v) => setRule(i, { compare_mode: v as CompareMode })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {COMPARE_MODES.map((m) => (
                          <SelectItem key={m.value} value={m.value}>
                            {m.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {r.compare_mode === 'custom' ? (
                  /* 自定义比较行：比较器类名 + 参数配置展开面板（需求 §3.5，原型 v6.4） */
                  <div className="space-y-2 rounded-md border border-primary/20 bg-primary/5 p-3">
                    <div className="space-y-1">
                      <Label className="text-[12px]">
                        比较器类名 <span className="en">comparator_class</span> *
                      </Label>
                      <div className="flex items-center gap-2">
                        <Input
                          className={`max-w-md font-mono ${cmpClassErrs[r.key] ? 'border-destructive' : ''}`}
                          placeholder="com.mis.recon.custom.example.TieredPricingComparator"
                          value={r.comparator_class}
                          onChange={(e) => {
                            setRule(i, { comparator_class: e.target.value });
                            setCmpClassErrs((m) => {
                              const n = { ...m };
                              delete n[r.key];
                              return n;
                            });
                          }}
                          onBlur={() => void verifyComparatorClass(r)}
                        />
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-8 shrink-0 text-[12px]"
                          onClick={() => setOpenParams((m) => ({ ...m, [r.key]: !m[r.key] }))}
                        >
                          <Settings2 className="mr-1 h-3.5 w-3.5" />
                          {openParams[r.key] ? '收起参数' : '参数配置'}
                        </Button>
                      </div>
                      <p className="text-[11px] text-muted-foreground">须实现 CustomComparator 接口（失焦/保存时校验）</p>
                      {cmpClassErrs[r.key] && (
                        <p className="text-[11px] text-destructive">✘ {cmpClassErrs[r.key]}</p>
                      )}
                    </div>
                    {openParams[r.key] && (
                      <div className="space-y-1 rounded-md border border-dashed bg-card/60 p-3">
                        <Label className="text-[12px]">
                          行级参数 <span className="en">comparator_params</span>
                        </Label>
                        <JsonParamEditor
                          compact
                          value={r.comparator_params}
                          onChange={(j) => setRule(i, { comparator_params: j })}
                          templates={TIER_TPL}
                        />
                      </div>
                    )}
                    <p className="f-note">
                      该行差异由比较器自定义：无需左右字段 / 容差 / 值归一；行级参数原样传入比较器实现类，与内置 equal 行可混用
                    </p>
                  </div>
                ) : (
                  <>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <Label className="text-[12px]">
                          左字段 <span className="en">left_field</span>
                        </Label>
                        {leftOpts.length > 0 ? (
                          <Select value={r.left_field} onValueChange={(v) => setRule(i, { left_field: v })}>
                            <SelectTrigger className="font-mono">
                              <SelectValue placeholder="选择左字段" />
                            </SelectTrigger>
                            <SelectContent>
                              {leftOpts.map((o) => (
                                <SelectItem key={o.value} value={o.value}>
                                  {o.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : (
                          <Input
                            className="font-mono"
                            placeholder="orders.wx_pay_amount"
                            value={r.left_field}
                            onChange={(e) => setRule(i, { left_field: e.target.value })}
                          />
                        )}
                        {left && left.fields.length === 0 && (
                          <p className="text-[11px] text-muted-foreground">左侧数据源未配置字段映射，可手输</p>
                        )}
                      </div>
                      <div className="space-y-1">
                        <Label className="text-[12px]">
                          右字段 <span className="en">right_field</span>
                        </Label>
                        {rightOpts.length > 0 ? (
                          <Select value={r.right_field} onValueChange={(v) => setRule(i, { right_field: v })}>
                            <SelectTrigger className="font-mono">
                              <SelectValue placeholder="选择右字段" />
                            </SelectTrigger>
                            <SelectContent>
                              {rightOpts.map((o) => (
                                <SelectItem key={o.value} value={o.value}>
                                  {o.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : (
                          <Input
                            className="font-mono"
                            placeholder="wechat_pay.amount"
                            value={r.right_field}
                            onChange={(e) => setRule(i, { right_field: e.target.value })}
                          />
                        )}
                        {right && right.fields.length === 0 && (
                          <p className="text-[11px] text-muted-foreground">右侧数据源未配置字段映射，可手输</p>
                        )}
                      </div>
                      <div className="space-y-1">
                        <Label className="text-[12px]">
                          容差 <span className="en">tolerance</span>
                        </Label>
                        <div className="flex gap-2">
                          <Select value={r.tolerance_type} onValueChange={(v) => setRule(i, { tolerance_type: v as TolType })}>
                            <SelectTrigger className="flex-1">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {TOL_TYPES.map((t) => (
                                <SelectItem key={t.value} value={t.value}>
                                  {t.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          {r.tolerance_type !== 'null' && (
                            <Input
                              className="w-24 font-mono"
                              placeholder="值"
                              value={r.tolerance_value}
                              onChange={(e) => setRule(i, { tolerance_value: e.target.value })}
                            />
                          )}
                        </div>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-[12px]">
                          值归一 <span className="en">value_transform</span>
                        </Label>
                        <Select
                          value={r.value_transform}
                          onValueChange={(v) => setRule(i, { value_transform: v as ValueTransform })}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {VALUE_TRANSFORMS.map((t) => (
                              <SelectItem key={t.value} value={t.value}>
                                {t.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    <div className="mt-1 flex items-center gap-2 text-[13px]">
                      <input
                        id={`amount-${r.key}`}
                        type="checkbox"
                        className="h-4 w-4 rounded border-input"
                        checked={r.is_amount}
                        onChange={(e) =>
                          setRule(i, e.target.checked ? { is_amount: true, diff_unit: 'none' } : { is_amount: false })
                        }
                      />
                      <label htmlFor={`amount-${r.key}`} className="cursor-pointer">
                        金额字段 <span className="en">is_amount</span>
                        <span className="f-note ml-1">按「分」存储，UI 显示 ¥ 元；开启后做金额容差与态转换（与积分差额互斥）</span>
                      </label>
                    </div>
                    <div className="mt-1 flex items-center gap-2 text-[13px]">
                      <input
                        id={`zero-${r.key}`}
                        type="checkbox"
                        className="h-4 w-4 rounded border-input"
                        checked={r.zero_unmatched_skip}
                        onChange={(e) => setRule(i, { zero_unmatched_skip: e.target.checked })}
                      />
                      <label htmlFor={`zero-${r.key}`} className="cursor-pointer">
                        单侧为 0 不算差异 <span className="en">zero_unmatched_skip</span>
                        <span className="f-note ml-1">仅一侧有记录且本侧该字段值为 0 时视为一致（积分对账 0 积分订单）</span>
                      </label>
                    </div>
                    <div className="mt-1 flex items-center gap-2 text-[13px]">
                      <input
                        id={`point-${r.key}`}
                        type="checkbox"
                        className="h-4 w-4 rounded border-input"
                        checked={r.diff_unit === 'point'}
                        onChange={(e) =>
                          setRule(i, e.target.checked ? { diff_unit: 'point', is_amount: false } : { diff_unit: 'none' })
                        }
                      />
                      <label htmlFor={`point-${r.key}`} className="cursor-pointer">
                        计入积分差额 <span className="en">diff_unit=point</span>
                        <span className="f-note ml-1">非货币计量（积分）差值写入 diff_point，报告显示「积分差」，不进金额列（与金额字段互斥）</span>
                      </label>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
