import api from '@/lib/api/client';
import type { ApiResult, PageResult } from '@/types/api';
import { postEventSource, type SseFrame } from '@/lib/api/sse-client';
import type {
  KbAcl,
  KbCategory,
  KbCategoryAdmin,
  KbCategoryAdminCreatePayload,
  KbDashboard,
  KbDocument,
  KbDocumentChunkConfig,
  KbDocumentChunks,
  KbDocumentUploadResult,
  KbEngineCapabilities,
  KbEngineHealth,
  KbEngineModelPool,
  KbEngineOrphanItem,
  KbEngineOrphanResolveRequest,
  KbEngineOrphanResolveResult,
  KbEngineReconcileReport,
  KbEngineRef,
  KbEngineRenameLog,
  KbEngineRenameReq,
  KbEngineRenameResult,
  KbEngineRenameRollbackReq,
  KbFeedbackForm,
  KbFeedbackProcessPayload,
  KbGraphBuildResult,
  KbGraphStatus,
  KbHitTestRequest,
  KbHitTestResult,
  KbLibrary,
  KbLibraryDeleteMode,
  KbLibraryDeleteResult,
  KbLibraryDetail,
  KbLibraryScope,
  KbQaCitation,
  KbQaFeedback,
  KbQaSession,
  KbQaSessionDetail,
  KbQaSessionListItem,
  KbQaTicket,
  KbRagSettings,
  KbRaptorBuildResult,
  KbRaptorStatus,
  KbReparseAllResult,
  KbSubject,
  KbSynonymConfig,
  KbSynonymGroup,
  KbSynonymImportCommit,
  KbSynonymImportPrecheck,
  LegacyAclInventory,
} from '../types';

/** 统一解包 BFF `ApiResult`：code!=0 抛错（message 透传）。 */
function unwrap<T>(res: { data: ApiResult<T> }, fallback: string): T {
  if (res.data.code !== 0 || res.data.data === undefined || res.data.data === null) {
    throw new Error(res.data.message || fallback);
  }
  return res.data.data;
}

/** 剔除值为 undefined / 空串的查询参数，避免 axios 拼出 `?from=&to=` 这类噪声。 */
function cleanParams(raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (v === undefined || v === null || v === '') continue;
    out[k] = v;
  }
  return out;
}

// ------------------------------------------------------------------ 分类

export interface CreateCategoryPayload {
  name: string;
  parentId?: number | null;
  enabled: number;
  sort?: number | null;
  remark?: string | null;
}

export interface UpdateCategoryPayload {
  name: string;
  enabled: number;
  sort?: number | null;
  remark?: string | null;
}

export async function listCategories(): Promise<KbCategory[]> {
  const res = await api.get<ApiResult<KbCategory[]>>('/kb/categories');
  return unwrap(res, '获取分类失败');
}

export async function createCategory(body: CreateCategoryPayload): Promise<KbCategory> {
  const res = await api.post<ApiResult<KbCategory>>('/kb/categories', body);
  return unwrap(res, '创建分类失败');
}

export async function updateCategory(id: number, body: UpdateCategoryPayload): Promise<KbCategory> {
  const res = await api.put<ApiResult<KbCategory>>(`/kb/categories/${id}`, body);
  return unwrap(res, '更新分类失败');
}

export async function deleteCategory(id: number): Promise<void> {
  const res = await api.delete<ApiResult<null>>(`/kb/categories/${id}`);
  if (res.data.code !== 0) throw new Error(res.data.message || '删除分类失败');
}

// ------------------------------------------------------------------ 分类管理员 / 移动（知识库域一期）

/** 管辖节点 id 列表（列表页即需，页面码 kb:category:list）。 */
export async function listManageableCategoryIds(): Promise<number[]> {
  const res = await api.get<ApiResult<number[]>>('/kb/categories/manageable-ids');
  return unwrap(res, '获取管辖范围失败');
}

/** 移动分类节点（权限码 kb:category:manage；目标须在管辖内且非自己后代）。 */
export async function moveCategory(id: number, newParentId: number | null): Promise<KbCategory> {
  const res = await api.put<ApiResult<KbCategory>>(`/kb/categories/${id}/move`, { newParentId });
  return unwrap(res, '移动分类失败');
}

/** 分类节点管理员列表（权限码 kb:category:manage）。 */
export async function listCategoryAdmins(categoryId: number): Promise<KbCategoryAdmin[]> {
  const res = await api.get<ApiResult<KbCategoryAdmin[]>>(`/kb/categories/${categoryId}/admins`);
  return unwrap(res, '获取管理员列表失败');
}

/** 新增分类节点管理员（权限码 kb:category:manage）。 */
export async function grantCategoryAdmin(
  categoryId: number,
  body: KbCategoryAdminCreatePayload,
): Promise<KbCategoryAdmin> {
  const res = await api.post<ApiResult<KbCategoryAdmin>>(`/kb/categories/${categoryId}/admins`, body);
  return unwrap(res, '新增管理员失败');
}

/** 移除分类节点管理员（权限码 kb:category:manage）。 */
export async function revokeCategoryAdmin(adminId: number): Promise<void> {
  const res = await api.delete<ApiResult<null>>(`/kb/category-admins/${adminId}`);
  if (res.data.code !== 0) throw new Error(res.data.message || '移除管理员失败');
}

// ------------------------------------------------------------------ 知识库

export interface CreateLibraryPayload {
  categoryId: number;
  name: string;
  secrecy: string;
  owner?: number | null;
  settings?: KbRagSettings | null;
}

export interface UpdateLibraryPayload {
  name: string;
  secrecy: string;
  status?: number | null;
  settings?: KbRagSettings | null;
}

/**
 * 知识库列表（KBP-06：{@code scope} 数据面收敛）。
 *
 * @param categoryId 分类过滤；缺省 = 不限制
 * @param scope      {@code manageable}（本人可管理）/ {@code visible}（本人可见）/
 *                   缺省（= 现状全量，零回归）。非法值由后端兜底为全量
 */
export async function listLibraries(
  categoryId?: number | null,
  scope?: KbLibraryScope | null,
): Promise<KbLibrary[]> {
  const res = await api.get<ApiResult<KbLibrary[]>>('/kb/libraries', {
    params: cleanParams({ categoryId, scope }),
  });
  return unwrap(res, '获取知识库失败');
}

export async function getLibrary(id: number): Promise<KbLibrary> {
  const res = await api.get<ApiResult<KbLibrary>>(`/kb/libraries/${id}`);
  return unwrap(res, '获取知识库详情失败');
}

export async function createLibrary(body: CreateLibraryPayload): Promise<KbLibrary> {
  const res = await api.post<ApiResult<KbLibrary>>('/kb/libraries', body);
  return unwrap(res, '创建知识库失败');
}

export async function updateLibrary(id: number, body: UpdateLibraryPayload): Promise<KbLibrary> {
  const res = await api.put<ApiResult<KbLibrary>>(`/kb/libraries/${id}`, body);
  return unwrap(res, '更新知识库失败');
}

