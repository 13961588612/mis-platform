/**
 * connectionEditUtils.ts — 连接「编辑 / 停用 / 启用」的**纯函数层**（T07）。
 *
 * <h2>为什么单独成纯函数层（沿用 `cubeUtils` / `relationUtils` / `propertyEditUtils` 的做法）</h2>
 * 本文件承载的几条规则，失效方式**全部是静默的**：
 * <ol>
 *   <li><b>{@link buildUpdateRequest} 的"只传改过的字段"</b>：多传一个字段 = 用"当前值"覆盖
 *       "当前值"，看似无害；但对 `secret_ref` / `auth_type` 这类字段，前后端默认值口径不同
 *       （后端 **create** DTO 带 `authType="none"`/`timeoutSeconds=60`/`language="zh-CN"`/`enabled=true`，
 *       而 **update** DTO 字段全 null 默认）⇒ 照抄 create 全量体就会"改个名顺便重置超时/认证方式"，
 *       **不报错**。</li>
 *   <li><b>{@link buildUpdateRequest} 的"`secret_ref` 留空 = 保留原值"</b>：把空串 /
 *       `******` 占位符当成"新值"提交 ⇒ 要么把凭证**清成空**，要么把占位符**写进 **secret_ref**
 *       （下一次 GET 回 `******` 掩盖故障）。静默且不可逆。</li>
 *   <li><b>{@link describeConnectionConfirm} 的「启用」文案</b>：见下方**文案铁律**。</li>
 *   <li><b>{@link describeConnectionUpdateError} 的 `data` 读取</b>：只读 `message` 会丢掉
 *       `data.name`（40900 冲突名）⇒ 用户看到"失败"却不知改哪个名。</li>
 * </ol>
 * 本文件**零运行时依赖**（只 `import type`）⇒ 可在 node 环境直接单测（勿在此 import React / UI）。
 *
 * <h2>🔴 文案铁律（T07 最关键的一条，用单测钉死在 {@link describeConnectionConfirm}）</h2>
 * 「启用」的确认文案**必须**是「纳入问数、**不影响其它连接**」。
 * <b>绝对不要</b>写「将自动停用其它连接」—— 用户已拍板**放开多条 `enabled=true` 并存**
 * （system-design §14.5，2026-09-22 修订：原「一期仅一条启用」约定**已作废**，
 * `architecture.md:882` 已订正）。后端 `updateConnection` **只写目标行、无跨行联动、无悲观锁**
 * （§14.4/§14.5）；前端若还写"将自动停用其它"，就是在**编造一个不存在的副作用**，
 * 会让用户不敢启用第二条连接。
 */

import type {
  Connection,
  CreateConnectionRequest,
  UpdateConnectionRequest,
} from '../../types/modeling';

// ================================================================ 常量

/** 默认 connector（与后端 create DTO 的 `postgres` 口径一致）。 */
export const DEFAULT_CONNECTOR = 'postgres';

/** 默认超时（秒，与后端 create DTO 的 `timeoutSeconds=60` 口径一致）。 */
export const DEFAULT_TIMEOUT_SECONDS = 60;

/** 默认语言（与后端 create DTO 的 `language="zh-CN"` 口径一致）。 */
export const DEFAULT_LANGUAGE = 'zh-CN';

/**
 * 凭证占位符（后端 `isSecretPlaceholder()` 的判定值）。
 *
 * <p>后端 GET 恒回 `******`（凭证永不回显明文）。若把这个占位符当"新值"回传，
 * 会把字面量 `******` 写进 `secret_ref` —— 前端本就不该把它渲染进输入框（见
 * {@link connectionToDraft} 恒留空），此常量用于**双保险**：万一别处传进来也一并忽略。
 */
export const SECRET_PLACEHOLDER = '******';

/** connector 下拉候选（WrenAI 常用方言；具体可用集以 WrenAI 版本为准）。 */
export const CONNECTOR_OPTIONS: ReadonlyArray<string> = [
  'postgres',
  'mysql',
  'clickhouse',
  'duckdb',
  'trino',
  'mssql',
];

/** 认证方式下拉候选（`iqd_connection.auth_type`）。 */
export const AUTH_TYPE_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'none', label: 'none（profile 注入）' },
  { value: 'basic', label: 'basic' },
  { value: 'token', label: 'token' },
];

/** 连接表单**模式**（`create` = 新建向导；`edit` = 就地编辑既有连接，T07）。 */
export type ConnectionFormMode = 'create' | 'edit';

// ================================================================ 表单草稿

/** 连接表单草稿（本地态：只在向导/编辑弹窗打开期间存活，关闭即弃）。 */
export interface ConnectionDraft {
  name: string;
  baseUrl: string;
  defaultConnector: string;
  timeoutSeconds: number;
  language: string;
  authType: string;
  secretRef: string;
  projectId: string;
}

