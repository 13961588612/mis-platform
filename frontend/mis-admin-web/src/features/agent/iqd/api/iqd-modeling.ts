/**
 * iqd-modeling.ts — 建模台 wire 层（连接向导 / 新建节点族），v1.11 MR-S1~S4。
 *
 * <p>端点集中在 BFF `/api/v1/iqd/**`（axios `baseURL = /api/v1`，故此处路径以 `/iqd` 起头），
 * 权限码 `iqd:modeling:*`。**wire 一律 snake_case**；前端内部 camelCase 只出现在类型/局部变量。
 *
 * <h2>错误处理（关键，T02a 实证）</h2>
 * mis-iqd 的业务冲突按二/四期口径返回 **HTTP 200 + {@code body.code}**，BFF 保留
 * `code` **与** `data` 原样透传。故本模块统一用 {@link unwrap} 解包，失败时抛
 * {@link IqdModelingApiError}（带 `code` + `data`）——**调用方必须读 `data`**，
 * 不能只读 `message`：
 * <ul>
 *   <li>`40900` 乐观并发 → `data.current_edit_revision`（提示「版本已变更，点重读」）</li>
 *   <li>`40901` 幂等键并发 → `data.idempotency_key`</li>
 *   <li>`42200` 参数/源表不存在 → `data.dependents`（引用阻断时）</li>
 *   <li>`40300` 写回闸门关闭</li>
 * </ul>
 * `503 + code 50300`（T03/T04 未实现端点）同样会抛 `IqdModelingApiError`，调用方按
 * `code === 50300` 呈现「功能建设中」而非故障。
 *
 * <h2>端点状态（与 T02a 后端实现对齐）</h2>
 * 已可用：`POST/GET /connections`、`POST /connections/{id}/test`、
 * `POST /catalog/model/from-table`、`GET /catalog/validate-expression`。
 * **T03 已落地**：blank model / relationship / cube（create）/ calculated-column /
 * dependencies / layout（原「调过去 503 + 50300」的描述已过时，保留此纠正）。
 * **T04a 新增**：`PUT /catalog/cube`（{@link upsertCube}，既有 Cube 的更新路径）。
 * **T07 新增**：`PUT /connections/{id}`（{@link updateConnection}，按 id 精确更新连接 ——
 * 补齐「多连接下无法"编辑 / 停用"指定连接」的写入缺口；端点契约见 system-design §14.1，
 * 权限码 `iqd:modeling:edit`，迁移 `V92` 登记 sys_api 92800 / sys_menu_api 92801）。
 * **同步状态复用 {@link getIqdCatalogSyncStatus}**（既有 `IqdAclController` 提供），
 * 本模块**不重复定义**。
 */

import api from '@/lib/api/client';
import type { ApiResult } from '@/types/api';
import type {
  Connection,
  ConnectionTestResult,
  CreateCalculatedColumnRequest,
  CreateCalculatedColumnResponse,
  CreateConnectionRequest,
  CreateCubeRequest,
  CreateModelFromTableRequest,
  CreateModelRequest,
  CreateRelationshipRequest,
  DeleteRelationshipResponse,
  IqdDependents,
  IqdModelFromTableResponse,
  IqdModelingCreateResponse,
  UpdateConnectionRequest,
  ValidateExpressionResult,
} from '../types/modeling';

// ================================================================ 错误类型 + 解包

/**
 * 建模台 API 错误：保留下游 `code` 与 `data`（BFF 透传的业务码明细）。
 *
 * <p>与既有 `@/lib/api/iqd` 的 `unwrap`（只抛 message）不同：建模台多处要按 `data` 分支
 * （40900 的当前版本号、42200 的引用方清单），故这里把 `code`/`data` 挂在 Error 上。
 */
export class IqdModelingApiError extends Error {
  readonly code: number;
  readonly data: Record<string, unknown> | null;
  /** 下游「未实现」骨架码（50300）；调用方据此呈现「建设中」而非故障。 */
  readonly notImplemented: boolean;

  constructor(message: string, code: number, data: unknown) {
    super(message);
    this.name = 'IqdModelingApiError';
    this.code = code;
    // data 可能是对象（常规）——只接受对象形态，其余归一为 null
    this.data = data !== null && typeof data === 'object' ? (data as Record<string, unknown>) : null;
    this.notImplemented = code === 50300;
  }
}