/**
 * 删除知识库（T04：**默认归档，不是物理删除**；Q1 两段式确认流加 force）。
 *
 * <p>返回回执而不是 void——`message` / `engineSynced` / `engineMissing` 必须让用户看见：
 * 归档模式下引擎侧数据一条没删，只是改了名 + 本地停用。调用方**不许**
 * 用自己的「删除成功」文案覆盖 `message`。
 *
 * <p><b>Q1 `force` 语义（严格限定）：</b>
 * - `force=false`（默认）：引擎侧 dataset 已不存在时返回**提示态**回执
 *   （`engineMissing=true`，本地零变更），调用方须警示并要求确认后以 `force=true` 重调；
 * - `force=true`：仅当 `engineMissing` 时跳过引擎直接本地执行（删除/归档）；
 *   对其它失败（非 404 引擎错误 / deleteSupported=false）**不豁免**；
 * - 本地已不存在 + `force=true` → 幂等回执不报错。
 *
 * @param id    知识库 id
 * @param mode  `archive`（默认）/ `physical`
 * @param force 是否跳过引擎直接本地执行（仅对 engineMissing 生效，默认 false）
 */
export async function deleteLibrary(
  id: number,
  mode: KbLibraryDeleteMode = 'archive',
  force = false,
): Promise<KbLibraryDeleteResult> {
  const res = await api.delete<ApiResult<KbLibraryDeleteResult>>(`/kb/libraries/${id}`, {
    params: { mode, force },
  });
  return unwrap(res, '删除知识库失败');
}

/**
 * 查看知识库的引擎引用（含 `dataset_id`）。
 *
 * <p>需 `kb:library:engine-ref:view`；后端每次调用都会记审计。
 * 知识库详情页基本信息 Tab 预加载本接口展示 RAGFlow Dataset ID
 * （无权限 403 / 异常时降级显示 `-`，不打断页面）；删除指引单同样复用本接口。
 */
export async function getEngineRef(id: number): Promise<KbEngineRef> {
  const res = await api.get<ApiResult<KbEngineRef>>(`/kb/libraries/${id}/engine-ref`);
  return unwrap(res, '获取引擎引用失败');
}

/** 知识库详情聚合（L-06：元信息 + 文档数 + ACL 摘要 + RAG 设置，一次拉全）。 */
export async function getLibraryDetail(id: number): Promise<KbLibraryDetail> {
  const res = await api.get<ApiResult<KbLibraryDetail>>(`/kb/libraries/${id}/detail`);
  return unwrap(res, '获取知识库详情失败');
}

/** 读取知识库 RAG 设置（L-08）。 */
export async function getRagSettings(id: number): Promise<KbRagSettings> {
  const res = await api.get<ApiResult<KbRagSettings>>(`/kb/libraries/${id}/engine/settings`);
  return unwrap(res, '获取 RAG 设置失败');
}

/** 保存知识库 RAG 设置并同步引擎（L-08）。 */
export async function updateRagSettings(
  id: number,
  settings: KbRagSettings,
): Promise<KbRagSettings> {
  const res = await api.put<ApiResult<KbRagSettings>>(
    `/kb/libraries/${id}/engine/settings`,
    settings,
  );
  return unwrap(res, '保存 RAG 设置失败');
}

/** 触发图谱构建（Wave B GraphRAG PoC，T02；手动按钮/重试）。 */
export async function buildGraph(id: number): Promise<KbGraphBuildResult> {
  const res = await api.post<ApiResult<KbGraphBuildResult>>(
    `/kb/libraries/${id}/graph/build`,
    {},
  );
  return unwrap(res, '触发图谱构建失败');
}

/** 查询图谱构建状态（Wave B GraphRAG PoC，T02；building 态 3s 轮询）。 */
export async function graphBuildStatus(id: number): Promise<KbGraphStatus> {
  const res = await api.get<ApiResult<KbGraphStatus>>(
    `/kb/libraries/${id}/graph/build-status`,
  );
  return unwrap(res, '查询图谱构建状态失败');
}

/** 触发 RAPTOR 摘要构建（Wave C RAPTOR，T02；手动按钮/重试，U4 无库数上限）。 */
export async function buildRaptor(id: number): Promise<KbRaptorBuildResult> {
  const res = await api.post<ApiResult<KbRaptorBuildResult>>(
    `/kb/libraries/${id}/raptor/build`,
    {},
  );
  return unwrap(res, '触发 RAPTOR 构建失败');
}

/** 查询 RAPTOR 构建状态（Wave C RAPTOR，T02；building 态 3s 轮询）。 */
export async function raptorBuildStatus(id: number): Promise<KbRaptorStatus> {
  const res = await api.get<ApiResult<KbRaptorStatus>>(
    `/kb/libraries/${id}/raptor/build-status`,
  );
  return unwrap(res, '查询 RAPTOR 构建状态失败');
}

// ------------------------------------------------------------------ 文档

export async function listDocuments(libraryId: number): Promise<KbDocument[]> {
  const res = await api.get<ApiResult<KbDocument[]>>(`/kb/libraries/${libraryId}/documents`);
  return unwrap(res, '获取文档列表失败');
}

export async function getDocument(libraryId: number, id: number): Promise<KbDocument> {
  const res = await api.get<ApiResult<KbDocument>>(`/kb/libraries/${libraryId}/documents/${id}`);
  return unwrap(res, '获取文档详情失败');
}

/**
 * 分页列举文档切片（「查看文档切分效果」）。
 *
 * <p>keywords 服务端过滤；page 1-based；pageSize 默认 50、前端 UI 上限 100。
 * 空态由 `hint` 承载（解析中/失败/未同步到引擎/引擎不可达）。
 */
export async function listDocumentChunks(
  libraryId: number,
  docId: number,
  keywords: string,
  page: number,
  pageSize = 50,
): Promise<KbDocumentChunks> {
  const res = await api.get<ApiResult<KbDocumentChunks>>(
    `/kb/libraries/${libraryId}/documents/${docId}/chunks`,
    { params: cleanParams({ keywords, page, pageSize }) },
  );
  return unwrap(res, '获取文档切分失败');
}

/**
 * 拉取分片版面截图（直吐 JPEG 字节；需带鉴权，不能用裸 img src）。
 *
 * @returns Object URL（调用方负责 URL.revokeObjectURL）
 */
export async function fetchDocumentChunkImage(
  libraryId: number,
  docId: number,
  imageId: string,
): Promise<string> {
  const res = await api.get<Blob>(
    `/kb/libraries/${libraryId}/documents/${docId}/chunk-images/${encodeURIComponent(imageId)}`,
    { responseType: 'blob' },
  );
  const rawType = String(res.headers?.['content-type'] ?? 'image/jpeg').split(';')[0]?.trim() ?? 'image/jpeg';
  if (rawType.includes('json') || rawType.startsWith('text/')) {
    const text = await res.data.text();
    throw new Error(text.slice(0, 200) || '分片图片响应格式异常');
  }
  const blob = res.data.type ? res.data : new Blob([res.data], { type: rawType });
  if (blob.size === 0) {
    throw new Error('分片图片为空');
  }
  return URL.createObjectURL(blob);
}