/** 空草稿（新建向导的初值；与实际后端 create DTO 默认值同源）。 */
export const EMPTY_DRAFT: ConnectionDraft = {
  name: '',
  baseUrl: '',
  defaultConnector: DEFAULT_CONNECTOR,
  timeoutSeconds: DEFAULT_TIMEOUT_SECONDS,
  language: DEFAULT_LANGUAGE,
  authType: 'none',
  secretRef: '',
  projectId: '',
};

/**
 * 由既有连接生成编辑草稿（**编辑模式的预填**）。
 *
 * <p><b>`secretRef` 恒为空串</b>：凭证不回显（GET 恒 `******`），且"留空 = 保留原值"是
 * 本组件既有文案与后端 §14.1 的统一语义。若把 `******` 预填进 password 框，用户点保存
 * 就会把占位符当新凭证提交（后端会忽略占位符，但输入框显示 `******` 会让用户误以为
 * 凭证是可见/可编辑的明文）。
 *
 * <p>其余字段用连接现值预填，使「未改动」在 UI 上**可见**（否则用户不知自己在改什么），
 * 并让 {@link buildUpdateRequest} 的"值相等 ⇒ 不提交"判定有基线。
 */
export function connectionToDraft(connection: Connection): ConnectionDraft {
  return {
    name: connection.name ?? '',
    baseUrl: connection.base_url ?? '',
    defaultConnector: connection.default_connector ?? DEFAULT_CONNECTOR,
    timeoutSeconds: connection.timeout_seconds ?? DEFAULT_TIMEOUT_SECONDS,
    language: connection.language ?? DEFAULT_LANGUAGE,
    authType: connection.auth_type ?? 'none',
    secretRef: '',
    projectId: connection.project_id ?? '',
  };
}

/**
 * 构造 connector 下拉项：内置候选 + （值未知时）**追加**一个「（现有）」动态项。
 *
 * <p>为什么：`default_connector` 是**自由文本列**，历史/手工数据可能不在候选集里。
 * 若直接喂给受控 Select，未知值既无法显示、也无法原样保留（用户会看到空占位符，
 * 以为"没设置"）。与 `propertyEditUtils.buildMaskRuleOptions` 同一做法。
 */
export function buildConnectorOptions(current: string): ReadonlyArray<string> {
  const value = current.trim();
  if (value === '' || CONNECTOR_OPTIONS.includes(value)) {
    return CONNECTOR_OPTIONS;
  }
  return [...CONNECTOR_OPTIONS, value];
}

/** 超时归一：非正 / 非有限 → 默认 60（后端对 `<= 0` 回 `42200`）。 */
export function normalizeTimeout(value: number): number {
  const seconds = Math.trunc(Number(value));
  return Number.isFinite(seconds) && seconds > 0 ? seconds : DEFAULT_TIMEOUT_SECONDS;
}

// ================================================================ 载荷组装

/**
 * 构造**新建**连接载荷（`POST /api/v1/iqd/connections`）——**逐字保持既有行为**。
 *
 * <p>与旧版 `ensureCreated` 内联对象完全同形（`trim() || null` 的空值归一 + `enabled: true`），
 * 抽出来只为让 create / update 两条载荷路径并列可测，**不改语义**。
 */
export function buildCreateRequest(draft: ConnectionDraft): CreateConnectionRequest {
  return {
    name: draft.name.trim(),
    base_url: draft.baseUrl.trim() || null,
    default_connector: draft.defaultConnector,
    timeout_seconds: normalizeTimeout(draft.timeoutSeconds),
    language: draft.language,
    auth_type: draft.authType,
    secret_ref: draft.secretRef.trim() || null,
    project_id: draft.projectId.trim() || null,
    enabled: true,
  };
}

/** 可"留空 = 保留原值"的文本字段（`name` 单独处理；`secret_ref` 单独处理）。 */
type PreservingTextField = 'base_url' | 'project_id' | 'default_connector' | 'language' | 'auth_type';

/** 文本字段比较 + 赋值：留空或与原名同值 → **不提交**（§14.1「缺省/null = 保留原值」）。 */
function assignText(
  payload: UpdateConnectionRequest,
  key: PreservingTextField,
  draftValue: string,
  originalValue: string | null,
): void {
  const next = draftValue.trim();
  // 留空 = 保留原值（§14.1 不提供"清空字段"；本组件既有文案「留空 = 保留原值」）
  if (next === '') {
    return;
  }
  if (next === (originalValue ?? '').trim()) {
    return;
  }
  payload[key] = next;
}