/** 解包 `ApiResult`：成功取 `data`；失败抛带 `code`/`data` 的 {@link IqdModelingApiError}。 */
function unwrap<T>(res: { data: ApiResult<T> }, fallback: string): T {
  const body = res.data;
  if (body.code !== 0) {
    throw new IqdModelingApiError(body.message || fallback, body.code, body.data);
  }
  return body.data as T;
}

/** 解包「允许 data=null」的响应（如 sync-status）。 */
function unwrapNullable<T>(res: { data: ApiResult<T> }, fallback: string): T | null {
  const body = res.data;
  if (body.code !== 0) {
    throw new IqdModelingApiError(body.message || fallback, body.code, body.data);
  }
  return body.data ?? null;
}

/** 从任意异常里取「未实现（50300）」标记（供调用方降级呈现）。 */
export function isNotImplementedError(err: unknown): boolean {
  return err instanceof IqdModelingApiError && err.notImplemented;
}

/** 从任意异常里取业务码（非建模台错误返回 null）。 */
export function errorCode(err: unknown): number | null {
  return err instanceof IqdModelingApiError ? err.code : null;
}

/** 从任意异常里取业务明细 `data`（如 40900 的 current_edit_revision）。 */
export function errorData(err: unknown): Record<string, unknown> | null {
  return err instanceof IqdModelingApiError ? err.data : null;
}

// ================================================================ 连接向导（T02a 已可用）

/** 新建连接（追加一条）。`POST /api/v1/iqd/connections`。 */
export async function createConnection(body: CreateConnectionRequest): Promise<Connection> {
  const res = await api.post<ApiResult<Connection>>('/iqd/connections', body);
  return unwrap(res, '新建连接失败');
}

/** 连接清单（多连接 + MCP 运行态）。`GET /api/v1/iqd/connections`。 */
export async function listConnections(): Promise<Connection[]> {
  const res = await api.get<ApiResult<Connection[]>>('/iqd/connections');
  return unwrap(res, '获取连接清单失败') ?? [];
}

/** 连接连通性自检。`POST /api/v1/iqd/connections/{id}/test`。 */
export async function testConnection(connectionId: number): Promise<ConnectionTestResult> {
  const res = await api.post<ApiResult<ConnectionTestResult>>(
    `/iqd/connections/${connectionId}/test`,
  );
  return unwrap(res, '连接自检失败');
}

/**
 * 按 id 精确更新一条既有连接（**局部更新**，T07）。`PUT /api/v1/iqd/connections/{id}`。
 *
 * <p>权限：<b>`iqd:modeling:edit`</b>（mis-iqd `@PreAuthorize("hasAuthority('iqd:modeling:edit')")`
 * 逐条对齐；V92 已把该路径登记为 sys_api 92800 / 绑定菜单 92632）。前端闸门必须用**同一个码**
 * —— 本组件同时存在 `iqd:mcp:manage`（MCP 启停用），**两个码并存、各管各的**，
 * 照抄 MCP 那行的码会错配成「前端放行、后端 40300」。
 *
 * <h2>⚠️ 局部更新 = 只传"改过的字段"（详见 {@link UpdateConnectionRequest}）</h2>
 * 后端 `IqdConnectionUpdateRequest` 字段全 null 默认、按 `containsKey` 填充 ⇒
 * **未提交字段保留原值**。载荷组装一律走 `components/wizard/connectionEditUtils.ts` 的
 * {@link buildUpdateRequest} / {@link buildEnabledUpdate}，**禁止手写请求体**。
 *
 * <h2>错误码（读 `data` 不读 `message`）</h2>
 * <ul>
 *   <li>`40900` 改名撞 `uk_iqd_connection_name` → `data.name`（"先查后报"，无约束异常）</li>
 *   <li>`42200` `id` 为空 / `timeout_seconds <= 0` / **连接不存在**（与 `testConnection` 的
 *       `40400` 不一致是**已知裁决**，§14.1 照实记录）</li>
 *   <li>`40300` 无 `iqd:modeling:edit`（注册表未映射 / mis-iqd 拒）</li>
 *   <li>**不采用 `40901`**（本端点无幂等键，§14.4 裁决 last-write-wins）</li>
 * </ul>
 *
 * <p>成功返回值与 `GET /connections` 的元素**逐字段一致**（服务层复用 `toVO`），
 * 故理论上可直接替换列表项；但改名 / 启停会改变列表可见性与排序 ⇒ 调用方仍**整体失效**
 * `iqdKeys.connections()`（见 `ConnectionWizard`）。
 *
 * @param connectionId 连接 id（来自列表项 `Connection.id`；为空时调用方不应发起请求）
 * @param body         仅含**被修改**字段的局部更新体（`secret_ref` 留空 ⇒ 不传该字段）
 */