/** 上传文档（multipart/form-data；可选文件级切片参数，全空 = 继承库级）。 */
export async function uploadDocument(
  libraryId: number,
  file: File,
  chunk?: KbDocumentChunkConfig | null,
): Promise<KbDocumentUploadResult> {
  const form = new FormData();
  form.append('file', file);
  if (chunk?.chunkMethod) form.append('chunkMethod', chunk.chunkMethod);
  if (chunk?.chunkTokenNum != null) form.append('chunkTokenNum', String(chunk.chunkTokenNum));
  if (chunk?.separator != null) form.append('separator', chunk.separator);
  if (chunk?.pageIndex != null) form.append('pageIndex', String(chunk.pageIndex));
  if (chunk?.imageTableContextWindow != null) {
    form.append('imageTableContextWindow', String(chunk.imageTableContextWindow));
  }
  if (chunk?.autoKeywords != null) form.append('autoKeywords', String(chunk.autoKeywords));
  if (chunk?.autoQuestions != null) form.append('autoQuestions', String(chunk.autoQuestions));
  const res = await api.post<ApiResult<KbDocumentUploadResult>>(
    `/kb/libraries/${libraryId}/documents`,
    form,
    { headers: { 'Content-Type': 'multipart/form-data' } },
  );
  return unwrap(res, '上传文档失败');
}

/** 更新文档级切片配置（改参触发重解析；全 null = 清空文件级覆盖继承库级）。 */
export async function updateDocumentChunkConfig(
  libraryId: number,
  docId: number,
  config: KbDocumentChunkConfig,
): Promise<void> {
  const res = await api.put<ApiResult<null>>(
    `/kb/libraries/${libraryId}/documents/${docId}/chunk-config`,
    {
      chunkMethod: config.chunkMethod ?? null,
      chunkTokenNum: config.chunkTokenNum ?? null,
      separator: config.separator ?? null,
      pageIndex: config.pageIndex ?? null,
      imageTableContextWindow: config.imageTableContextWindow ?? null,
      autoKeywords: config.autoKeywords ?? null,
      autoQuestions: config.autoQuestions ?? null,
    },
  );
  if (res.data.code !== 0) throw new Error(res.data.message || '更新切片配置失败');
}

export async function setDocumentEnabled(
  libraryId: number,
  id: number,
  enabled: boolean,
): Promise<void> {
  const res = await api.put<ApiResult<null>>(
    `/kb/libraries/${libraryId}/documents/${id}/enable`,
    null,
    { params: { enabled } },
  );
  if (res.data.code !== 0) throw new Error(res.data.message || '切换文档状态失败');
}

export async function reparseDocument(libraryId: number, id: number): Promise<void> {
  const res = await api.post<ApiResult<null>>(`/kb/libraries/${libraryId}/documents/${id}/reparse`);
  if (res.data.code !== 0) throw new Error(res.data.message || '重新解析失败');
}

/**
 * 库级一键重解析（P1-1：换嵌入模型后全量重解析恢复检索；企业级增强一期 KE-05 扩展 onlyFailed）。
 *
 * <p>后端串行逐文档触发，单文档失败不中断其余；已解析中的文档自动跳过。
 * `onlyFailed=true` 时仅重试 `parse_status=failed` 的文档（先收敛引擎状态再按 failed 过滤）。
 * 返回结构化结果（成功/失败/跳过 + 失败明细），由调用方做结果反馈。
 */
export async function reparseAllDocuments(
  libraryId: number,
  onlyFailed = false,
): Promise<KbReparseAllResult> {
  const res = await api.post<ApiResult<KbReparseAllResult>>(
    `/kb/libraries/${libraryId}/documents/reparse-all`,
    undefined,
    { params: { onlyFailed } },
  );
  return unwrap(res, onlyFailed ? '重试失败文档失败' : '全部重解析失败');
}

export async function deleteDocument(libraryId: number, id: number): Promise<void> {
  const res = await api.delete<ApiResult<null>>(`/kb/libraries/${libraryId}/documents/${id}`);
  if (res.data.code !== 0) throw new Error(res.data.message || '删除文档失败');
}

// ------------------------------------------------------------------ ACL

export interface GrantAclPayload {
  subjectType: string;
  subjectId: number;
  action: string;
}

export async function listAcls(libraryId: number): Promise<KbAcl[]> {
  const res = await api.get<ApiResult<KbAcl[]>>(`/kb/libraries/${libraryId}/acls`);
  return unwrap(res, '获取授权列表失败');
}

export async function grantAcl(libraryId: number, body: GrantAclPayload): Promise<KbAcl> {
  const res = await api.post<ApiResult<KbAcl>>(`/kb/libraries/${libraryId}/acls`, body);
  return unwrap(res, '授权失败');
}

export async function revokeAcl(id: number): Promise<void> {
  const res = await api.delete<ApiResult<null>>(`/kb/acls/${id}`);
  if (res.data.code !== 0) throw new Error(res.data.message || '撤销授权失败');
}

/**
 * KBP-10 存量 manage/acl 授权清单（只读运营清理依据，不提供 CSV 导出）。
 *
 * <p>权限：BFF {@code kb:acl:revoke} + mis-kb {@code isGlobalAdmin} 双闸门，
 * 非全局管理员 403。{@code subjectName} 已由 BFF 批量回填，展示直接可用。
 *
 * @param libraryId   按库维度过滤；缺省 = 不限制
 * @param subjectType 按主体类型过滤；缺省 = 不限制
 * @param subjectId   按主体 id 过滤；缺省 = 不限制
 */
export async function listLegacyAclInventory(
  libraryId?: number | null,
  subjectType?: string | null,
  subjectId?: number | null,
): Promise<LegacyAclInventory[]> {
  const res = await api.get<ApiResult<LegacyAclInventory[]>>('/kb/acls/inventory', {
    params: cleanParams({ libraryId, subjectType, subjectId }),
  });
  return unwrap(res, '获取存量授权清单失败');
}

// ------------------------------------------------------------------ 授权主体（I-03）

/**
 * 检索授权主体。
 *
 * @param type    `user` | `role` | `dept`；缺省 `user`
 * @param keyword 关键字；`dept` 类型忽略（后端直接返回整棵部门树）
 */
export async function searchSubjects(type: string, keyword?: string): Promise<KbSubject[]> {
  const res = await api.get<ApiResult<KbSubject[]>>('/kb/subjects/search', {
    params: cleanParams({ type, keyword }),
  });
  return unwrap(res, '检索授权主体失败');
}

// ------------------------------------------------------------------ 问答历史 / 反馈

export async function listMySessions(): Promise<KbQaSession[]> {
  const res = await api.get<ApiResult<KbQaSession[]>>('/kb/qa/sessions/mine');
  return unwrap(res, '获取我的问答历史失败');
}

/** 删除问答会话（用户侧软删除，服务端幂等；删除后由调用方刷新列表）。 */
export async function deleteSession(sessionId: number): Promise<void> {
  const res = await api.delete<ApiResult<null>>(`/kb/qa/sessions/${sessionId}`);
  if (res.data.code !== 0) throw new Error(res.data.message || '删除会话失败');
}

/**
 * 会话详情（用户视角）。
 *
 * <p>F-04 起 mis-kb 的 `QaCitationVO` 已带 `source` / `offset` / `page`，
 * 历史回看不再退化为纯 ID 展示；旧数据这三个字段仍可能为 null，
 * 这里统一补齐键位，避免「类型上有、运行时 undefined」。
 */
