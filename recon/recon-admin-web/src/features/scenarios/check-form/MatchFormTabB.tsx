import { useEffect, useState } from 'react';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { checksApi } from '@/lib/api/checks';
import { errMsg } from '@/lib/api/client';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ArrowDown, ArrowUp, Plus, Trash2, X, Wand2 } from 'lucide-react';
import type {
  TabBState,
  KeyTemplateRow,
  TransformRow,
  MultiRowModeRow,
  TransformType,
  KeySide,
} from './types';
import { nextKey, partsToTemplate } from './types';
import { JsonParamEditor, type JsonParamTemplate } from './JsonParamEditor';

/** 自定义参数模板（原型 v6.3，仅引导；真实参数由实现类自解析） */
const CUSTOM_CFG_TEMPLATES: JsonParamTemplate[] = [
  { label: '跨系统映射表（custom）', json: '{"id_mapping_table":"sys_order_id_map","fallback":"fuzzy"}' },
];
const CUSTOM_CHECK_CFG_TEMPLATES: JsonParamTemplate[] = [
  { label: '状态流检查（custom_check）', json: '{"status_flow":"PAID->REFUNDED","notify_channel":"dingtalk"}' },
];

const TRANSFORM_TYPES: { value: TransformType; label: string }[] = [
  { value: 'prefix_remove', label: '去前缀 prefix_remove' },
  { value: 'prefix_add', label: '加前缀 prefix_add' },
  { value: 'regex_replace', label: '正则替换 regex_replace' },
];

const MULTI_MODES: { value: MultiRowModeRow['mode']; label: string }[] = [
  { value: 'reject', label: '转异常 reject' },
  { value: 'aggregate', label: '聚合求和 aggregate' },
  { value: 'latest', label: '取末行 latest' },
];

const SEP_OPTIONS: { v: string; label: string }[] = [
  { v: '_', label: '下划线 _' },
  { v: '-', label: '中划线 -' },
  { v: '', label: '无分隔' },
];

/**
 * Tab B 匹配规则（结构化表单）：
 * - 匹配键字段 key_fields_json：按左右两侧（Tab A 清单第 1/2 行）勾选字段 + 排序 + 分隔符生成模板，替代手写输入框
 * - 字段归一 / 同键多行：沿用结构化行编辑
 */