export async function updateConnection(
  connectionId: number,
  body: UpdateConnectionRequest,
): Promise<Connection> {
  const res = await api.put<ApiResult<Connection>>(`/iqd/connections/${connectionId}`, body);
  return unwrap(res, '更新连接失败');
}

/**
 * 物理删除问数连接（级联子表）。`DELETE /api/v1/iqd/connections/{id}`。
 *
 * <p>权限：`iqd:modeling:edit`（V100）。调用前应先
 * {@link mcpManage}({@code stop}, {@code retainDir=false}) 停 MCP 并尽量清 project 目录。
 */
export async function deleteConnection(
  connectionId: number,
): Promise<{ id: number; name: string; deleted: boolean }> {
  const res = await api.delete<ApiResult<{ id: number; name: string; deleted: boolean }>>(
    `/iqd/connections/${connectionId}`,
  );
  return unwrap(res, '删除连接失败');
}

// ================================================================ 新建节点族（§4.3 c 点）

/** 由物理表生成模型（M-G1 黄金路径）。`POST /api/v1/iqd/catalog/model/from-table`。 */
export async function createModelFromTable(
  body: CreateModelFromTableRequest,
): Promise<IqdModelFromTableResponse> {
  const res = await api.post<ApiResult<IqdModelFromTableResponse>>(
    '/iqd/catalog/model/from-table',
    body,
  );
  return unwrap(res, '由表生成模型失败');
}

/** 空白模型创建（T03 未实现 → 抛 50300）。`POST /api/v1/iqd/catalog/model`。 */
export async function createModel(body: CreateModelRequest): Promise<IqdModelingCreateResponse> {
  const res = await api.post<ApiResult<IqdModelingCreateResponse>>('/iqd/catalog/model', body);
  return unwrap(res, '创建模型失败');
}

/** 新建关系（T03 未实现 → 抛 50300）。`POST /api/v1/iqd/catalog/relationship`。 */
export async function createRelationship(
  body: CreateRelationshipRequest,
): Promise<IqdModelingCreateResponse> {
  const res = await api.post<ApiResult<IqdModelingCreateResponse>>(
    '/iqd/catalog/relationship',
    body,
  );
  return unwrap(res, '新建关系失败');
}

/**
 * 删除关系（T03c 删除路径）。`DELETE /api/v1/iqd/catalog/relationship/{itemKey}`。
 *
 * <p><b>为何现在才有</b>：此前画布 `onEdgesChange` 主动过滤 `remove`（代价是“画布上删不掉”），
 * 因为当时后端没有删除端点 —— 默默从画布移除会让用户以为「删了」，刷新又回来。
 * 现在真删除落库，故放行。
 *
 * <p><b>物理删除</b> + bump `current_edit_revision`；与 T04a cube 子节点孤儿清理同口径。
 * 失败分支（均抛 {@link IqdModelingApiError}，读 `code`/`data`）：
 * 42200 形态非法 / 非关系节点 / 被引用；40400 关系不存在；40900 并发冲突。
 *
 * @param connectionId   问数连接 id
 * @param itemKey        关系稳定键 `mdl:relationship:<name>`
 * @param baseRevision   乐观并发基线（可省略 = 服务端不校验）
 * @param idempotencyKey 幂等键
 */