export async function getSessionDetail(sessionId: number): Promise<KbQaSessionDetail> {
  const res = await api.get<ApiResult<KbQaSessionDetail>>(`/kb/qa/sessions/${sessionId}`);
  return normalizeSessionDetail(unwrap(res, '获取会话详情失败'));
}

/** 补齐引用的 source/offset/page 键位（缺失即 null），其余字段原样透传。 */
function normalizeSessionDetail(detail: KbQaSessionDetail): KbQaSessionDetail {
  if (detail.messages == null) return detail;
  return {
    ...detail,
    messages: detail.messages.map((m) => ({
      ...m,
      citations:
        m.citations == null
          ? null
          : m.citations.map((c) => ({
              ...c,
              source: c.source ?? null,
              offset: c.offset ?? null,
              page: c.page ?? null,
            })),
    })),
  };
}

export async function getFeedback(sessionId: number): Promise<KbQaFeedback> {
  const res = await api.get<ApiResult<KbQaFeedback>>(`/kb/qa/sessions/${sessionId}/feedback`);
  return unwrap(res, '获取反馈失败');
}

export async function submitFeedback(
  sessionId: number,
  body: KbFeedbackForm,
): Promise<KbQaFeedback> {
  const res = await api.post<ApiResult<KbQaFeedback>>('/kb/qa/feedback', {
    sessionId,
    accuracy: body.accuracy ?? null,
    helpful: body.helpful ?? null,
    offtopic: body.offtopic ?? null,
    citeError: body.citeError ?? null,
  });
  return unwrap(res, '提交反馈失败');
}

// ------------------------------------------------------------------ 运营（A-02）

/** P0 兼容：全量会话列表（路径已迁至 `sessions-all`，返回体不分页）。 */
export async function listAllSessions(): Promise<KbQaSession[]> {
  const res = await api.get<ApiResult<KbQaSession[]>>('/kb/operations/qa/sessions-all');
  return unwrap(res, '获取全量会话失败');
}

export async function listAllFeedback(): Promise<KbQaFeedback[]> {
  const res = await api.get<ApiResult<KbQaFeedback[]>>('/kb/operations/qa/feedback');
  return unwrap(res, '获取全量反馈失败');
}

/** 运营问答列表查询条件（A-02b）。 */
export interface OperationSessionQuery {
  /** 起始日期 `yyyy-MM-dd`（含）。 */
  from?: string | null;
  /** 截止日期 `yyyy-MM-dd`（含）。 */
  to?: string | null;
  libraryId?: number | null;
  userId?: number | null;
  hasFeedback?: boolean | null;
  /**
   * 评价结果筛选（OP-01）：positive 好评 / negative 差评 / null 全部。
   * 「未评价」由前端映射成 `hasFeedback=false`，不传本字段。
   */
  sentiment?: string | null;
  keyword?: string | null;
  page?: number;
  size?: number;
}

/** 运营问答列表（A-02b，服务端分页 + 提问人姓名回填）。 */
export async function listOperationSessions(
  query: OperationSessionQuery = {},
): Promise<PageResult<KbQaSessionListItem>> {
  const res = await api.get<ApiResult<PageResult<KbQaSessionListItem>>>(
    '/kb/operations/qa/sessions',
    { params: cleanParams({ ...query }) },
  );
  return unwrap(res, '获取问答记录失败');
}

/** 运营问答详情（A-02a，含可见范围与召回参数快照）。 */
export async function getOperationSessionDetail(sessionId: number): Promise<KbQaSessionDetail> {
  const res = await api.get<ApiResult<KbQaSessionDetail>>(
    `/kb/operations/qa/sessions/${sessionId}`,
  );
  return normalizeSessionDetail(unwrap(res, '获取问答详情失败'));
}

/** 评价看板（A-02b/d）。 */
export async function getDashboard(from?: string | null, to?: string | null): Promise<KbDashboard> {
  const res = await api.get<ApiResult<KbDashboard>>('/kb/operations/stats', {
    params: cleanParams({ from, to }),
  });
  return unwrap(res, '获取看板数据失败');
}

/**
 * 运营记录 CSV 导出（A-02e）。
 *
 * <p>后端直接吐字节流而非 `Result` 包装，所以这里必须 `responseType: 'blob'`，
 * 否则 axios 会按 JSON 解析把 CSV 撕成乱码。文件名优先取
 * `Content-Disposition` 的 `filename*`（UTF-8 编码，中文不乱码），
 * 回退 `filename`，再回退本地生成。
 *
 * @param desensitize 是否脱敏 userId（默认 true，导出为 `u_<12位hash>`）
 */
export async function exportOperationsCsv(
  query: Omit<OperationSessionQuery, 'page' | 'size'> = {},
  desensitize = true,
): Promise<void> {
  const res = await api.get<Blob>('/kb/operations/qa/export', {
    params: cleanParams({ ...query, desensitize }),
    responseType: 'blob',
  });
  const disposition = String(res.headers?.['content-disposition'] ?? '');
  const filename = parseFilename(disposition) ?? `kb-qa-export-${Date.now()}.csv`;
  triggerDownload(res.data, filename);
}

/** 从 `Content-Disposition` 解析文件名；解析不出返回 null。 */
function parseFilename(disposition: string): string | null {
  const star = /filename\*\s*=\s*UTF-8''([^;]+)/i.exec(disposition);
  if (star?.[1]) {
    try {
      return decodeURIComponent(star[1].trim());
    } catch {
      // 编码非法则继续尝试普通 filename
    }
  }
  const plain = /filename\s*=\s*"?([^";]+)"?/i.exec(disposition);
  return plain?.[1]?.trim() || null;
}

/** 用临时 a 标签触发浏览器下载，并及时回收 ObjectURL。 */
function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * 标记问答反馈已处理/忽略（OP-05）。
 *
 * <p>处理人取当前登录人（BFF 透传 mis-kb），状态机 pending → handled/ignored
 * 单向终态、非法流转由后端拒绝；返回更新后的反馈（含处理状态五字段）。
 */
export async function markFeedbackProcessed(
  feedbackId: number,
  payload: KbFeedbackProcessPayload,
): Promise<KbQaFeedback> {
  const res = await api.patch<ApiResult<KbQaFeedback>>(
    `/kb/operations/qa/feedback/${feedbackId}/process`,
    payload,
  );
  return unwrap(res, '标记反馈失败');
}

// ------------------------------------------------------------------ 工单（F-10 / A-02c）

/** 建工单请求体（F-10 问答一键报错）。 */
export interface CreateTicketPayload {
  sessionId: number;
  messageId?: number | null;
  type: string;
  content: string;
}

/** 工单处理请求体（A-02c；PATCH 语义，未传字段服务端不改）。 */
export interface PatchTicketPayload {
  status?: string | null;
  note?: string | null;
  relAction?: string | null;
  processorId?: number | null;
}

export async function createTicket(body: CreateTicketPayload): Promise<KbQaTicket> {
  const res = await api.post<ApiResult<KbQaTicket>>('/kb/operations/qa/tickets', {
    sessionId: body.sessionId,
    messageId: body.messageId ?? null,
    type: body.type,
    content: body.content,
  });
  return unwrap(res, '提交工单失败');
}

