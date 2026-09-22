/**
 * propertyEditUtils.ts — 右栏属性面板**编辑逻辑的纯函数层**（v1.11 MR-09 / MR-13；T04b）。
 *
 * <h2>为什么单独成纯函数层（沿用 `cubeUtils` / `relationUtils` 的做法）</h2>
 * 这几处规则的失效方式都是**静默**的：
 * <ul>
 *   <li>{@link buildNodeEditPayload}：少带 `base_revision`/`idempotency_key` → 乐观并发与幂等静默失效
 *       （「保存成功却拿到首次结果」或「永远 40900」）；</li>
 *   <li>{@link describeNodeEditError}/{@link describeMaskSaveError}：只读 `message` 会丢掉
 *       `data` 里的 `current_edit_revision` / `field`（用户看到「失败」却不知怎么办）；</li>
 *   <li>{@link buildMaskRulePayload}：脱敏规则的 `match_type`/`pattern` 口径与增强页不一致
 *       → 「同源同优先级」的规则链（§7.5）静默偏离。</li>
 * </ul>
 * 本文件**零运行时依赖**（只 `import type`），可在 node 环境直接单测。
 *
 * <h2>⚠️ 两条写路径的边界（务必区分，勿合并）</h2>
 * <ul>
 *   <li><b>业务描述（MR-09）</b> → 严格走<b>既有</b> `PUT /iqd/catalog/node`
 *       （乐观并发 `base_revision` + 幂等 `idempotency_key`）。这是团队里钉死的唯一写路径，
 *       **不新增写路径**；</li>
 *   <li><b>字段脱敏（MR-13）</b> → 按架构裁决 **A-01**「复用既有 mask-rule API（增强页已用），
 *       PropertyPanel 直调同一端点；不新增建模台专属端口」→ 走 `POST /iqd/mask/rules`
 *       （{@link MASK_SAVE_PERMISSION} = `iqd:mask:save`）。
 *       规则源 `iqd_mask_rule` 是全平台唯一脱敏规则源（§7.5），故与增强页脱敏 Tab **同源同优先级**。</li>
 * </ul>
 * <p>注：`iqd_catalog_item.sensitive_level` / `mask_rule` 两个**列字段**在现有后端<b>无</b>可达的
 * 单节点写路径（`PUT /catalog/node` 只处理 display_name/description/expression；`POST /catalog/batch`
 * 是 MDL 镜像语义、不 bump `edit_revision`）→ 故本面板对这两个字段**只读展示**，
 * 由「脱敏规则」承担可编辑入口（见 `TODO(mr13-column-mask-write)`）。
 */
import type { IqdEditNodePayload, IqdMaskRuleSavePayload } from '@/lib/api/iqd';

/** 说明（MR-09）写路径权限码：`PUT /iqd/catalog/node`（V81:41/62 绑定 → 菜单 92526）。 */
export const NODE_EDIT_PERMISSION = 'iqd:catalog:edit';

/** 脱敏（MR-13）保存权限码：`POST /iqd/mask/rules`（V73:74/106 绑定 → 菜单 92516）。 */
export const MASK_SAVE_PERMISSION = 'iqd:mask:save';

/** 描述草稿（UI 态；`type` 而非 `interface` —— `useDirtyState` 约束需隐式索引签名）。 */
export type FieldDraftValues = {
  description: string;
};

/** 敏感等级选项（对齐 `iqd_catalog_item.sensitive_level` 取值）。 */
export const SENSITIVE_LEVEL_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'none', label: '无' },
  { value: 'low', label: '低' },
  { value: 'high', label: '高' },
];

/**
 * 脱敏规则类型选项（`iqd_mask_rule.rule`）。
 *
 * <p><b>五类内置 + custom</b>，**逐字镜像**增强页 `iqd-enhance-page.tsx` 的 `RULE_LABEL`
 * 与后端内置规则集（`phone/idcard/email/amount/full` + `custom`）——「同源」在此以常量镜像体现
 * （不 import 增强页模块，避免把整页依赖树拉进建模台 chunk）；如需收紧为单一来源，
 * 应把该常量下沉到共享模块（T04c 之后的收敛项）。
 */
export const MASK_RULE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'phone', label: '手机号' },
  { value: 'idcard', label: '身份证' },
  { value: 'email', label: '邮箱' },
  { value: 'amount', label: '金额' },
  { value: 'full', label: '全遮蔽' },
  { value: 'custom', label: '自定义' },
];

/** 脱敏匹配方式：字段级直编固定按**列名**匹配（与增强页默认一致）。 */
export const FIELD_MATCH_TYPE = 'column_name';

/**
 * 由字段当前 `mask_rule` 推导表单初值。
 *
 * <p>只有当现有值**命中已支持的规则类型**时才回填；否则回退 `full`（全遮蔽）——
 * 绝不把未知字符串塞进下拉（会造成「显示为空、保存却带旧值」的静默错配）。
 */
export function initialMaskRule(maskRule: string | null | undefined): string {
  const value = (maskRule ?? '').trim();
  return MASK_RULE_OPTIONS.some((option) => option.value === value) ? value : 'full';
}

/** 规则类型 → 中文标签（未知值原样返回）。 */
export function maskRuleLabel(rule: string): string {
  return MASK_RULE_OPTIONS.find((option) => option.value === rule)?.label ?? rule;
}

