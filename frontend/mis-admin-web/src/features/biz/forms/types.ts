/**
 * 业务表单契约（方案 Q2 §2.2）。
 *
 * 三条硬约束，改动前必读：
 *
 * 1. **表单数据是扁平的**（`Record<string, scalar>`，一层不嵌套）。
 *    因为后端 `ConditionEvaluator.resolve()` 做的是 `vars.get(token)`，
 *    只认顶层 key。写成 `{ purchase: { amount } }` 时 `${amount > 50000}` 永远取到null，
 *    静默走错分支且不报错。
 *
 * 2. **数值不带单位与分隔符**。千分位是展示层的事，`"128,000"` 参与比较会解析失败。
 *
 * 3. **多选是数组且不能用于条件判断**。`ConditionEvaluator` 取到数组时 `asText()` 得空串。
 *
 * ⚠️ `FormData` 的 value 不含数组，但 §2.6 约定多选字段存 `string[]`。
 * 这里刻意放宽为 `FormScalar | string[]`：运行时按 schema 的 `type` 解释，
 * 收紧类型会让多选字段无法表达（后端 JSON 解析后就是数组）。
 */
import type { ComponentType } from 'react';

/** 表单值的原子类型。 */
export type FormScalar = string | number | boolean | null;

/** 单个字段的原始值。多选字段为 `string[]`，其余为 `FormScalar`。 */
export type FormFieldValue = FormScalar | string[];

/** 表单数据 = 扁平键值对。键即 fieldKey，供 conditionExpr 引用。 */
export type FormData = Record<string, FormFieldValue>;

/** 字段类型。决定只读态用哪个渲染器。 */
export type FormFieldType =
  | 'text'
  | 'textarea'
  | 'number'
  | 'date'
  | 'datetime'
  | 'select'
  | 'multi'
  | 'bool';

/** select/multi 的候选项：value → label。只读态显示 label，不显示 value。 */
export interface FormFieldOption {
  value: string;
  label: string;
}

/** 字段描述：只读态渲染 + 表单管理页展示用，不参与录入校验。 */
export interface FormFieldSchema {
  key: string;
  label: string;
  /** 决定只读态用哪个渲染器。缺省 'text'。 */
  type?: FormFieldType;
  /** select/multi 的候选。 */
  options?: FormFieldOption[];
  /** 数字字段的展示单位，如 '元' / '%'。 */
  unit?: string;
  /** 多选字段是否在只读态折叠（默认展示前 3 个 + 「等 N 项」）。 */
  collapseInReadonly?: boolean;
}

/**
 * 业务表单组件契约。
 *
 * ⚠️ `readOnly` 是**受控 prop**（方案 §2.5 拍板），且只读态下套壳**根本不实例化**本组件
 * ——套壳走`fields/*` 渲染器。理由：业务组件的 `useEffect` 会执行（可能发请求），
 * 且 `disabled` 的灰底浅字对比度约 3:1，审批人看不清。
 */
export interface FormProps {
  /** 本表单的 code。与后端 `form_definition.code` 精确一致。 */
  formCode: string;
  /** 当前数据。 */
  value: FormData;
  /** 只读态开关（受控）。录入态恒false。 */
  readOnly: boolean;
  /** 字段 schema，供管理页展示与一致性检查。 */
  fields: FormFieldSchema[];
  /** 流程实例 ID（只读态用；录入态 undefined）。 */
  instanceId?: string;
  /** 业务对象 ID（只读态用）。 */
  businessId?: string;
  /** 录入态的值变更回调。只读态下组件**不得**调用。 */
  onChange?: (next: FormData) => void;
}

export type FormComponent = ComponentType<FormProps>;

/** 注册表条目：组件 + 自描述元信息。 */
export interface FormRegistryEntry {
  formCode: string;
  name: string;
  component: FormComponent;
  /** 字段 schema 也登记在组件上，供管理页与「后台定义 vs 前端注册」一致性检查用。 */
  fields: FormFieldSchema[];
  /** 该表单依赖的前端特性包标识，用于排查「后台有、前端没有」。 */
  bundle?: string;
}