export async function listTickets(
  status?: string | null,
  page = 1,
  size = 20,
): Promise<PageResult<KbQaTicket>> {
  const res = await api.get<ApiResult<PageResult<KbQaTicket>>>('/kb/operations/qa/tickets', {
    params: cleanParams({ status, page, size }),
  });
  return unwrap(res, '获取工单列表失败');
}

export async function getTicket(ticketId: number): Promise<KbQaTicket> {
  const res = await api.get<ApiResult<KbQaTicket>>(`/kb/operations/qa/tickets/${ticketId}`);
  return unwrap(res, '获取工单详情失败');
}

export async function patchTicket(
  ticketId: number,
  body: PatchTicketPayload,
): Promise<KbQaTicket> {
  const res = await api.patch<ApiResult<KbQaTicket>>(`/kb/operations/qa/tickets/${ticketId}`, {
    status: body.status ?? null,
    note: body.note ?? null,
    relAction: body.relAction ?? null,
    processorId: body.processorId ?? null,
  });
  return unwrap(res, '处理工单失败');
}

export async function listTicketsBySession(sessionId: number): Promise<KbQaTicket[]> {
  const res = await api.get<ApiResult<KbQaTicket[]>>(
    `/kb/operations/qa/tickets/by-session/${sessionId}`,
  );
  return unwrap(res, '获取会话工单失败');
}

// ------------------------------------------------------------------ 引擎（S-04）

export async function engineHealth(): Promise<KbEngineHealth> {
  const res = await api.get<ApiResult<KbEngineHealth>>('/kb/engine/health');
  return unwrap(res, '获取引擎健康失败');
}

export async function engineCapabilities(): Promise<KbEngineCapabilities> {
  const res = await api.get<ApiResult<KbEngineCapabilities>>('/kb/engine/capabilities');
  return unwrap(res, '获取引擎能力失败');
}

/** 模型池（embedding[]/rerank[]/available/degradedReason/globalRerankModelId）。 */
export async function listEngineModels(): Promise<KbEngineModelPool> {
  const res = await api.get<ApiResult<KbEngineModelPool>>('/kb/engine/models');
  return unwrap(res, '获取模型池失败');
}

/**
 * 读取最近一次引擎对账报告（T04）。
 *
 * <p>只读缓存，不触发引擎调用，页面可放心随挂载拉取。
 */
export async function getReconcileReport(): Promise<KbEngineReconcileReport> {
  const res = await api.get<ApiResult<KbEngineReconcileReport>>('/kb/engine/reconcile');
  return unwrap(res, '获取对账报告失败');
}

/**
 * 手动触发一次引擎对账（权限码 `kb:engine:reconcile`）。
 *
 * <p>会真实打引擎接口并写 `kb_engine_orphan`，耗时随库数量线性增长，
 * 调用方要给按钮加 loading 态。
 */
export async function runReconcile(): Promise<KbEngineReconcileReport> {
  const res = await api.post<ApiResult<KbEngineReconcileReport>>('/kb/engine/reconcile');
  return unwrap(res, '触发对账失败');
}

/**
 * 列出引擎侧游离 dataset（P1-T3，权限码 `kb:engine:reconcile` 复用只读列表）。
 *
 * @param resolved 0=待处理（默认）1=已处置
 * @param engineType 引擎类型；省略取当前引擎
 */
export async function listEngineOrphans(
  resolved = 0,
  engineType?: string | null,
): Promise<KbEngineOrphanItem[]> {
  const params = new URLSearchParams({ resolved: String(resolved) });
  if (engineType) params.set('engineType', engineType);
  const res = await api.get<ApiResult<KbEngineOrphanItem[]>>(
    `/kb/engine/orphans?${params.toString()}`,
  );
  return unwrap(res, '获取游离数据集失败');
}

/**
 * 处置一个游离 dataset（P1-T3，权限码 `kb:engine:orphan:handle`）。
 *
 * @param nativeId 引擎原生 dataset id
 * @param body 处置请求（action + 动作相关字段）
 */
export async function resolveEngineOrphan(
  nativeId: string,
  body: KbEngineOrphanResolveRequest,
): Promise<KbEngineOrphanResolveResult> {
  const res = await api.post<ApiResult<KbEngineOrphanResolveResult>>(
    `/kb/engine/orphans/${encodeURIComponent(nativeId)}/resolve`,
    body,
  );
  return unwrap(res, '处置游离数据集失败');
}

/**
 * 存量 dataset 批量重命名（P1-T4，dry-run 或执行）。
 *
 * 权限码 `kb:engine:dataset:rename`；执行需 `confirmToken="RENAME-LEGACY"`。
 *
 * @param body 请求（dryRun / confirmToken / limit）
 */
export async function renameDatasets(body: KbEngineRenameReq): Promise<KbEngineRenameResult> {
  const res = await api.post<ApiResult<KbEngineRenameResult>>('/kb/engine/datasets/rename', body);
  return unwrap(res, '存量数据集改名失败');
}

/**
 * 回滚某批次的重命名（P1-T4，权限码 `kb:engine:dataset:rename`）。
 *
 * @param batchId 原执行批次号
 */
export async function rollbackRenameDatasets(batchId: string): Promise<KbEngineRenameResult> {
  const res = await api.post<ApiResult<KbEngineRenameResult>>(
    '/kb/engine/datasets/rename/rollback',
    { batchId } satisfies KbEngineRenameRollbackReq,
  );
  return unwrap(res, '回滚失败');
}

/** 最近的重命名日志（P1-T4）。 */
export async function listRenameLogs(limit = 100): Promise<KbEngineRenameLog[]> {
  const res = await api.get<ApiResult<KbEngineRenameLog[]>>(
    `/kb/engine/datasets/rename/logs?limit=${limit}`,
  );
  return unwrap(res, '获取改名日志失败');
}

/** 某批次的重命名日志（P1-T4）。 */
export async function getRenameLogsByBatch(batchId: string): Promise<KbEngineRenameLog[]> {
  const res = await api.get<ApiResult<KbEngineRenameLog[]>>(
    `/kb/engine/datasets/rename/logs/${encodeURIComponent(batchId)}`,
  );
  return unwrap(res, '获取批次日志失败');
}

// ------------------------------------------------------------------ 命中测试（Q-04 / WA-07）

/**
 * 执行命中测试（权限码 `kb:hittest:run`）。
 *
 * <p>单库调参工具：临时覆盖参数只影响本次调用，**不写回库设置**。
 * 未设置的覆盖项一律不发送（`cleanParams` 剔除 null/空串），
 * 让后端参数合并器按「库设置 → 全局默认」正常回落，而不是收到一堆 null 再自己判。
 *
 * <p>后端会为本次调用记审计（BFF `@OperLog`），因为命中测试能读到 chunk 原文。
 */