export async function deleteRelationship(
  connectionId: number,
  itemKey: string,
  baseRevision?: number,
  idempotencyKey?: string,
): Promise<DeleteRelationshipResponse> {
  const res = await api.delete<ApiResult<DeleteRelationshipResponse>>(
    `/iqd/catalog/relationship/${encodeURIComponent(itemKey)}`,
    {
      params: {
        connectionId,
        ...(baseRevision != null ? { baseRevision } : {}),
        ...(idempotencyKey ? { idempotencyKey } : {}),
      },
    },
  );
  return unwrap(res, '删除关系失败');
}

/** 新建 Cube（create-only + 双幂等；同 `item_key` 命中返回首次结果）。`POST /api/v1/iqd/catalog/cube`。 */
export async function createCube(body: CreateCubeRequest): Promise<IqdModelingCreateResponse> {
  const res = await api.post<ApiResult<IqdModelingCreateResponse>>('/iqd/catalog/cube', body);
  return unwrap(res, '新建 Cube 失败');
}

/**
 * 更新既有 Cube（T04a 补齐，`PUT /api/v1/iqd/catalog/cube`）。
 *
 * <p>补齐 T03c 暴露的缺口：「既有 Cube 改不了」（`createCube` 是 create-only，同键不应用新字段）。
 * 权限码 `iqd:modeling:edit`（与 `createCube` 同码 —— 同为「编辑模型语义对象」，V90 绑定 92700
 * → 菜单 92632；与 mis-iqd `@PreAuthorize("hasAuthority('iqd:modeling:edit')")` 逐条对齐）。
 *
 * <h2>⚠️ patch = 全量替换语义（PUT）</h2>
 * `patch.measures` / `patch.dimensions` 必须是**本次期望的完整集合**：服务端按 `item_key`
 * 与之求差，**本次未出现（且既存）的子节点会被物理删除**（孤儿清理）。缺省 / 空列表 = 清空该类
 * 子节点。故调用方**总是要带上完整的 measures/dimensions 列表**，否则会误清空既有子节点。
 *
 * <h2>校验链（服务端）</h2>
 * 写回闸门 40300 → 幂等键命中（返回首次结果，不 bump）→ cube 存在性 42200（`data.item_key`）→
 * `base_revision` 乐观并发 40900（`data.current_edit_revision`）→ `model_ref` 必需 42200 →
 * 字段引用存在性 42201（`data.errors`）。
 */
export async function upsertCube(body: CreateCubeRequest): Promise<IqdModelingCreateResponse> {
  const res = await api.put<ApiResult<IqdModelingCreateResponse>>('/iqd/catalog/cube', body);
  return unwrap(res, '更新 Cube 失败');
}

/** 新建计算列（T03 未实现 → 抛 50300）。`POST /api/v1/iqd/catalog/calculated-column`。 */
export async function createCalculatedColumn(
  body: CreateCalculatedColumnRequest,
): Promise<CreateCalculatedColumnResponse> {
  const res = await api.post<ApiResult<CreateCalculatedColumnResponse>>(
    '/iqd/catalog/calculated-column',
    body,
  );
  return unwrap(res, '新建计算列失败');
}

/**
 * 表达式静态校验（A-10 提交前同步校验）。`GET /api/v1/iqd/catalog/validate-expression`。
 *
 * <p>query 参数名用 camelCase（`connectionId`/`modelItemKey`/`expression`），与 mis-iqd
 * `@RequestParam` 一致；**失败不抛 422**，而是返回 `{valid:false, errors:[...]}`（HTTP 200）。
 */
export async function validateExpression(
  connectionId: number,
  modelItemKey: string,
  expression: string,
): Promise<ValidateExpressionResult> {
  const res = await api.get<ApiResult<ValidateExpressionResult>>(
    '/iqd/catalog/validate-expression',
    { params: { connectionId, modelItemKey, expression } },
  );
  return unwrap(res, '表达式校验失败');
}

/** 直接引用方清单（T03 未实现 → 抛 50300）。`GET /api/v1/iqd/dependencies`。 */
export async function listDependencies(
  connectionId: number,
  itemKey: string,
): Promise<IqdDependents> {
  const res = await api.get<ApiResult<IqdDependents>>('/iqd/dependencies', {
    params: { connectionId, itemKey },
  });
  return unwrap(res, '获取依赖方清单失败');
}

