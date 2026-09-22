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
 *   <li>{@link buildMaskNodeEditPayload}：patch 键/清除语义错 → 脱敏无法撤销（`mask_rule=''`
 *       必须写 `null`）或误写 `sensitive_level`；</li>
 * </ul>
 * 本文件**零运行时依赖**（只 `import type`），可在 node 环境直接单测。
 *
 * <h2>⚠️ 两条写路径的边界（T04b-补 后已统一到一个端点）</h2>
 * <ul>
 *   <li><b>业务描述（MR-09）</b> → <b>既有</b> `PUT /iqd/catalog/node`；</li>
 *   <li><b>字段脱敏（MR-13）</b> → **同样**走 `PUT /iqd/catalog/node`（T04b-补 已把该端点的 patch
 *      扩展到接受 {@code sensitive_level} / {@code mask_rule}），携带乐观并发 + 幂等 + bump
 *       {@code edit_revision}。二者同一端点、同一权限码 {@link NODE_EDIT_PERMISSION}。</li>
 * </ul>
 * <p>为什么不再走 mask-rule API：字段级显式规则（{@code iqd_catalog_item.mask_rule} /
 * {@code sensitive_level}）在 masking.py §7.5 规则链里是**优先级 1/2**
 * （`iqd_mask_rule` 注册表是优先级 3）。脱敏直编必须写优先级最高的字段级列，才符合设计。
 *
 * <h2>🟡 masking.py 解析语义提醒（写路径已修，但仍需注册数据配合）</h2>
 * <p>masking.py `_resolve_rule` 对字段级 {@code mask_rule} 的解析是**按规则名匹配注册表**
 * （`r.name == mask_rule`）；**未命中则 fail-closed 退化为 {@code full}`**（不静默放行明文）。
 * 因此把内置关键字（`phone` 等）写入 `mask_rule` 时：若 `iqd_mask_rule` 里**没有同名规则**，
 * 实际会**整列全遮蔽**（而非按手机号规则）。`sensitive_level=high`（优先级 2）则**不依赖注册表**
 * （按 data_type/列名兜底），完全可用。故下拉保留了去重后的内置算法项 + custom；是否需要把
 * 内置算法**登记进 `iqd_mask_rule`**（数据/迁移）由后续任务决定（见 T04b-补 报告）。
 */
import type { IqdEditNodePayload } from '@/lib/api/iqd';

/** 说明（MR-09）写路径权限码：`PUT /iqd/catalog/node`（V81:41/62 绑定 → 菜单 92526）。 */
export const NODE_EDIT_PERMISSION = 'iqd:catalog:edit';

/**
 * 脱敏（MR-13）**附加**权限码：`POST /iqd/mask/rules`（V73:74/106 绑定 → 菜单 92516）。
 *
 * <p>T04b-补 后脱敏直编走 `PUT /catalog/node`（其真码是 {@link NODE_EDIT_PERMISSION}）。
 * 本码作为**额外的前端闸门**保留：脱敏是敏感操作，PRD MR-13 明示「无 `iqd:mask:save` 权限时只读」。
 * 故前端以 `catalog:edit ∧ mask:save` 双码放行（前端严格度 ≥ 后端，不会出现「前端放行、后端 40300」）。
 */
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

/** 脱敏字段「清除」哨兵值：选中它 → `mask_rule` 写 `null`（清空字段级显式规则）。 */
export const MASK_RULE_CLEAR_VALUE = '';

/** 字段级脱敏 `mask_rule` 下拉项：清除 + 五类内置 + custom。 */
export const MASK_RULE_FIELD_OPTIONS: Array<{ value: string; label: string }> = [
  { value: MASK_RULE_CLEAR_VALUE, label: '（无 / 清除字段级规则）' },
  ...MASK_RULE_OPTIONS,
];

/**
 * 由字段当前 `mask_rule` 推导表单初值（trim 后的原值；`''` = 清除项）。
 *
 * <p><b>不回退到某个默认算法</b>：写路径是「sensitive_level + mask_rule 一起提交」，若把未知的
 * 历史值悄悄替换成 `full`，用户仅想改等级却会**静默改写**字段级规则。故未知值原样保留，
 * 由 {@link buildMaskRuleOptions} 为其补一个「现有」动态项展示。
 */
export function initialMaskRule(maskRule: string | null | undefined): string {
  return (maskRule ?? '').trim();
}

/**
 * 构造下拉项：清除项 + 五类内置 + custom；若当前值未知（历史/手工数据）则**追加**
 * 一个 `xxx（现有）` 动态项，保证既有值可显示、可原样保留（不静默改写）。
 */
export function buildMaskRuleOptions(current: string): Array<{ value: string; label: string }> {
  const value = current.trim();
  const known =
    value === MASK_RULE_CLEAR_VALUE || MASK_RULE_OPTIONS.some((option) => option.value === value);
  if (known) {
    return MASK_RULE_FIELD_OPTIONS;
  }
  return [...MASK_RULE_FIELD_OPTIONS, { value, label: `${value}（现有）` }];
}

/** 规则类型 → 中文标签（清除项给「无」；未知值原样返回）。 */
export function maskRuleLabel(rule: string): string {
  if (rule === MASK_RULE_CLEAR_VALUE) {
    return '无';
  }
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
 * 构造**脱敏直编**载荷（T04b-补：与描述**同一**端点 `PUT /iqd/catalog/node`）。
 *
 * <p>patch 带 `sensitive_level` + `mask_rule`（后端 T04b-补 已扩展支持）：
 * <ul>
 *   <li>`sensitive_level`：恒为 none/low/high 之一（后端强校验，非法值 42200）；</li>
 *   <li>`mask_rule`：下拉值；清除项（`''`）→ `null`（清空字段级显式规则）；</li>
 *   <li>`base_revision` + `idempotency_key` 恒带（乐观并发 + 幂等），
 *       成功后调用方必须 `rotateIdempotencyKey()`。</li>
 * </ul>
 *
 * <p>与 {@link buildNodeEditPayload} 分开构造（而非合并成一个 patch）：描述与脱敏是两次独立提交，
 * 各自独立乐观并发/幂等，避免「改描述顺手改了脱敏」的隐式副作用。
 *
 * @param field        被编辑字段（`item_key` / `kind`）
 * @param sensitiveLevel none / low / high
 * @param maskRule     脱敏规则值；`''` → 清除（写 null）
 * @param baseRevision 连接当前编辑版本
 * @param idempotencyKey 幂等键（提交成功后必须 rotate）
 */
export function buildMaskNodeEditPayload(
  field: { item_key: string; kind: string },
  sensitiveLevel: string,
  maskRule: string,
  baseRevision: number,
  idempotencyKey: string,
): IqdEditNodePayload {
  const level = sensitiveLevel.trim() === '' ? 'none' : sensitiveLevel.trim().toLowerCase();
  const rule = maskRule.trim();
  return {
    item_key: field.item_key,
    kind: field.kind,
    patch: {
      sensitive_level: level,
      mask_rule: rule === '' ? null : rule,
    },
    base_revision: baseRevision,
    idempotency_key: idempotencyKey,
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

/**
 * 脱敏直编失败 → 人话。
 *
 * <p>T04b-补 后脱敏与描述**同一端点**（`PUT /catalog/node`）、同一错误码，故直接复用
 * {@link describeNodeEditError}，避免两份码分流规则漂移（42200 的非法 `sensitive_level` 也带
 * `data.field`，与描述路径同构）。
 */
export function describeMaskSaveError(
  code: number | null,
  data: Record<string, unknown> | null,
  message: string,
): string {
  return describeNodeEditError(code, data, message);
}