export async function hitTest(req: KbHitTestRequest): Promise<KbHitTestResult> {
  const body = cleanParams({
    libraryId: req.libraryId,
    question: req.question,
    topK: req.topK,
    threshold: req.threshold,
    retrievalMethod: req.retrievalMethod,
    vectorSimilarityWeight: req.vectorSimilarityWeight,
    rerank: req.rerank,
    // Wave D：只在勾选时发 true。不勾选一律不发（cleanParams 会剔除 false？不会——
    // false 不在剔除名单里），所以这里显式转成 true|null，让后端走「AUTO/FRESH」默认分支。
    disableSynonym: req.disableSynonym === true ? true : null,
    // KE-08/09：按文档 / 上传时间范围过滤。空数组与空串归 null（cleanParams 剔除），
    // 保证「均未设置时行为与现状一致」——后端不会收到 document_ids 键（R5：空 = 全量）。
    documentIds:
      req.documentIds && req.documentIds.length > 0 ? [...req.documentIds] : null,
    uploadFrom: req.uploadFrom && req.uploadFrom.trim() !== '' ? req.uploadFrom : null,
    uploadTo: req.uploadTo && req.uploadTo.trim() !== '' ? req.uploadTo : null,
    // Wave B（T03）：图谱增强临时开关。三态透传：true/false 原样下发，
    // null（跟随库设置）由 cleanParams 剔除——后端收不到 enableGraph 键即走库设置。
    enableGraph: req.enableGraph,
  });
  const res = await api.post<ApiResult<KbHitTestResult>>('/kb/hit-test', body);
  return unwrap(res, '命中测试失败');
}

// ------------------------------------------------------------------ 同义词 / 术语表（S-07，Wave D）

/** 词条唯一性冲突的结果码（设计 §7.5：40927）。 */
const KB_SYNONYM_TERM_CONFLICT = 40927;

/** 冲突明细（后端在 `data` 里带回，PRD §4.3「指名道姓」的数据基础）。 */
export interface KbSynonymConflictDetail {
  term: string | null;
  ownerGroupId: number | null;
  ownerCanonicalTerm: string | null;
}

/**
 * 词条唯一性冲突错误。
 *
 * <p>普通 `unwrap` 只把 `message` 抛出来，会丢掉「冲突词属于哪个组」这份数据，
 * 而 PRD §4.3 要求提示必须指名道姓并可跳转，因此这里单开一个错误类型承载明细。
 */
export class KbSynonymTermConflictError extends Error {
  readonly term: string | null;
  readonly ownerGroupId: number | null;
  readonly ownerCanonicalTerm: string | null;

  constructor(message: string, detail: KbSynonymConflictDetail) {
    super(message);
    this.name = 'KbSynonymTermConflictError';
    this.term = detail.term;
    this.ownerGroupId = detail.ownerGroupId;
    this.ownerCanonicalTerm = detail.ownerCanonicalTerm;
  }
}

/** 从任意抛出物里提取 BFF `ApiResult` 载荷（axios 4xx 走 `error.response.data`）。 */
function readApiPayload(e: unknown): ApiResult<unknown> | null {
  if (typeof e !== 'object' || e === null) return null;
  const data = (e as { response?: { data?: unknown } }).response?.data;
  if (typeof data === 'object' && data !== null && 'code' in data) {
    return data as ApiResult<unknown>;
  }
  return null;
}

/** `ApiResult` 是词条冲突时构造专用错误；否则返回 null。 */
function toConflictError(
  payload: ApiResult<unknown> | null,
  fallback: string,
): KbSynonymTermConflictError | null {
  if (!payload || payload.code !== KB_SYNONYM_TERM_CONFLICT) return null;
  const raw = (payload.data ?? {}) as Partial<KbSynonymConflictDetail>;
  return new KbSynonymTermConflictError(payload.message || fallback, {
    term: raw.term ?? null,
    ownerGroupId: raw.ownerGroupId ?? null,
    ownerCanonicalTerm: raw.ownerCanonicalTerm ?? null,
  });
}

/** 统一错误归一：冲突错误原样透出，其余回落成普通 Error。 */
function normalizeSynonymError(e: unknown, fallback: string): Error {
  if (e instanceof KbSynonymTermConflictError) return e;
  const conflict = toConflictError(readApiPayload(e), fallback);
  if (conflict) return conflict;
  if (e instanceof Error) return e;
  return new Error(fallback);
}

/** 术语组列表查询（服务端分页 + 服务端搜索，WD-03 硬要求）。 */
export interface SynonymGroupQuery {
  /** 同时搜规范词与别名，部分匹配、大小写不敏感（PRD §4.2） */
  keyword?: string | null;
  /** 1 启用 / 0 停用；不传为全部 */
  status?: number | null;
  page?: number;
  size?: number;
  sort?: string | null;
}

/** 术语组保存请求体（`terms` 为**有序**别名列表，顺序即预算截断优先级）。 */
export interface SynonymGroupSavePayload {
  canonicalTerm: string;
  terms: string[];
  remark?: string | null;
  status: number;
}

/**
 * 术语组分页列表（权限码 `kb:config:synonym:view`）。
 *
 * <p>⛔ 服务端分页 + 服务端搜索，**任何情况下不一次性拉全表**：
 * 词表规模按 5k～1 万词条验收，拉全表会让页面直接失去响应（WD-03 / AC-06）。
 */
export async function listSynonymGroups(
  query: SynonymGroupQuery = {},
): Promise<PageResult<KbSynonymGroup>> {
  const res = await api.get<ApiResult<PageResult<KbSynonymGroup>>>('/kb/synonyms', {
    params: cleanParams({ ...query }),
  });
  return unwrap(res, '获取术语组列表失败');
}

/** 术语组详情（编辑抽屉打开时取完整词条列表）。 */
export async function getSynonymGroup(id: number): Promise<KbSynonymGroup> {
  const res = await api.get<ApiResult<KbSynonymGroup>>(`/kb/synonyms/${id}`);
  return unwrap(res, '获取术语组详情失败');
}

/**
 * 新建术语组（权限码 `kb:config:synonym:write`）。
 *
 * <p>词条冲突时抛 {@link KbSynonymTermConflictError}，调用方可据此做「指名道姓」提示，
 * **且不得清空用户已录入的内容**（PRD §4.3）。
 */
export async function createSynonymGroup(
  body: SynonymGroupSavePayload,
): Promise<KbSynonymGroup> {
  try {
    const res = await api.post<ApiResult<KbSynonymGroup>>('/kb/synonyms', body);
    const conflict = toConflictError(res.data, '词条冲突');
    if (conflict) throw conflict;
    return unwrap(res, '新建术语组失败');
  } catch (e) {
    throw normalizeSynonymError(e, '新建术语组失败');
  }
}

/** 编辑术语组（权限码 `kb:config:synonym:write`）。冲突语义同 {@link createSynonymGroup}。 */
export async function updateSynonymGroup(
  id: number,
  body: SynonymGroupSavePayload,
): Promise<KbSynonymGroup> {
  try {
    const res = await api.put<ApiResult<KbSynonymGroup>>(`/kb/synonyms/${id}`, body);
    const conflict = toConflictError(res.data, '词条冲突');
    if (conflict) throw conflict;
    return unwrap(res, '保存术语组失败');
  } catch (e) {
    throw normalizeSynonymError(e, '保存术语组失败');
  }
}

