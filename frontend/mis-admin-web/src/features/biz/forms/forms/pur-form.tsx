/**
 * `PUR_FORM` 采购申请单（方案 T3.4 示例表单）。
 *
 * ## 为什么必须有它
 *
 * `V123__taskflow_menu_api_seed.sql:145` 种了演示定义
 * `PURCHASE_APPROVAL_DEMO`，其 `supported_form_codes = ARRAY['PUR_FORM']`。
 * 之前前端**没有任何 PUR_FORM 实现** ⇒ 那条既有演示流程的审批页会直接走
 * `not-registered` 兜底卡（黄告警+ 不白屏，但审批人看不到任何业务数据）。
 *
 * ## 为什么它不会拖慢首屏
 *
 * 本文件**不被任何静态模块 import**。唯一引用它的地方是
 * `forms/form-loaders.ts` 里的 `import('./pur-form')`，
 * Vite 会把它切成独立 chunk，只在审批页真的要渲染 PUR_FORM 时才下载。
 * 所以「多写一个表单」的真实成本是 0 —— 没人用的表单连字节都不会传。
 *
 * ## 字段约定（方案 §2.6，改前必读）
 *
 * -键**扁平 camelCase**，与 `fields[].key` 一致（`ConditionEvaluator` 只认顶层 key）
 * - 数值不带单位与分隔符（千分位是展示层的事）
 * - 日期存ISO `YYYY-MM-DD`，**不存时间戳**
 * - 空值**不写这个 key**，不要写 null
 */
import * as React from 'react';
import { DateField } from '@/components/ui/date-field';
import { Input } from '@/components/ui/input';
import { MultiSelect } from '@/components/ui/multi-select';
import { NumberField } from '@/components/ui/number-field';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { FormData, FormFieldSchema, FormProps, FormRegistryEntry } from '../types';

/** 采购品类候选。多选**不能用于条件判断**（`ConditionEvaluator` 取数组时得空串）。 */
const CATEGORY_OPTIONS = [
  { value: 'HARDWARE', label: '硬件设备' },
  { value: 'SOFTWARE', label: '软件许可' },
  { value: 'SERVICE', label: '技术服务' },
  { value: 'LOGISTICS', label: '物流运输' },
];

const PRIORITY_OPTIONS = [
  { value: 'HIGH', label: '高' },
  { value: 'NORMAL', label: '普通' },
  { value: 'LOW', label: '低' },
];

/**
 * 字段 schema。
 *
 * ⚠️ 这份 schema **同时是录入态的渲染依据与只读态的渲染依据**
 * （只读走 `fields/*` 渲染器，不实例化本组件）。
 * 加字段时两处都会变，漏改只读态的后果是审批人看到 `-`。
 */
export const PUR_FIELDS: FormFieldSchema[] = [
  { key: 'orderNo', label: '采购单号' },
  { key: 'supplier', label: '供应商' },
  { key: 'amount', label: '申请金额', type: 'number', unit: '元' },
  { key: 'applyDate', label: '申请日期', type: 'date' },
  { key: 'priority', label: '优先级', type: 'select', options: PRIORITY_OPTIONS },
  { key: 'categories', label: '采购品类', type: 'multi', options: CATEGORY_OPTIONS, collapseInReadonly: true },
  { key: 'urgent', label: '是否加急', type: 'bool' },
  { key: 'reason', label: '申请理由', type: 'textarea' },
];

/** 单个字段的容器（标签 + 控件）。 */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <Label className="text-[12px] text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

/**
 * 采购申请单（录入态）。
 *
 * ⚠️ 审批页**不会渲染本组件**（走 `ReadOnlyFormView`），所以这里的
 * `useState`/`useEffect` 在审批场景零成本。`readOnly` 仍然处理，
 * 是为了让本组件被别处误用时不会静默接受编辑。
 */
export function PurForm({ value, fields, readOnly, onChange }: FormProps) {
  // 受控优先：外部给了 onChange 就以它为准，否则本地自持（便于独立预览/测试）
  const [inner, setInner] = React.useState<FormData>(value);
  const current = onChange ? value : inner;

  const set = React.useCallback(
    (patch: FormData) => {
      // ⚠️ readOnly 时**直接不写**：光靠控件的 `disabled` 挡不住
      // 程序化派发的 change 事件（也挡不住将来某个控件漏传 disabled）。
      // 「只读态不得改数据」是契约，不是UI 表现。
      if (readOnly) return;
      const next = { ...current, ...patch };
      if (!onChange) setInner(next);
      onChange?.(next);
    },
    [current, onChange, readOnly],
  );

  // schema 优先用 props（可能按流程定义版本覆盖），缺省回落到本表单的 schema
  const schema = fields.length > 0 ? fields : PUR_FIELDS;

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2" data-testid="pur-form">
      {schema.map((field) => (
        <Field key={field.key} label={field.label}>
          {renderEditor(field, current[field.key], readOnly, set)}
        </Field>
      ))}
    </div>
  );
}

/** 按 schema 类型分发到具体录入控件。 */
function renderEditor(
  field: FormFieldSchema,
  value: FormData[string],
  readOnly: boolean,
  set: (patch: FormData) => void,
) {
  switch (field.type) {
    case 'textarea':
      return (
        <Textarea
          value={typeof value === 'string' ? value : ''}
          disabled={readOnly}
          onChange={(e) => set({ [field.key]: e.target.value })}
        />
      );
    case 'number':
      return (
        <NumberField
          value={typeof value === 'number' ? value : null}
          unit={field.unit}
          disabled={readOnly}
          onChange={(n) => set({ [field.key]: n })}
        />
      );
    case 'date':
      return (
        <DateField
          value={typeof value === 'string' ? value : ''}
          disabled={readOnly}
          onChange={(v) => set({ [field.key]: v })}
        />
      );
    case 'select':
      return (
        <Select
          value={typeof value === 'string' ? value : ''}
          disabled={readOnly}
          onValueChange={(v) => set({ [field.key]: v })}
        >
          <SelectTrigger>
            <SelectValue placeholder="请选择" />
          </SelectTrigger>
          <SelectContent>
            {(field.options ?? []).map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    case 'multi': {
      const list = Array.isArray(value) ? value.map(String) : [];
      return (
        <MultiSelect
          options={field.options ?? []}
          value={list}
          disabled={readOnly}
          onChange={(next) => set({ [field.key]: next })}
        />
      );
    }
    case 'bool':
      return (
        <div className="flex min-h-9 items-center">
          <Switch
            checked={value === true}
            disabled={readOnly}
            onCheckedChange={(checked) => set({ [field.key]: checked })}
          />
        </div>
      );
    case 'text':
    default:
      return (
        <Input
          value={typeof value === 'string' ? value : ''}
          disabled={readOnly}
          onChange={(e) => set({ [field.key]: e.target.value })}
        />
      );
  }
}

/** 注册条目。`formCode` 必须与 `form_definition.code` / `started_form_code` 精确一致。 */
export const purFormEntry: FormRegistryEntry = {
  formCode: 'PUR_FORM',
  name: '采购申请单',
  component: PurForm,
  fields: PUR_FIELDS,
  bundle: 'biz-forms',
};