/** 取 item_key 末段（`a.b.c` → `c`；`mdl:x:y` → `y`）。 */
export function keyTail(itemKey: string | null | undefined): string {
  const key = (itemKey ?? '').trim();
  if (key === '') {
    return '';
  }
  const colon = key.lastIndexOf(':');
  const dot = key.lastIndexOf('.');
  if (dot > colon) {
    return key.slice(dot + 1);
  }
  if (colon >= 0 && colon < key.length - 1) {
    return key.slice(colon + 1);
  }
  return key;
}

/** 字段显示名（`display_name` 优先，回退 item_key 末段）。 */
export function fieldNameOf(field: {
  item_key: string;
  display_name?: string | null;
}): string {
  return (field.display_name ?? '').trim() || keyTail(field.item_key);
}

/**
 * 构造描述直编载荷（**严格**对应 `PUT /iqd/catalog/node`）。
 *
 * <p>只带 `description`（MR-09 仅业务描述）；`base_revision` 恒带（乐观并发），
 * `idempotency_key` 恒带（幂等）。空描述归一为 `null`（清空语义，与 catalog 页一致）。
 *
 * @param field          被编辑字段（`item_key` / `kind`）
 * @param description    草稿描述（空/空白 → `null`）
 * @param baseRevision   连接当前编辑版本（`sync-status.current_edit_revision`；未知时传 0 —— 与
 *                       既有 catalog 页同口径：版本 ≥1 时会 40900，由「重读版本」纠正）
 * @param idempotencyKey 幂等键（`useDirtyState` 提供；**提交成功后必须 rotate**）
 */
export function buildNodeEditPayload(
  field: { item_key: string; kind: string },
  description: string,
  baseRevision: number,
  idempotencyKey: string,
): IqdEditNodePayload {
  const text = description.trim();
  return {
    item_key: field.item_key,
    kind: field.kind,
    patch: {
      description: text === '' ? null : text,
    },
    base_revision: baseRevision,
    idempotency_key: idempotencyKey,
  };
}

/**
 * 构造脱敏规则载荷（`POST /iqd/mask/rules`，A-01）。
 *
 * <p>规则名 **恒等于列名**（`pattern`）—— 使「同一列反复编辑」落到同一条规则（后端按 `name`
 * 幂等 upsert），避免每次保存都新建一条重复规则。`custom` 才带替换值。
 *
 * @param columnName 列名（`fieldNameOf(field)`）
 * @param rule       规则类型（{@link MASK_RULE_OPTIONS} 取值）
 * @param replacement 自定义替换值（仅 `rule === 'custom'` 时生效）
 */
export function buildMaskRulePayload(
  columnName: string,
  rule: string,
  replacement: string,
): IqdMaskRuleSavePayload {
  const name = columnName.trim();
  const replacementText = replacement.trim();
  return {
    name,
    match_type: FIELD_MATCH_TYPE,
    pattern: name,
    rule,
    replacement: rule === 'custom' && replacementText !== '' ? replacementText : null,
    priority: 0,
    enabled: true,
  };
}

/** 业务码 → 人话（逐个读 `data` 明细；纯函数便于单测）。 */
export function describeNodeEditError(
  code: number | null,
  data: Record<string, unknown> | null,
  message: string,
): string {
  if (code === 40900) {
    const current = data?.current_edit_revision;
    return `[40900] 版本已变更（当前 ${String(current ?? '?')}），已为你刷新版本，请重试`;
  }
  if (code === 40901) {
    return '[40901] 该提交已被处理（幂等键重复），已为你换新提交号，可直接重试';
  }
  if (code === 42200) {
    const field = typeof data?.field === 'string' ? data.field : null;
    const modelKey = typeof data?.model_item_key === 'string' ? data.model_item_key : null;
    const detail = [field, modelKey].filter(Boolean).join(' / ');
    return `[42200] 参数校验未通过${detail ? `（${detail}）` : ''}：${message}`;
  }
  if (code === 40300) {
    return '[40300] 该连接未开启 MDL 写回（mdl_writeback_enabled=false），请联系管理员';
  }
  if (code === 50300) {
    return '[50300] 该编辑接口尚在建设中';
  }
  return code != null ? `[${code}] ${message}` : message;
}

/** 脱敏规则保存失败 → 人话（A-01 走 mask-rule API；错误码口径与 BFF 透传一致）。 */
export function describeMaskSaveError(
  code: number | null,
  data: Record<string, unknown> | null,
  message: string,
): string {
  if (code === 40900) {
    const current = data?.current_edit_revision;
    return `[40900] 版本已变更（当前 ${String(current ?? '?')}），请刷新后重试`;
  }
  if (code === 40901) {
    return '[40901] 该提交已被处理（幂等键重复），请稍后重试';
  }
  if (code === 42200) {
    const field = typeof data?.field === 'string' ? data.field : null;
    return `[42200] 参数校验未通过${field ? `（${field}）` : ''}：${message}`;
  }
  if (code === 40300) {
    return '[40300] 无脱敏保存权限或连接不可写，请联系管理员';
  }
  if (code === 50300) {
    return '[50300] 脱敏规则接口尚在建设中';
  }
  return code != null ? `[${code}] ${message}` : message;
}