/** 删除术语组（硬删，级联删词条；后端在操作日志里落删除前快照）。 */
export async function deleteSynonymGroup(id: number): Promise<void> {
  const res = await api.delete<ApiResult<null>>(`/kb/synonyms/${id}`);
  if (res.data.code !== 0) throw new Error(res.data.message || '删除术语组失败');
}

/** 同义词全局配置（开关双闸 + 预算 + 规模水位）。 */
export async function getSynonymConfig(): Promise<KbSynonymConfig> {
  const res = await api.get<ApiResult<KbSynonymConfig>>('/kb/synonyms/config');
  return unwrap(res, '获取同义词配置失败');
}

/**
 * 切换全局开关（权限码 `kb:config:synonym:write`）。
 *
 * <p>只写 DB 业务开关 `enabled`；Nacos 熔断闸 `killSwitchEnabled` 页面只读，
 * 它为 false 时前端应把开关置灰而不是发这个请求（Q2）。
 */
export async function setSynonymEnabled(enabled: boolean): Promise<KbSynonymConfig> {
  const res = await api.put<ApiResult<KbSynonymConfig>>('/kb/synonyms/config', { enabled });
  return unwrap(res, '切换同义词开关失败');
}

/**
 * 导出词表（权限码 `kb:config:synonym:import`）。
 *
 * <p>归到 `import` 而非 `view`：导出会把整份「企业内部黑话字典」打包带走，
 * 敏感度显著高于翻页浏览（设计 §8.3）。
 *
 * <p>后端直吐字节流，必须 `responseType: 'blob'`，否则 axios 会按 JSON 撕碎它。
 */
export async function exportSynonyms(
  format: 'CSV' | 'JSON',
  query: Pick<SynonymGroupQuery, 'keyword' | 'status'> = {},
): Promise<void> {
  const res = await api.get<Blob>('/kb/synonyms/export', {
    params: cleanParams({ ...query, format }),
    responseType: 'blob',
  });
  const disposition = String(res.headers?.['content-disposition'] ?? '');
  const ext = format === 'JSON' ? 'json' : 'csv';
  const filename = parseFilename(disposition) ?? `kb-synonyms-${Date.now()}.${ext}`;
  triggerDownload(res.data, filename);
}

/**
 * 导入阶段一 · 预检（权限码 `kb:config:synonym:import`）。
 *
 * <p>**不写任何词表数据**，只产出计划与报告。BFF 不解析文件，
 * multipart 原样透传到 mis-kb —— CSV/JSON 语义只能有一份实现。
 */
export async function precheckSynonymImport(file: File): Promise<KbSynonymImportPrecheck> {
  const form = new FormData();
  form.append('file', file);
  const res = await api.post<ApiResult<KbSynonymImportPrecheck>>(
    '/kb/synonyms/import/precheck',
    form,
    { headers: { 'Content-Type': 'multipart/form-data' } },
  );
  return unwrap(res, '导入预检失败');
}

/**
 * 导入阶段二 · 确认提交。
 *
 * <p>服务端会先校验 `dict_version` 是否仍等于预检时的值；不等则抛
 * `KB_SYNONYM_IMPORT_STALE`（40930）「词表已变更，请重新预检」——
 * 前端此时应把用户退回选择文件那一步，而不是重试。
 *
 * @param mergeExisting 同名规范词的处置：true 合并别名 / false 跳过
 */
export async function commitSynonymImport(
  token: string,
  mergeExisting: boolean,
): Promise<KbSynonymImportCommit> {
  const res = await api.post<ApiResult<KbSynonymImportCommit>>('/kb/synonyms/import/commit', {
    token,
    mergeExisting,
  });
  return unwrap(res, '导入提交失败');
}

/**
 * 下载未导入行（按原格式回吐，追加 `skip_reason`）。
 *
 * <p>管理员改完这个小文件可以直接再传一次，形成闭环——
 * 这是「跳过而非整批回滚」这个产品决策的三个前置条件之一。
 */
export async function downloadRejectedRows(batchId: number, format: string): Promise<void> {
  const res = await api.get<Blob>(`/kb/synonyms/import/${batchId}/rejected`, {
    responseType: 'blob',
  });
  const disposition = String(res.headers?.['content-disposition'] ?? '');
  const ext = String(format).toUpperCase() === 'JSON' ? 'json' : 'csv';
  const filename = parseFilename(disposition) ?? `kb-synonyms-rejected-${batchId}.${ext}`;
  triggerDownload(res.data, filename);
}

// ------------------------------------------------------------------ RAG 问答

/**
 * 知识库问答请求体（BFF `/api/v1/ai/rag`）。
 *
 * <p>`libraryIds` 为可选的检索范围收敛；不传表示「当前用户全部可见知识库」。
 * 最终范围仍由 mis-kb 二次裁定——前端传入的不可见库会被服务端剔除。
 */
export interface KbRagAskPayload {
  question: string;
  libraryIds?: number[];
  context?: unknown;
  /** 续聊的 kb 会话 ID；缺省时服务端新建会话。 */
  sessionId?: number | null;
  /** 召回条数；缺省时由服务端配置决定。 */
  topK?: number;
}

/** 知识库问答响应（BFF `AiRagResponse` 携带 kb 会话与引用信息）。 */
export interface KbRagAnswer {
  answer: string;
  sessionId: number | null;
  /** kb 助手消息 ID；提交引用级反馈时使用，未落库时为 null。 */
  messageId: number | null;
  citations: KbQaCitation[];
}

/**
 * 后端原始响应形状。
 *
 * - `kbSessionId`：mis-kb 问答会话数值 ID（走 KB 管线时非空，优先使用）
 * - `sessionId`：ai-platform 会话 UUID（字符串，兜底且通常无法转数值）
 */
interface RawRagResponse {
  answer?: string | null;
  kbSessionId?: number | string | null;
  sessionId?: number | string | null;
  messageId?: number | string | null;
  citations?: RawRagCitation[] | null;
}

/**
 * 后端引用原始形状：KB 未落库时业务 ID 可能缺失。
 *
 * <p>后端 `citation` 对象还带一个 citation 级 `messageId`，此处**有意不读取**：
 * `RawRagResponse` 顶层已有 `messageId`（提交引用级反馈时使用的唯一入参），
 * citation 级的那份是冗余镜像。缺失它**不构成契约断链**，勿据此判定字段丢失。
 */
interface RawRagCitation {
  id?: number | string | null;
  libraryId?: number | string | null;
  documentId?: number | string | null;
  chunkText?: string | null;
  chunk?: string | null;
  score?: number | string | null;
  /** 人类可读来源名，由 mis-rag `source_label()` 计算后经 BFF `AiRagCitation.source` 透出。 */
  source?: string | null;
  /** 片段字符偏移（F-04）。 */
  offset?: number | string | null;
  /** 片段页码（F-04）。 */
  page?: number | string | null;
}