/**
 * 构造**局部更新**载荷（`PUT /api/v1/iqd/connections/{id}`，T07）。
 *
 * <h2>只提交"确实被修改"的字段</h2>
 * 后端 `IqdConnectionUpdateRequest` 字段全 null 默认、按 `containsKey` 填充 ⇒ 未提交字段
 * 保留原值。故本函数对每个字段做「归一 → 与原值比较 → 不同才带上」，**绝不照抄全量体**
 * （照抄会因 update/create DTO 默认值口径不同而静默重置字段）。
 *
 * <h2>`secret_ref` 的铁律（报告项 ①）</h2>
 * <b>留空 ⇒ 完全不传该字段</b>（既不传 `''`、也不传 `null`、更不传 `******`）。
 * 依据：§14.1 表格「`secret_ref` | 保留原值 | 覆盖 | **与 create 逐字一致**：
 * `== null` 或 `isSecretPlaceholder()` 或空白 → 不改」。虽然后端对空串也宽容，但：
 * <ol>
 *   <li>本任务的铁律是"**前端不要传未修改的字段**"—— 留空即"未修改"，传空串是在把
 *       "未修改"表达成"提交了一个空值"；</li>
 *   <li>省略字段不依赖后端对空串的宽容分支（更少的隐式契约 = 更少漂移面）；
 *       若后端将来收紧为"空串 = 清空"，省略写法仍然正确；</li>
 *   <li>与 `name` / `base_url` 的处理**保持同一套规则**（留空 = 未修改 = 省略），避免
 *       "有的字段留空保留、有的字段留空清空"这种记不住的不一致。</li>
 * </ol>
 * 非空非占位符 ⇒ 提交（用户确实要换凭证）。
 *
 * <h2>`enabled` 不在此函数内</h2>
 * 启停是独立操作（{@link buildEnabledUpdate}），避免"改个名顺手切换了启用态"。
 *
 * @param draft    编辑表单草稿
 * @param original 被编辑连接的**服务端快照**（作为"是否改动"的比较基线）
 * @returns 仅含改动字段的局部更新体；**空对象 = 无改动**（调用方应提示"没有改动"且不发请求）
 */
export function buildUpdateRequest(
  draft: ConnectionDraft,
  original: Connection,
): UpdateConnectionRequest {
  const payload: UpdateConnectionRequest = {};

  // ---- name：改名（trim 后非空、且与原名不同才提交；空名不发 —— 由 UI 拦截为"必填"）
  const name = draft.name.trim();
  if (name !== '' && name !== (original.name ?? '').trim()) {
    payload.name = name;
  }

  // ---- 其余文本字段：留空 / 同值 ⇒ 省略
  assignText(payload, 'base_url', draft.baseUrl, original.base_url ?? null);
  assignText(payload, 'project_id', draft.projectId, original.project_id ?? null);
  assignText(payload, 'default_connector', draft.defaultConnector, original.default_connector ?? null);
  assignText(payload, 'language', draft.language, original.language ?? null);
  // auth_type：后端「空串视为缺省」（§14.1）⇒ 与"留空 = 保留原值"同义，走同一分支
  assignText(payload, 'auth_type', draft.authType, original.auth_type ?? null);

  // ---- secret_ref：留空 / 占位符 ⇒ **完全不传该字段**（见上方铁律）
  const secret = draft.secretRef.trim();
  if (secret !== '' && secret !== SECRET_PLACEHOLDER) {
    payload.secret_ref = secret;
  }

  // ---- timeout_seconds：正整数且与原值不同才提交（<= 0 会被后端拒 42200）
  const timeout = normalizeTimeout(draft.timeoutSeconds);
  if (timeout !== normalizeTimeout(original.timeout_seconds ?? DEFAULT_TIMEOUT_SECONDS)) {
    payload.timeout_seconds = timeout;
  }

  return payload;
}

/**
 * 构造**启停**载荷（`enabled` 开关，T07）。
 *
 * <p>只带 `enabled` 一个键：<b>只改本行，不联动其它连接</b>（§14.5，2026-09-22 修订 ——
 * 原「启用 A 自动停用其它」约定**已作废**，可多条 `enabled=true` 并存）。
 */
export function buildEnabledUpdate(enabled: boolean): UpdateConnectionRequest {
  return { enabled };
}

// ================================================================ 错误 → 人话

/**
 * 更新连接失败 → 可诊断文案（**读 `data` 不读 `message`**）。
 *
 * <p>后端业务错误走 **HTTP 200 + `body.code`**，BFF 保留 `code` 与 `data` 原样透传
 * （见 `api/iqd-modeling.ts` 模块头）。只读 `message` 会把 40900 的冲突名、42200 的
 * "连接不存在"降级成通用故障词。
 */