// ================================================================ MCP 进程生命周期（方案 A 多连接）

/**
 * MCP 进程操作类型（start / stop / restart 三态共用同一 wire 形态）。
 */
export type McpAction = 'start' | 'stop' | 'restart';

/**
 * MCP 进程启停（`POST /api/v1/iqd/mcp/{start|stop|restart}?connectionId=&wait=&retainDir=`）。
 *
 * <p>权限：`iqd:mcp:manage`（**已核实**：6 个 MCP 端点均非注解式校验，而是在 BFF
 * `IqdFacadeService:365/381/391/410` 里程序化 `requirePermission(properties.getMcpManagerPermission())`，
 * 该值默认 `iqd:mcp:manage` 见 `IqdProperties:70`；V89 已把该权限码种子化并绑定这 6 条路径）。
 * 前端闸门必须用同一个码，否则会「前端放行、后端 40300」。
 *
 * <p>⚠️ 历史备注（T02b-2 时的情况，V89 已修）：当时这 6 条路径未登记 sys_api 且权限码未种子化，
 * 故曾临时用 `iqd:modeling:edit` 兜底。
 *
 * @param connectionId 连接 id
 * @param action       start | stop | restart
 * @param wait         是否同步等待就绪（默认 true：向导里需要即时反馈）
 * @param retainDir    是否保留 project 目录（默认 true：避免误删触发重建）
 */
export async function mcpManage(
  connectionId: number,
  action: McpAction,
  wait = true,
  retainDir = true,
): Promise<Record<string, unknown>> {
  const res = await api.post<ApiResult<Record<string, unknown>>>(`/iqd/mcp/${action}`, undefined, {
    params: { connectionId, wait, retainDir },
    timeout: 120_000,
  });
  return unwrap(res, `MCP ${action} 失败`);
}

/** 取单连接 MCP 状态（`GET /api/v1/iqd/mcp/status?connectionId=`）。 */
export async function getMcpStatus(connectionId: number): Promise<Record<string, unknown>> {
  const res = await api.get<ApiResult<Record<string, unknown>>>('/iqd/mcp/status', {
    params: { connectionId },
  });
  return unwrap(res, '获取 MCP 状态失败');
}

/** 取全量 MCP 端点清单（`GET /api/v1/iqd/mcp/list`）。 */
export async function listMcpEndpoints(): Promise<Array<Record<string, unknown>>> {
  const res = await api.get<ApiResult<Array<Record<string, unknown>>>>('/iqd/mcp/list');
  return unwrap(res, '获取 MCP 清单失败') ?? [];
}

// ================================================================ 布局（§4.4 d 点，T03）

/** 取连接级布局（T03 未实现 → 抛 50300）。`GET /api/v1/iqd/modeling/layout/{connectionId}`。 */
export async function getModelLayout(connectionId: number): Promise<Record<string, unknown> | null> {
  const res = await api.get<ApiResult<Record<string, unknown> | null>>(
    `/iqd/modeling/layout/${connectionId}`,
  );
  return unwrapNullable(res, '获取布局失败');
}

/** 保存连接级布局（T03 未实现 → 抛 50300）。`PUT /api/v1/iqd/modeling/layout/{connectionId}`。 */
export async function saveModelLayout(
  connectionId: number,
  layout: Record<string, unknown>,
  baseVersion: number,
): Promise<Record<string, unknown> | null> {
  const res = await api.put<ApiResult<Record<string, unknown> | null>>(
    `/iqd/modeling/layout/${connectionId}`,
    { ...layout, base_version: baseVersion },
  );
  return unwrapNullable(res, '保存布局失败');
}

/** 一键自动布局（T03 未实现 → 抛 50300）。`POST .../modeling/layout/{id}/auto-layout`。 */
export async function autoLayout(
  connectionId: number,
  algorithm: { algorithm: string; direction: string },
): Promise<Record<string, unknown> | null> {
  const res = await api.post<ApiResult<Record<string, unknown> | null>>(
    `/iqd/modeling/layout/${connectionId}/auto-layout`,
    algorithm,
  );
  return unwrapNullable(res, '自动布局失败');
}