/** 把后端可能返回的 string/number ID 归一为 number|null（仅接受正整数）。 */
function normalizeSessionId(raw: number | string | null | undefined): number | null {
  if (raw == null) return null;
  const n = typeof raw === 'number' ? raw : Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** 归一非负整数（offset 允许 0，故不能复用 normalizeSessionId 的 >0 判定）。 */
function normalizeNonNegative(raw: number | string | null | undefined): number | null {
  if (raw == null) return null;
  const n = typeof raw === 'number' ? raw : Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.trunc(n) : null;
}

/** 归一分数：接受 number|string，非法值回落 null。 */
function normalizeScore(raw: number | string | null | undefined): number | null {
  if (raw == null) return null;
  const n = typeof raw === 'number' ? raw : Number(raw);
  return Number.isFinite(n) ? n : null;
}

/**
 * 归一引用列表。
 *
 * 未落库（KB 持久化失败或未开启）时后端 `id` 为 null，此处按下标生成负数占位 ID，
 * 保证 React 列表 key 稳定且不与真实 ID 冲突；`chunkText` 缺失时回落 `chunk` 摘要。
 * `source` 为空串时一并归一为 null，避免 UI 渲染出空白来源名。
 */
function normalizeCitations(raw: RawRagCitation[] | null | undefined): KbQaCitation[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((c, index) => ({
    id: normalizeSessionId(c.id) ?? -(index + 1),
    libraryId: normalizeSessionId(c.libraryId),
    documentId: normalizeSessionId(c.documentId),
    chunkText: c.chunkText ?? c.chunk ?? null,
    score: normalizeScore(c.score),
    source: c.source?.trim() ? c.source.trim() : null,
    offset: normalizeNonNegative(c.offset),
    page: normalizeNonNegative(c.page),
  }));
}

/**
 * 发起知识库 RAG 问答（非流式）。
 *
 * <p>链路：前端 → BFF `/api/v1/ai/rag` → ai-platform(mis-rag) → mis-kb 检索 + 会话落库。
 * 会话/消息/引用由服务端持久化，前端仅消费返回结果。
 *
 * <p>不复用 `features/ai` 的 useAI Hook：跨 feature 直接依赖违反架构军规1；
 * 能力可用性通过全局 `useAiStore` 判定（允许的通信方式）。
 */
export async function askKbRag(payload: KbRagAskPayload): Promise<KbRagAnswer> {
  const res = await api.post<ApiResult<RawRagResponse>>('/ai/rag', {
    capability: 'rag',
    question: payload.question,
    libraryIds: payload.libraryIds,
    context: payload.context,
    sessionId: payload.sessionId ?? null,
    topK: payload.topK,
  });
  const data = unwrap(res, '问答失败');
  return {
    answer: data.answer ?? '',
    // 优先取 kb 业务会话 ID；缺省时才尝试 sessionId（平台 UUID 通常归一为 null）
    sessionId: normalizeSessionId(data.kbSessionId) ?? normalizeSessionId(data.sessionId),
    messageId: normalizeSessionId(data.messageId),
    citations: normalizeCitations(data.citations),
  };
}

/** 流式问答回调集合（F-01）。 */
export interface KbRagStreamHandlers {
  /** 逐块文本增量；累加即为完整回答。 */
  onDelta: (text: string) => void;
  /** 流正常收尾：携带落库后的会话/消息 ID 与引用。 */
  onDone: (result: KbRagAnswer) => void;
  /** 业务错误帧或连接异常；同一次问答至多触发一次。 */
  onError: (message: string) => void;
}

/** SSE `done` 帧原始形状。 */
interface RawDoneFrame {
  sessionId?: number | string | null;
  kbSessionId?: number | string | null;
  messageId?: number | string | null;
  citations?: RawRagCitation[] | null;
  finishReason?: string | null;
}

/**
 * 发起流式知识库问答（F-01）。
 *
 * <p>帧契约（与 mis-rag `QaDelta.to_payload()` / BFF SSE 透传对齐）：
 * - `delta` → `{text, delta}`（双键兼容，取任一）
 * - `done`  → `{sessionId, messageId, citations, finishReason, platformSessionId}`
 * - `error` → `{code, message}`
 *
 * <p>**持久化时机**：mis-rag 在流结束时一次性落库（非逐 token），
 * 所以 `sessionId` / `messageId` 只可能出现在 `done` 帧里——
 * 不要试图从 `delta` 帧上取，取不到不是 bug。
 *
 * <p>`onError` 与 `onDone` 互斥：错误帧到达后置位 `settled`，
 * 后续连接层 onerror 不再重复回调，避免 UI 弹两次 toast。
 *
 * @param payload 问答入参
 * @param handlers 回调集合
 * @param signal 中断信号（用户点「停止」时 abort）
 */
export async function askKbRagStream(
  payload: KbRagAskPayload,
  handlers: KbRagStreamHandlers,
  signal?: AbortSignal,
): Promise<void> {
  let buffer = '';
  let settled = false;

  const fail = (message: string): void => {
    if (settled) return;
    settled = true;
    handlers.onError(message);
  };

  const handleFrame = (frame: SseFrame): void => {
    if (settled) return;
    const data = frame.data;
    const event = frame.event || inferEvent(data);

    if (event === 'error') {
      const message =
        (typeof data?.message === 'string' && data.message) || frame.raw || 'AI 响应异常';
      fail(message);
      return;
    }

    if (event === 'done') {
      settled = true;
      const done = (data ?? {}) as RawDoneFrame;
      handlers.onDone({
        answer: buffer,
        sessionId:
          normalizeSessionId(done.kbSessionId) ?? normalizeSessionId(done.sessionId),
        messageId: normalizeSessionId(done.messageId),
        citations: normalizeCitations(done.citations),
      });
      return;
    }

    // 其余一律按增量处理：优先 text，回落 delta
    const text = pickDeltaText(data, frame.raw);
    if (text) {
      buffer += text;
      handlers.onDelta(text);
    }
  };

  try {
    await postEventSource('/ai/rag', {
      body: {
        capability: 'rag',
        question: payload.question,
        libraryIds: payload.libraryIds,
        context: payload.context,
        sessionId: payload.sessionId ?? null,
        topK: payload.topK,
        stream: true,
      },
      onFrame: handleFrame,
      onError: (err) => fail(err.message),
      signal,
    });
  } catch (e) {
    // 主动 abort 不算异常：用户点了停止，把已收到的内容按正常收尾交付
    if (signal?.aborted) {
      if (!settled) {
        settled = true;
        handlers.onDone({ answer: buffer, sessionId: null, messageId: null, citations: [] });
      }
      return;
    }
    fail(e instanceof Error ? e.message : '问答失败');
  }
}

/** 服务端未给 `event:` 行时，按 payload 形状推断事件类型。 */
function inferEvent(data: Record<string, unknown> | null): string {
  if (!data) return 'delta';
  const t = data.type;
  if (typeof t === 'string' && (t === 'delta' || t === 'done' || t === 'error')) return t;
  if ('message' in data && 'code' in data) return 'error';
  if ('citations' in data || 'finishReason' in data) return 'done';
  return 'delta';
}

/** 取增量文本：`text` 优先，`delta` 回落；两者皆无时用原始行（非 JSON 流兜底）。 */
function pickDeltaText(data: Record<string, unknown> | null, raw: string): string {
  if (!data) return raw;
  if (typeof data.text === 'string') return data.text;
  if (typeof data.delta === 'string') return data.delta;
  return '';
}