export function describeConnectionUpdateError(
  code: number | null,
  data: Record<string, unknown> | null,
  message: string,
): string {
  if (code === 40900) {
    const name = typeof data?.name === 'string' ? data.name : null;
    return `[40900] 连接名称已被占用${name ? `（${name}）` : ''}，请换一个名称后重试`;
  }
  if (code === 42200) {
    return `[42200] 提交内容未通过校验（连接不存在 / 超时秒数须为正整数）：${message}`;
  }
  if (code === 40901) {
    return '[40901] 该提交已被处理（幂等键重复），请重试';
  }
  if (code === 40300) {
    return '[40300] 无「编辑连接」权限（iqd:modeling:edit），或该路径未登记，请联系管理员';
  }
  if (code === 50300) {
    return '[50300] 该连接更新接口尚在建设中';
  }
  return code != null ? `[${code}] ${message}` : message;
}

// ================================================================ 二次确认

/** MCP 操作的中文名（按钮 / 确认文案复用）。 */
export const MCP_ACTION_LABEL: Record<'start' | 'stop' | 'restart', string> = {
  start: '启动',
  stop: '停止',
  restart: '重启',
};

/**
 * 待确认的操作（判别联合，一个 Dialog 承载三类确认）。
 *
 * <p>三类都是**影响面操作**，都要二次确认（T07 铁律）：
 * <ul>
 *   <li>`mcp` —— MCP 启 / 停 / 重启（权限码 `iqd:mcp:manage`）；</li>
 *   <li>`toggle` —— 连接**停用 / 启用**（权限码 `iqd:modeling:edit`）；</li>
 *   <li>`edit` —— 保存连接**编辑**（权限码 `iqd:modeling:edit`）；</li>
 * </ul>
 */
export type PendingConfirm =
  | { kind: 'mcp'; action: 'start' | 'stop' | 'restart'; id: number }
  | { kind: 'toggle'; connection: Connection; nextEnabled: boolean }
  | { kind: 'edit'; connection: Connection };

/** 确认弹窗文案（纯数据，便于单测钉死"文案铁律"）。 */
export interface ConfirmCopy {
  title: string;
  description: string;
  confirmLabel: string;
  /** `true` ⇒ `variant="destructive"`（与 MCP `stop` 同款样式）。 */
  destructive: boolean;
}

/**
 * 二次确认文案（**唯一真值源**；组件只渲染，不改字）。
 *
 * <h2>🔴 「启用」文案铁律</h2>
 * 「启用」⇒ 描述**必须**是「启用后该连接纳入问数，**不影响其它连接**」。
 * <b>不得**出现**「将自动停用其它连接」/「其它连接会被停用」/「同步停用」等任何"连带停用"
 * 表述 —— 该副作用在后端**不存在**（§14.5 已摘除「一期仅一条 `enabled=true`」约定，
 * 放开多条并存；`updateConnection` 只写目标行、无跨行联动、无悲观锁）。多写这一句 =
 * 编造副作用 = 用户不敢启用第二条连接。
 *
 * <p>三类确认**统一 `destructive: true`**（T07：编辑与启停都是破坏性 / 影响面操作，
 * 复用 `WizardShellConfirm` 与 MCP `stop` 同款 destructive 样式）。唯一例外是 MCP `start`
 * （非破坏性 —— 且此为**既有行为**，一字未改）。
 */
export function describeConnectionConfirm(pending: PendingConfirm): ConfirmCopy {
  if (pending.kind === 'mcp') {
    const label = MCP_ACTION_LABEL[pending.action];
    const risky = pending.action !== 'start';
    return {
      title: `确认${label} MCP 进程？`,
      description: risky
        ? `${label}会中断该连接上正在进行的问数/MCP 会话（project 目录默认保留）。`
        : '将拉起本连接的 WrenAI MCP 进程（就绪需数秒）。',
      confirmLabel: `确认${label}`,
      destructive: risky,
    };
  }

  if (pending.kind === 'toggle') {
    if (pending.nextEnabled) {
      return {
        title: '确认启用该连接？',
        description: '启用后该连接纳入问数，不影响其它连接。',
        confirmLabel: '确认启用',
        destructive: true,
      };
    }
    return {
      title: '确认停用该连接？',
      description:
        '停用后该连接不再纳入问数（不中断已有 MCP 进程与会话）；只影响本连接，不改变其它连接。',
      confirmLabel: '确认停用',
      destructive: true,
    };
  }

  return {
    title: '确认保存对该连接的修改？',
    description: `将按 id 更新「${pending.connection.name}」的连接配置（凭证留空则保留原值），只影响本连接。`,
    confirmLabel: '确认保存',
    destructive: true,
  };
}