export function MatchFormTabB({
  state,
  onChange,
  aliases,
  left,
  right,
}: {
  state: TabBState;
  onChange: (s: TabBState) => void;
  aliases: string[];
  left: KeySide | null;
  right: KeySide | null;
}) {
  function patch(p: Partial<TabBState>) {
    onChange({ ...state, ...p });
  }

  function setTransform(i: number, p: Partial<TransformRow>) {
    patch({ transforms: state.transforms.map((r, k) => (k === i ? { ...r, ...p } : r)) });
  }
  function setMultiRow(i: number, p: Partial<MultiRowModeRow>) {
    patch({ multiRows: state.multiRows.map((r, k) => (k === i ? { ...r, ...p } : r)) });
  }

  /* 字段归一「字段」选项：按所选数据集（左右两侧）的字段映射 */
  const fieldsByAlias: Record<string, string[]> = {};
  if (left) fieldsByAlias[left.alias] = left.fields;
  if (right) fieldsByAlias[right.alias] = right.fields;
  function setTransformDataset(i: number, dataset: string) {
    const r = state.transforms[i];
    const opts = fieldsByAlias[dataset] ?? [];
    setTransform(i, { dataset, field: opts.includes(r.field) ? r.field : '' });
  }

  /* 打开即保证左右两侧都有行（便于直接勾选/保存） */
  const sideAliasKey = `${left?.alias ?? ''}|${right?.alias ?? ''}`;
  useEffect(() => {
    const metas = [left, right].filter(Boolean) as KeySide[];
    const missing = metas.filter((m) => !state.keyTemplates.some((r) => r.alias === m.alias));
    if (!missing.length) return;
    patch({
      keyTemplates: [
        ...state.keyTemplates,
        ...missing.map((m) => ({ key: nextKey(), alias: m.alias, template: '', fields: [], sep: '_' })),
      ],
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sideAliasKey]);

  function rowFor(alias: string): KeyTemplateRow | undefined {
    return state.keyTemplates.find((r) => r.alias === alias);
  }
  function setAliasRow(alias: string, p: Partial<KeyTemplateRow>) {
    patch({ keyTemplates: state.keyTemplates.map((r) => (r.alias === alias ? { ...r, ...p } : r)) });
  }

  function toggleField(meta: KeySide, field: string, checked: boolean) {
    const row = rowFor(meta.alias);
    if (!row) return;
    let fields = row.fields;
    if (state.strategy === 'exact_key') {
      fields = checked ? [field] : [];
    } else {
      fields = checked
        ? fields.includes(field)
          ? fields
          : [...fields, field]
        : fields.filter((f) => f !== field);
    }
    setAliasRow(meta.alias, { fields, template: partsToTemplate(fields, row.sep) });
  }

  function moveField(meta: KeySide, idx: number, dir: -1 | 1) {
    const row = rowFor(meta.alias);
    if (!row) return;
    const arr = [...row.fields];
    const j = idx + dir;
    if (j < 0 || j >= arr.length) return;
    [arr[idx], arr[j]] = [arr[j], arr[idx]];
    setAliasRow(meta.alias, { fields: arr, template: partsToTemplate(arr, row.sep) });
  }

  function changeSep(meta: KeySide, sep: string) {
    const row = rowFor(meta.alias);
    if (!row) return;
    setAliasRow(meta.alias, { sep, template: partsToTemplate(row.fields, sep) });
  }

  function autoMatch() {
    if (!left || !right) return;
    const common = left.fields.filter((f) => right.fields.includes(f));
    if (!common.length) return;
    const arr = state.strategy === 'exact_key' ? common.slice(0, 1) : common;
    patch({
      keyTemplates: state.keyTemplates.map((r) =>
        r.alias === left.alias || r.alias === right.alias
          ? { ...r, fields: arr, template: partsToTemplate(arr, r.sep) }
          : r,
      ),
    });
  }

  function checkErr(): string | null {
    const metas = [left, right].filter(Boolean) as KeySide[];
    if (metas.length < 2) return '请先在 Tab A 配置恰好 2 个参与数据源';
    for (const m of metas) {
      const n = rowFor(m.alias)?.fields.length ?? 0;
      if (n === 0) return `「${m.alias}」未选择匹配键字段`;
      if (state.strategy === 'exact_key' && n !== 1) return `精确匹配：「${m.alias}」须恰好选择 1 个字段`;
    }
    if (state.strategy === 'composite_key' && left && right) {
      if ((rowFor(left.alias)?.sep ?? '_') !== (rowFor(right.alias)?.sep ?? '_')) {
        return '复合键：两侧分隔符必须一致，保证拼接值一致';
      }
    }
    return null;
  }

  function sideTpl(meta: KeySide | null): string {
    if (!meta) return '—';
    const row = rowFor(meta.alias);
    if (!row || !row.fields.length) return '—';
    return state.strategy === 'exact_key' ? `{${row.fields[0]}}` : partsToTemplate(row.fields, row.sep);
  }

  const kfErr = checkErr();

  const isSum = state.strategy === 'sum_check';
  const isCustom = state.strategy === 'custom' || state.strategy === 'custom_check';

  /* 类名失焦实时校验（§3.4.1）：类可加载 + 实现对应接口，红字提示 */
  const [classErr, setClassErr] = useState<string | null>(null);
  async function verifyClass() {
    const c = state.customClass.trim();
    if (!c) {
      setClassErr(null);
      return;
    }
    try {
      await checksApi.validateCustomClass(c, state.strategy === 'custom' ? 'custom' : 'custom_check');
      setClassErr(null);
    } catch (e) {
      setClassErr(errMsg(e));
    }
  }

  return (
    <div className="space-y-4">
      {/* 匹配策略 */}
      <div className="space-y-1.5">
        <Label>
          匹配策略 <span className="en">strategy</span>
        </Label>
        <Select
          value={state.strategy}
          onValueChange={(s) => patch({ strategy: s as TabBState['strategy'] })}
        >
          <SelectTrigger className="w-64">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="exact_key">
              精确匹配 <span className="val">exact_key</span>
            </SelectItem>
            <SelectItem value="composite_key">
              复合键 <span className="val">composite_key</span>
            </SelectItem>
            <SelectItem value="sum_check">
              汇总校验 <span className="val">sum_check</span>
            </SelectItem>
            <SelectItem value="custom">
              自定义 <span className="val">custom</span>
            </SelectItem>
            <SelectItem value="custom_check">
              整检查自定义 <span className="val">custom_check</span>
            </SelectItem>
          </SelectContent>
        </Select>
        <p className="f-note">
          {state.strategy === 'custom'
            ? '自定义 custom：匹配逻辑整体交给自定义类（全限定类名），消费清单恰好 2 个参与数据源'
            : state.strategy === 'custom_check'
              ? '整检查自定义 custom_check：匹配+比较整体交给自定义类（全限定类名），消费清单 1~N 个参与数据源'
              : state.strategy === 'sum_check'
                ? '汇总校验 sum_check：同一数据源内部勾稽（总量 = 分量之和），无需匹配键，消费模式需且仅需 1 个数据源；模糊 / 链路为后续形态，暂不开放'
                : '匹配键在下方配置（精确单选 1 字段 / 复合多字段）；模糊 / 链路为后续形态，暂不开放'}
        </p>
      </div>

      {isSum ? (
        <div className="space-y-3">
          <div className="rounded-md border border-primary/20 bg-primary/5 px-3 py-2 text-[13px]">
            参与匹配数据源自动继承消费模式清单（全量）；sum_check 为单数据源内部勾稽，Tab A 清单需且仅需
            1 个数据源（左侧「唯一 · 第 1 行」），无需匹配键 / 字段归一 / 同键多行
          </div>
          <div className="rounded-md border border-dashed p-4 text-center text-[13px] text-muted-foreground">
            勾稽表达式（left_expr = right_expr）请在 <span className="font-medium text-foreground">Tab C · 比较规则</span> 配置
          </div>
        </div>
      ) : isCustom ? (
        <div className="space-y-3">
          <div className="rounded-md border border-primary/20 bg-primary/5 px-3 py-2 text-[13px]">
            {state.strategy === 'custom'
              ? '自定义匹配 custom：匹配逻辑整体交给自定义类，消费清单恰好 2 个（左 · 第 1 行 / 右 · 第 2 行），无需匹配键 / 字段归一 / 同键多行；比较规则在 Tab C 配置'
              : '整检查自定义 custom_check：匹配+比较整体交给自定义类，消费清单 1~N 个（无左右角色），无需匹配键 / 字段归一 / 同键多行；Tab C 不参与'}
          </div>

          {/* 自定义类配置（需求 §3.4；参数编辑 = 键值对表格 + 模板 + 简单/高级双模式，原型 v6.3） */}
          <div className="space-y-3 rounded-md border border-input bg-card p-3">
            <Label>
              自定义类配置 <span className="en">custom_class</span>
            </Label>
            <div className="space-y-1">
              <Label className="text-[12px]">
                类名 <span className="en">class</span> *
              </Label>
              <Input
                className={`max-w-md font-mono ${classErr ? 'border-destructive' : ''}`}
                placeholder={state.strategy === 'custom'
                  ? 'com.mis.recon.custom.example.CrossSystemIdMatcher'
                  : 'com.mis.recon.custom.example.OrderLifecycleCheck'}
                value={state.customClass}
                onChange={(e) => {
                  patch({ customClass: e.target.value });
                  setClassErr(null);
                }}
                onBlur={() => void verifyClass()}
              />
              <p className="text-[11px] text-muted-foreground">
                {state.strategy === 'custom' ? '须实现 CustomMatcher 接口' : '须实现 CustomCheckExecutor 接口'}
              </p>
              {classErr && <p className="text-[11px] text-destructive">✘ {classErr}</p>}
            </div>
            <div className="space-y-1">
              <Label className="text-[12px]">
                参数 <span className="en">config_json</span>
              </Label>
              <JsonParamEditor
                value={state.configJson}
                onChange={(j) => patch({ configJson: j })}
                templates={state.strategy === 'custom' ? CUSTOM_CFG_TEMPLATES : CUSTOM_CHECK_CFG_TEMPLATES}
              />
            </div>
            <p className="f-note">
              自定义类由平台按全限定类名加载，优先从 Spring 容器获取，无则反射无参构造；除 class
              外的键值将原样传入实现类，保存时校验类可加载且实现对应接口。可直接使用内置示例类：
              {state.strategy === 'custom'
                ? 'com.mis.recon.custom.example.CrossSystemIdMatcher（跨系统单号直配）'
                : 'com.mis.recon.custom.example.OrderLifecycleCheck（订单状态流检查）'}
            </p>
          </div>
        </div>
      ) : (
        <>
      <div className="rounded-md border border-primary/20 bg-primary/5 px-3 py-2 text-[13px]">
        参与匹配数据源自动继承消费模式清单（全量），无需重复配置；左右角色 = 清单顺序（第 1 行 = 左、第 2 行 = 右）
      </div>

      {/* 匹配键字段（配置器：勾选字段 → 排序 → 分隔符 → 实时模板预览） */}
      <div className="space-y-2">
        <Label>
          匹配键字段 <span className="en">key_fields_json</span> *
        </Label>
        <div className="space-y-2 rounded-md border border-input bg-card p-3">
          <div className="grid grid-cols-2 gap-3">
            {(
              [
                ['left', left],
                ['right', right],
              ] as const
            ).map(([side, meta]) => {
              if (!meta) {
                return (
                  <div
                    key={side}
                    className="flex min-h-40 items-center justify-center rounded-md border border-dashed p-3 text-center text-[13px] text-muted-foreground"
                  >
                    {side === 'left' ? '左' : '右'} · 清单第 {side === 'left' ? '1' : '2'} 行未配置
                  </div>
                );
              }
              const row = rowFor(meta.alias);
              const selected = row?.fields ?? [];
              return (
                <div key={side} className="space-y-1.5">
                  <div className="text-[13px] font-medium">
                    {side === 'left' ? '左' : '右'} ·{' '}
                    <span className="font-mono">{meta.label}</span>
                  </div>
                  <div className="text-[11px] text-muted-foreground">备选字段（勾选加入匹配键）</div>
                  {meta.fields.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      数据源未配置字段映射（fields_json），请先在数据源管理补充
                    </p>
                  ) : (
                    <div className="flex max-h-24 flex-wrap gap-2 overflow-y-auto">
                      {meta.fields.map((f) => (
                        <label
                          key={f}
                          className="flex cursor-pointer items-center gap-1 rounded border px-2 py-0.5 text-xs"
                        >
                          <input
                            type="checkbox"
                            checked={selected.includes(f)}
                            onChange={(e) => toggleField(meta, f, e.target.checked)}
                          />
                          <span className="font-mono">{f}</span>
                        </label>
                      ))}
                    </div>
                  )}
                  <div className="text-[11px] text-muted-foreground">已选顺序（拼接顺序）</div>
                  <ol className="space-y-1">
                    {selected.map((f, i) => (
                      <li
                        key={f}
                        className="flex items-center justify-between gap-2 rounded border bg-muted/40 px-2 py-1 text-xs"
                      >
                        <span className="font-mono">{f}</span>
                        <span className="flex shrink-0 items-center gap-0.5">
                          {state.strategy === 'composite_key' && i > 0 && (
                            <button
                              type="button"
                              className="rounded p-0.5 hover:bg-accent"
                              onClick={() => moveField(meta, i, -1)}
                            >
                              <ArrowUp className="h-3 w-3" />
                            </button>
                          )}
                          {state.strategy === 'composite_key' && i < selected.length - 1 && (
                            <button
                              type="button"
                              className="rounded p-0.5 hover:bg-accent"
                              onClick={() => moveField(meta, i, 1)}
                            >
                              <ArrowDown className="h-3 w-3" />
                            </button>
                          )}
                          <button
                            type="button"
                            className="rounded p-0.5 text-destructive hover:bg-destructive/10"
                            onClick={() => toggleField(meta, f, false)}
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </span>
                      </li>
                    ))}
                    {selected.length === 0 && <li className="text-xs text-muted-foreground">未选择</li>}
                  </ol>
                  {state.strategy === 'composite_key' && (
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] text-muted-foreground">分隔符</span>
                      <select
                        className="h-7 rounded-md border border-input bg-card px-1.5 text-xs"
                        value={row?.sep ?? '_'}
                        onChange={(e) => changeSep(meta, e.target.value)}
                      >
                        {SEP_OPTIONS.map((s) => (
                          <option key={s.v} value={s.v}>
                            {s.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={autoMatch} disabled={!left || !right}>
              <Wand2 className="mr-1 h-3.5 w-3.5" /> 同名自动匹配
            </Button>
            <span className="text-xs text-muted-foreground">按左右数据源同名字段自动勾选为匹配键</span>
          </div>

          <div className="flex items-center gap-2 text-[13px]">
            <span className="text-muted-foreground">模板预览</span>
            <code className="font-mono text-primary">
              左 {sideTpl(left)}　右 {sideTpl(right)}
            </code>
          </div>

          {kfErr ? (
            <p className="text-xs text-destructive">{kfErr}</p>
          ) : (
            <p className="f-note">
              {state.strategy === 'exact_key'
                ? '精确匹配：左右各单选 1 个字段作匹配键'
                : '复合键：左右各选 ≥1 个字段、按序排列，两侧分隔符需一致；字段值在拼接前可经下方「字段归一」处理'}
            </p>
          )}
        </div>
      </div>

      {/* 空键跳过 */}
      <div className="space-y-2">
        <Label>
          空键跳过 <span className="en">empty_key_skip</span>
        </Label>
        <div className="flex flex-wrap gap-2 rounded-md border border-input bg-card p-3">
          {aliases.length === 0 && (
            <p className="text-xs text-muted-foreground">请先在 Tab A 配置参与数据源</p>
          )}
          {aliases.map((a) => (
            <label key={a} className="flex cursor-pointer items-center gap-1 rounded border px-2 py-0.5 text-xs">
              <input
                type="checkbox"
                checked={state.emptyKeySkip.includes(a)}
                onChange={(e) => {
                  const set = e.target.checked
                    ? [...state.emptyKeySkip, a]
                    : state.emptyKeySkip.filter((x) => x !== a);
                  patch({ emptyKeySkip: set });
                }}
              />
              <span className="font-mono">{a}</span>
            </label>
          ))}
        </div>
        <p className="f-note">
          勾选后：该数据源匹配键为空（字段缺失 / null）时直接丢弃，不产生「空匹配键」异常。例：储值卡对账中 trad_id
          为空 = 订单未用储值卡支付，应跳过而非报异常
        </p>
      </div>

      {/* 字段归一 */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label>
            字段归一 <span className="en">field_transform_json</span>
          </Label>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              patch({
                transforms: [
                  ...state.transforms,
                  { key: nextKey(), dataset: '', field: '', type: 'prefix_remove', pattern: '', replacement: '' },
                ],
              })
            }
          >
            <Plus className="mr-1 h-3.5 w-3.5" /> 添加规则
          </Button>
        </div>
        {state.transforms.length === 0 && (
          <p className="f-note">可选；匹配键拼接前先归一字段值，可多条。字段下拉选项取自数据源字段映射（fields_json），数据集未配字段映射时可用手输</p>
        )}
        <div className="space-y-2">
          {state.transforms.map((r, i) => {
            const ftFieldOpts = fieldsByAlias[r.dataset] ?? [];
            return (
            <div key={r.key} className="flex items-center gap-2">
              <Select value={r.dataset} onValueChange={(v) => setTransformDataset(i, v)}>
                <SelectTrigger className="w-36">
                  <SelectValue placeholder="数据集" />
                </SelectTrigger>
                <SelectContent>
                  {aliases.map((a) => (
                    <SelectItem key={a} value={a}>
                      {a}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {ftFieldOpts.length > 0 ? (
                <Select value={r.field} onValueChange={(v) => setTransform(i, { field: v })}>
                  <SelectTrigger className="w-40">
                    <SelectValue placeholder="选择字段" />
                  </SelectTrigger>
                  <SelectContent>
                    {ftFieldOpts.map((f) => (
                      <SelectItem key={f} value={f}>
                        {f}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  className="w-32 font-mono"
                  placeholder="字段名"
                  value={r.field}
                  onChange={(e) => setTransform(i, { field: e.target.value })}
                />
              )}
              <Select value={r.type} onValueChange={(v) => setTransform(i, { type: v as TransformType })}>
                <SelectTrigger className="w-48">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TRANSFORM_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                className="w-40 font-mono"
                placeholder={r.type === 'regex_replace' ? '正则' : '前缀'}
                value={r.pattern}
                onChange={(e) => setTransform(i, { pattern: e.target.value })}
              />
              {r.type === 'regex_replace' && (
                <Input
                  className="w-32 font-mono"
                  placeholder="替换为"
                  value={r.replacement}
                  onChange={(e) => setTransform(i, { replacement: e.target.value })}
                />
              )}
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 shrink-0"
                onClick={() => patch({ transforms: state.transforms.filter((_, k) => k !== i) })}
              >
                <Trash2 className="h-3.5 w-3.5 text-destructive" />
              </Button>
            </div>
            );
          })}
        </div>
      </div>

      {/* 同键多行 */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label>
            同键多行 <span className="en">multi_row_json</span>
          </Label>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              patch({ multiRows: [...state.multiRows, { key: nextKey(), alias: '', mode: 'reject' }] })
            }
          >
            <Plus className="mr-1 h-3.5 w-3.5" /> 添加数据集
          </Button>
        </div>
        {state.multiRows.length === 0 && (
          <p className="f-note">可选；为空时所有数据集按 reject（同键多行视为数据异常）</p>
        )}
        <div className="space-y-2">
          {state.multiRows.map((r, i) => (
            <div key={r.key} className="flex items-center gap-2">
              <Select value={r.alias} onValueChange={(v) => setMultiRow(i, { alias: v })}>
                <SelectTrigger className="w-40">
                  <SelectValue placeholder="数据集别名" />
                </SelectTrigger>
                <SelectContent>
                  {aliases.map((a) => (
                    <SelectItem key={a} value={a}>
                      {a}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={r.mode} onValueChange={(v) => setMultiRow(i, { mode: v as MultiRowModeRow['mode'] })}>
                <SelectTrigger className="w-56">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MULTI_MODES.map((m) => (
                    <SelectItem key={m.value} value={m.value}>
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 shrink-0"
                onClick={() => patch({ multiRows: state.multiRows.filter((_, k) => k !== i) })}
              >
                <Trash2 className="h-3.5 w-3.5 text-destructive" />
              </Button>
            </div>
          ))}
        </div>
      </div>
        </>
      )}
    </div>
  );
}
