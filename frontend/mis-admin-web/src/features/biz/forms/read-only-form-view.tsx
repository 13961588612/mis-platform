/**
 * **只读态渲染宿主**（方案 §3.5 + §3.3）。
 *
 * ## 为什么单独一个组件，而不是塞进 `form-shell.tsx`
 *
 * 因为「只读态不实例化业务组件」这条硬要求需要一个**可独立测试的落点**：
 * 本组件的 props 里**只有 formCode + 原始 form_data 串**，
 * **没有 component、没有 FormProps**，所以它在类型层面就无法渲染业务组件。
 *
 * 也就是说：不是「渲染了再传 readOnly=true 让组件自己克制」，
 * 而是「只读路径压根不认识业务组件长什么样」。
 * 后者依赖每个业务组件作者都写对 `if (readOnly) return;`，
 * 而业务组件是人工代码 —— 一定会有人忘。
 *
 * ## 四级降级（§3.3 从上到下依次判定）
 *
 * | 顺序 | 条件 | 渲染 |
 * |---|---|---|
 * | ① | `startedFormCode` 为空/null/'' | `FormMissing(no-code)` |
 * | ② | `resolveForm(code)` 返回 null | `FormMissing(not-registered)` |
 * | ③ | `form_data` 为 null/空串 | `FormMissing(empty-data)` |
 * | ④ | `form_data` 是非空但非法的 JSON 串 | `FormMissing(bad-json)` + `<pre>` 原文 |
 * | — | 全部通过 | `ReadOnlyForm`（schema 未声明的键由 §3.3 降级 ④ 处理） |
 *
 * ⚠️ **顺序与方案 §3.4 组合表一致**，其中两条容易搞反：
 *
 * 1. `no-code` 必须**最先**判：`startedFormCode` 为空时 form_data 往往也是空，
 *    此时报「未记录表单编码」才对；反序会误导成「表单没有数据」。
 * 2. `not-registered`（配置缺）**优先于** `bad-json`/`empty-data`（数据问题）：
 *    前端没注册时，数据的对错是次要问题，且原文照样展示在卡里可查。
 *
 * ⚠️ `empty-data` 与 `bad-json` 必须分开（用 `isNoData` 而非 `!parsed.ok` 判断）：
 * 混为一谈会让「数据被人工改库写坏」这种**真数据故障**显示成「没提交数据」，
 * 排查方向完全跑偏。
 */
import { ReadOnlyForm } from './fields';
import { FormMissing } from './form-missing';
import { isEmptyFormData, isNoData, parseFormData } from './parse-form-data';
import { resolveForm } from './registry';
import type { FormFieldSchema } from './types';

export interface ReadOnlyFormViewProps {
  /** 流程实例记录的 startedFormCode。 */
  formCode: string | null | undefined;
  /** 后端 form_data 原始串（`ProcessDetailVO.formData` 是 String 不是 JsonNode）。 */
  formData: string | null | undefined;
  /**
   * 覆盖 schema。
   *
   * 优先于注册表里的 `entry.fields`——用于审批页按流程定义版本指定字段集的场景。
   */
  fields?: FormFieldSchema[];
  /** 提供则显示「重新加载」。 */
  onRetry?: () => void;
  /** fields 与 value 都为空时的空态文案。 */
  emptyText?: string;
}

export function ReadOnlyFormView({ formCode, formData, fields, onRetry, emptyText }: ReadOnlyFormViewProps) {
  // ① 未记录表单编码：中性灰底，不算异常（历史数据 / 流程未启用业务表单）
  if (!formCode) {
    return <FormMissing reason="no-code" rawData={formData} onRetry={onRetry} />;
  }

  const entry = resolveForm(formCode);

  // ② 前端未注册：黄色告警卡（配置缺，不是数据错），且提供重试。
  // ⚠️ 优先级高于 bad-json：先说「没注册」，再说数据问题——
  //    没注册时数据再坏也是次要问题，且原文照样展示在卡里可查。
  if (!entry) {
    return <FormMissing reason="not-registered" formCode={formCode} rawData={formData} onRetry={onRetry} />;
  }

  // ③ 压根没有数据（null / 空串）：不是解析失败
  if (isNoData(formData)) {
    return <FormMissing reason="empty-data" formCode={formCode} onRetry={onRetry} />;
  }

  const parsed = parseFormData(formData);

  // ④ 非法 JSON：展示原文，不抛
  if (!parsed.ok) {
    return <FormMissing reason="bad-json" formCode={formCode} rawData={parsed.raw} onRetry={onRetry} />;
  }

  // 已登记但提交的是空对象：`{}` 本身没信息量，但原始串仍可能有排查价值，
  // 所以透给「查看原始数据」。
  if (isEmptyFormData(parsed.data)) {
    return <FormMissing reason="empty-data" formCode={formCode} rawData={formData ?? null} onRetry={onRetry} />;
  }

  // 只读视图：只有 schema + 数据，业务组件到此为止
  return <ReadOnlyForm fields={fields ?? entry.fields} value={parsed.data} emptyText={emptyText} />;
}
