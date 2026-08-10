/**
 * 知识库（KB）前端契约类型。
 *
 * <p>字段与 BFF `com.mis.adminbff.dto.kb.*` 严格镜像：
 * - Java `Long` → TS `number`（BFF 未启用 Long→String 序列化）
 * - Java `Instant` → TS `string`（Spring Boot 默认 ISO-8601，非时间戳）
 * - Java 包装类型可空 → TS 使用 `| null` 而非 `?`，避免 exactOptionalPropertyTypes 歧义
 *
 * <p>可见性/ACL/密级/editable_once 等业务规则由 mis-kb 裁定，前端仅做展示与提示。
 */

/** 密级枚举（与 mis-kb `Secrecy` 对齐）。 */
export type KbSecrecy = 'public' | 'internal' | 'confidential' | 'secret';

/** ACL 主体类型（`dept` 为 I-03 新增，与后端 `SubjectType` 一一对应）。 */
export type KbSubjectType = 'user' | 'role' | 'dept';

/**
 * ACL 动作（X-02 修复）。
 *
 * <p>后端 `AclAction` 只有 `read|manage|acl` 三个取值。修复前前端错列了
 * `read|write|admin`，导致选「读写/管理」提交必被 mis-kb 拒绝。
 */
export type KbAclAction = 'read' | 'manage' | 'acl';

/** 文档解析状态（与 mis-kb `ParseStatus` 对齐）。 */
export type KbParseStatus = 'pending' | 'parsing' | 'success' | 'failed';

/** 问答消息角色。 */
export type KbQaRole = 'user' | 'assistant';

/** 空结果策略（L-08，与 mis-kb `EmptyResultStrategy` 对齐）。 */
export type KbEmptyResultStrategy = 'SUGGEST' | 'EMPTY' | 'TRANSFER';

/** 工单状态（A-02c，与 mis-kb `TicketStatus` 对齐）。 */
export type KbTicketStatus = 'open' | 'processing' | 'resolved' | 'closed';

/** 工单类型（F-10，与 mis-kb `TicketType` 对齐）。 */
export type KbTicketType = 'answer_error' | 'cite_error' | 'missing_doc' | 'permission' | 'other';

/** 工单关联动作（A-02c，与 mis-kb `TicketRelAction` 对齐）。 */
export type KbTicketRelAction = 'none' | 'add_doc' | 'fix_doc' | 'adjust_acl' | 'adjust_rag';

/**
 * 检索方式（与后端 `RagSettings.METHOD_*` 对齐）。
 *
 * <p>术语约定（WA-12）：`hybrid` 一律称「混合检索（关键字 + 语义）」，
 * **严禁**与「知识图谱 / Graph 检索」混称——那是完全不同的东西。
 */
export type KbRetrievalMethod = 'vector' | 'keyword' | 'hybrid';

/**
 * 知识库 RAG 设置（L-08 扩展 4 字段；Wave A 再扩 `vectorSimilarityWeight`）。
 *
 * <p>`retrievalMethod` 的落点口径见 Wave A 纠偏：它是**检索期**参数，
 * 由 mis-kb 在 `POST /api/v1/retrieval` 时以 `keyword` + `vector_similarity_weight`
 * 组合表达；RAGFlow 的 dataset 接口根本没有 `retrieval_method` 字段。
 */
export interface KbRagSettings {
  topK: number | null;
  scoreThreshold: number | null;
  rerank: boolean | null;
  embeddingModel: string | null;
  retrievalMethod: string | null;
  /** 切片方法（RAGFlow `chunk_method`）。 */
  chunkMethod: string | null;
  /** 切片长度（token 数）。 */
  chunkTokenNum: number | null;
  /** 切片分隔符。 */
  separator: string | null;
  /** 空结果策略；缺省由服务端回填 `SUGGEST`。 */
  emptyResultStrategy: string | null;
  /**
   * 向量相似度权重 [0,1]（WA-01）。
   *
   * <p>仅 `retrievalMethod === 'hybrid'` 时参与检索；切到 vector/keyword 时
   * 前端**隐藏但不清值**，后端保存路径也**不覆写**——来回切换不丢用户设定。
   * 「vector→1.0 / keyword→0.0」的强制换算只发生在后端检索期合并阶段。
   */
  vectorSimilarityWeight: number | null;
  /**
   * 库级重排模型 id（kb_settings_model_chunk，末位追加）。
   *
   * <p>全限定格式 `name@provider@provider`（如
   * `qwen3-rerank@Tongyi-Qianwen@Tongyi-Qianwen`）；`null` = 继承全局
   * `mis.kb.engine.rerank-model-id`。全局未配置时重排开关整体置灰，
   * 库级值不参与合并链（设计 U3）。
   */
  rerankModelId: string | null;
}

/** 知识库分类。 */
export interface KbCategory {
  id: number;
  parentId: number | null;
  name: string;
  enabled: number;
  sort: number | null;
  remark: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

/**
 * 分类节点管理员授权（知识库域一期）。
 *
 * <p>管理范围 = 以 `categoryId` 为根的整棵子树；`createdBy` 为「授权人」（O-2 采纳，可空）。
 */
export interface KbCategoryAdmin {
  id: number;
  categoryId: number;
  subjectType: string;
  subjectId: number;
  createdBy: number | null;
  createdAt: string | null;
  updatedAt: string | null;
}

/** 新增分类节点管理员请求体。 */
export interface KbCategoryAdminCreatePayload {
  subjectType: string;
  subjectId: number;
}

/**
 * 管辖节点信息（知识库域一期，树高亮/只看管辖）。
 *
 * <p>`manageableIds` = 本人可管理的全部节点 id（授权节点的子树并集；全局管理员 = 全量）。
 */
export interface KbCategoryManageableInfo {
  manageableIds: number[];
}

/** 知识库。 */
export interface KbLibrary {
  id: number;
  categoryId: number | null;
  name: string;
  secrecy: string;
  status: number | null;
  owner: number | null;
  engineType: string | null;
  settings: KbRagSettings | null;
  docCount: number | null;
  createdAt: string | null;
  updatedAt: string | null;
}

/** 知识库文档。 */
export interface KbDocument {
  id: number;
  libraryId: number;
  title: string;
  version: number | null;
  parseStatus: string;
  enabled: number;
  size: number | null;
  format: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  /** 文件级切片方法（kb_settings_model_chunk；null = 继承库级）。 */
  chunkMethod: string | null;
  /** 文件级切片 token 数（null = 继承库级）。 */
  chunkTokenNum: number | null;
  /** 文件级切片分隔符（null = 继承库级）。 */
  separator: string | null;
}

/**
 * 文件级切片配置（上传/改参请求体；三字段全 null = 继承库级）。
 *
 * <p>「任一字段非空 = 文件指定」，后端据此判定来源徽标（FILE_OVERRIDE / LIBRARY）。
 */
export interface KbDocumentChunkConfig {
  chunkMethod: string | null;
  chunkTokenNum: number | null;
  separator: string | null;
}

/** 文档上传响应。 */
export interface KbDocumentUploadResult {
  id: number;
  parseStatus: string;
}

/**
 * 库级一键重解析结果（P1-1：换嵌入模型后全量重解析恢复检索）。
 *
 * <p>批量语义：`total` = 库内文档总数；`success` = 本次新触发解析的文档数；
 * `failed` = 触发失败或无引擎映射的文档数；`skipped` = 已处于解析中、按幂等跳过数。
 * 单文档失败不中断其余，失败明细随 `failedDocuments` 返回供失败列表展示。
 */
export interface KbReparseAllResult {
  libraryId: number;
  total: number;
  success: number;
  failed: number;
  skipped: number;
  failedDocuments: KbReparseFailedDocument[];
}

/** 库级一键重解析失败明细。 */
export interface KbReparseFailedDocument {
  documentId: number;
  title: string | null;
  reason: string | null;
}

/** 知识库 ACL 授权项。 */
export interface KbAcl {
  id: number;
  libraryId: number;
  subjectType: string;
  subjectId: number;
  action: string;
  createdAt: string | null;
  updatedAt: string | null;
}

/** ACL 摘要（库详情 / 问答详情的可见范围展示；`subjectName` 由 BFF 回填）。 */
export interface KbAclSummary {
  subjectType: string;
  subjectId: number | null;
  subjectName: string | null;
  action: string;
}

/** 知识库详情聚合（L-06）。 */
export interface KbLibraryDetail {
  meta: KbLibrary | null;
  docCount: number | null;
  aclSummary: KbAclSummary[] | null;
  ragSettings: KbRagSettings | null;
}

/** 问答会话。 */
export interface KbQaSession {
  id: number;
  userId: number | null;
  appId: number | null;
  createdAt: string | null;
}

/** 问答引用（仅含 MIS 业务 ID，不暴露引擎原生 id）。 */
export interface KbQaCitation {
  id: number;
  libraryId: number | null;
  documentId: number | null;
  chunkText: string | null;
  score: number | null;
  /**
   * 人类可读来源名（如文档标题）。
   *
   * <p>RAG 实时问答链路由 mis-rag `source_label()` 填充；F-04 起 mis-kb 落库时
   * 一并持久化 `source`，历史回看不再退化为 ID 展示（旧数据仍可能为 null）。
   */
  source: string | null;
  /** 片段在原文中的字符偏移（F-04）；引擎给不出时为 null。 */
  offset: number | null;
  /** 片段所在页码，1 起（F-04）；引擎给不出时为 null。 */
  page: number | null;
}

/** 问答消息。 */
export interface KbQaMessage {
  id: number;
  role: string;
  content: string;
  createdAt: string | null;
  citations: KbQaCitation[] | null;
}

/** 问答反馈（editable_once：首次创建，第二次可改，第三次拒绝）。 */
export interface KbQaFeedback {
  id: number;
  sessionId: number;
  accuracy: number | null;
  helpful: number | null;
  offtopic: number | null;
  citeError: number | null;
}

/** 会话可见范围快照（A-02a）。 */
export interface KbVisibility {
  secrecy: string | null;
  acls: KbAclSummary[] | null;
}

/** 会话召回参数快照（A-02a；取自库当前 RAG 设置，非本轮实际入参的精确重放）。 */
export interface KbRecallParams {
  topK: number | null;
  scoreThreshold: number | null;
  rerank: boolean | null;
  retrievalMethod: string | null;
  /** 向量相似度权重（Wave A 补齐，与生效参数口径对齐）。 */
  vectorSimilarityWeight: number | null;
}

/** 问答会话详情（A-02a 扩展 visibility / recallParams）。 */
export interface KbQaSessionDetail {
  session: KbQaSession | null;
  messages: KbQaMessage[] | null;
  feedback: KbQaFeedback | null;
  visibility: KbVisibility | null;
  recallParams: KbRecallParams | null;
}

/** 运营问答列表行（A-02b）。 */
export interface KbQaSessionListItem {
  id: number;
  userId: number | null;
  userName: string | null;
  appId: number | null;
  createdAt: string | null;
  question: string | null;
  answerBrief: string | null;
  messageCount: number | null;
  citeCount: number | null;
  libraryIds: number[] | null;
  hasFeedback: boolean | null;
  accuracy: number | null;
  helpful: number | null;
}

/** 看板日趋势点（A-02b/d）。 */
export interface KbDashboardDailyPoint {
  date: string;
  sessionCount: number | null;
  feedbackCount: number | null;
  /** 当日综合平均分（0~5，两位小数）；当日无评分为 null。 */
  avgScore: number | null;
}

/** 看板热门知识库（A-02b/d）。 */
export interface KbDashboardLibraryHit {
  libraryId: number | null;
  libraryName: string | null;
  hitCount: number | null;
}

/** 差评维度计数（A-02b 图1）。 */
export interface KbDashboardDimensionCount {
  code: string;
  label: string | null;
  count: number | null;
}

/** 高频差评问（A-02b 图2）。 */
export interface KbDashboardQuestionCount {
  question: string | null;
  count: number | null;
  sessionId: number | null;
}

/** 低分知识库（A-02b 图3，按均分升序）。 */
export interface KbDashboardLibraryScore {
  libraryId: number | null;
  libraryName: string | null;
  avgScore: number | null;
  ratedCount: number | null;
}

/** 低分文档（A-02b 图3，按均分升序）。 */
export interface KbDashboardDocumentScore {
  documentId: number | null;
  libraryId: number | null;
  title: string | null;
  avgScore: number | null;
  ratedCount: number | null;
}

/**
 * 评价看板（A-02b/d）。
 *
 * <p>字段与 BFF `com.mis.adminbff.dto.kb.KbDashboardVO` 严格镜像。
 * 好评/差评分档口径：后端按 `accuracy/helpful` 折算综合分（表无点赞点踩字段），
 * `positiveRate = positiveCount / ratedCount`。三个计数全部透出供前端自由换算。
 */
export interface KbDashboard {
  sessionCount: number | null;
  messageCount: number | null;
  feedbackCount: number | null;
  feedbackRate: number | null;
  avgAccuracy: number | null;
  avgHelpful: number | null;
  offtopicCount: number | null;
  citeErrorCount: number | null;
  openTickets: number | null;
  totalTickets: number | null;
  /** 参与好评/差评判定的反馈数。 */
  ratedCount: number | null;
  /** 好评数（综合分 >= 4）。 */
  positiveCount: number | null;
  /** 差评数（综合分 <= 2）。 */
  negativeCount: number | null;
  /** 好评率（0~1，两位小数）；无评分为 null。 */
  positiveRate: number | null;
  /** 综合平均分（0~5，两位小数）；无评分为 null。 */
  avgScore: number | null;
  /** 差评维度分布（固定四桶，计数可为 0）。 */
  negativeDimensions: KbDashboardDimensionCount[] | null;
  /** 高频差评问 Top N。 */
  topNegativeQuestions: KbDashboardQuestionCount[] | null;
  /** 低分知识库 TopN（按均分升序）。 */
  lowScoreLibraries: KbDashboardLibraryScore[] | null;
  /** 低分文档 TopN（按均分升序）。 */
  lowScoreDocuments: KbDashboardDocumentScore[] | null;
  trend: KbDashboardDailyPoint[] | null;
  topLibraries: KbDashboardLibraryHit[] | null;
}

/** 工单状态流转轨迹条目（A-02c）。 */
export interface KbTicketTimelineEntry {
  at: string | null;
  from: string | null;
  to: string | null;
  userId: number | null;
  note: string | null;
}

/** 问答工单（F-10 建单 / A-02c 处理）。 */
export interface KbQaTicket {
  id: number;
  sessionId: number | null;
  messageId: number | null;
  type: string | null;
  typeLabel: string | null;
  status: string | null;
  content: string | null;
  note: string | null;
  relAction: string | null;
  creatorId: number | null;
  handlerId: number | null;
  processorId: number | null;
  timeline: KbTicketTimelineEntry[] | null;
  createdAt: string | null;
  updatedAt: string | null;
}

/** 授权主体（I-03 选人/选角色/选部门；dept 为树形，children 非空）。 */
export interface KbSubject {
  type: string;
  id: number | null;
  name: string | null;
  extra: string | null;
  children: KbSubject[] | null;
}

/** 引擎连通性健康。 */
export interface KbEngineHealth {
  engineType: string | null;
  healthy: boolean | null;
  status: string | null;
  detail: string | null;
}

/**
 * 引擎能力（前端按能力显隐/灰化 UI）。
 *
 * <p>**注意 `rerankSupported` 的语义（WA-06）**：它不是「引擎理论上支不支持重排」，
 * 而是「**当前平台配置下重排能不能用**」——取决于运维有没有配全局
 * `mis.kb.engine.rerank-model-id`。为 false 时前端必须置灰并给出理由，
 * 否则用户开了开关、保存后被后端强制关掉，界面与实际不一致。
 */
export interface KbEngineCapabilities {
  engineType: string | null;
  capabilities: string[] | null;
  rerankSupported: boolean | null;
  metadataFilterSupported: boolean | null;
  replaceSupported: boolean | null;
  /** 是否支持混合检索（关键字 + 语义）与权重调节（WA-03）。 */
  hybridSupported: boolean | null;
}

/**
 * 模型池项（kb_settings_model_chunk；BFF `KbEngineModelVO` 镜像）。
 *
 * <p>`id` = 全限定 id（embedding/rerank 均为 `name@instance@provider`），
 * 创建/检索直接可用；`dimension`/`language` 列表接口不提供时为 null。
 */
export interface KbEngineModel {
  id: string;
  name: string;
  type: string;
  provider: string | null;
  dimension: number | null;
  language: string | null;
}

/**
 * 模型池快照（kb_settings_model_chunk；BFF `KbEngineModelPoolVO` 镜像）。
 *
 * <p>⚠️ **`available === false` 是探测失败/引擎不可达，绝不当空列表展示**
 * （设计 §8-6 降级语义）——此时必须渲染告警态 + `degradedReason` + 重试，
 * 而不是把「拉不到模型」误当「平台没有模型」。
 *
 * <p>`globalRerankModelId` = 全局配置重排模型 id（可为空串），
 * 供「默认项 = 全局」标注与「库级不在池回退全局」的文案对齐。
 */
export interface KbEngineModelPool {
  embedding: KbEngineModel[] | null;
  rerank: KbEngineModel[] | null;
  available: boolean | null;
  degradedReason: string | null;
  globalRerankModelId: string | null;
  probedAt: string | null;
}

// --------------------------------------------------------------- 同义词与术语扩展（Wave D / S-07）

/**
 * 同义词扩展结果状态（四态互斥且必有值，设计 §7.3）。
 *
 * <p>⛔ `DISABLED_GLOBAL` 与 `DISABLED_REQUEST` **绝不可合并**：
 * 前者要管理员去 S-07 改全局开关，后者只要取消「本次不使用」勾选，
 * 后续动作完全不同，合并会直接制造一类「以为坏了」的支持工单。
 */
export type KbSynonymExpansionStatus =
  | 'EXPANDED'
  | 'NO_MATCH'
  | 'DISABLED_REQUEST'
  | 'DISABLED_GLOBAL';

/** 导入预检的行级动作。 */
export type KbSynonymImportAction = 'CREATE' | 'MERGE' | 'SKIP';

/** 词表导入导出文件格式。 */
export type KbSynonymFileFormat = 'CSV' | 'JSON';

/**
 * 术语组内的单个词条。
 *
 * <p>`canonical` 为真者即规范词自身（恒在首位）；`sortNo` 决定预算截断时的入选优先级。
 */
export interface KbSynonymTermItem {
  term: string;
  canonical: boolean | null;
  sortNo: number | null;
}

/**
 * 术语组（BFF `KbSynonymGroupVO` 镜像）。
 *
 * <p>`status`：1 = 启用 / 0 = 停用（与 `kb_synonym_group.status` 一致）。
 * 停用组**仍占用词条唯一性**（Q3 裁决），不会被其它组抢走。
 *
 * <p>`matchedAlias`：服务端搜索命中的是别名时回填，供列表高亮 + 「命中别名：X」提示。
 */
export interface KbSynonymGroup {
  id: number;
  canonicalTerm: string;
  remark: string | null;
  status: number | null;
  terms: KbSynonymTermItem[] | null;
  termCount: number | null;
  matchedAlias: string | null;
  updatedAt: string | null;
  updatedBy: number | null;
}

/**
 * 扩展预算四值（Nacos 下发，页面**只读**，Q5 裁决）。
 *
 * <p>⛔ 前端所有提示文案里的数字一律从这里取，**不许写死**。
 */
export interface KbSynonymBudget {
  maxGroups: number | null;
  maxTermsPerGroup: number | null;
  maxQueryChars: number | null;
  minTermLength: number | null;
}

/** 词表规模水位（WD-15，只提示不硬拦）。 */
export interface KbSynonymScale {
  groupCount: number | null;
  termCount: number | null;
  recommendedTermLimit: number | null;
}

/**
 * 同义词全局配置（BFF `KbSynonymConfigVO` 镜像）。
 *
 * <p>双闸语义：`enabled` 是 DB 业务开关（页面可写），`killSwitchEnabled` 是
 * Nacos 熔断闸（页面只读），`effective = enabled && killSwitchEnabled`。
 * 三者都可能为 null（未加载 / 后端未下发），判定一律 `=== true`（§7.8）。
 */
export interface KbSynonymConfig {
  enabled: boolean | null;
  killSwitchEnabled: boolean | null;
  effective: boolean | null;
  budget: KbSynonymBudget | null;
  scale: KbSynonymScale | null;
  dictVersion: number | null;
}

/** 单个术语组的命中明细。 */
export interface KbSynonymHit {
  groupId: number | null;
  matchedTerm: string | null;
  canonicalTerm: string | null;
  addedTermCount: number | null;
}

/**
 * 同义词扩展轨迹（BFF `SynonymExpansionVO` 镜像）。
 *
 * <p>★ 只有**命中测试**链路会回显本对象；问答链路的 `RetrieveHitsVO`
 * 一个字段都不许加（WD-06 红线）。
 *
 * <p>`expandedQuery` 恒非空：未扩展时等于 `originalQuestion`。
 */
export interface KbSynonymExpansion {
  status: string;
  originalQuestion: string | null;
  expandedQuery: string | null;
  hits: KbSynonymHit[] | null;
  droppedGroups: string[] | null;
  skippedShortTerms: string[] | null;
  totalMatchedGroups: number | null;
  usedGroups: number | null;
  truncated: boolean | null;
  /** 运维声明式开关（Q9）；**必须 `=== true` 判定**，缺字段 = 不展示 = 安全侧。 */
  engineNativeHint: boolean | null;
  budget: KbSynonymBudget | null;
}

/** 导入预检的逐行计划（行号 + 冲突词 + 现属组，三样都不能少）。 */
export interface KbSynonymImportRow {
  lineNo: number | null;
  canonicalTerm: string | null;
  action: string;
  skipReason: string | null;
  conflictTerm: string | null;
  ownerGroupId: number | null;
  ownerCanonicalTerm: string | null;
}

/**
 * 导入预检报告（阶段一产物，**不写任何词表数据**）。
 *
 * <p>`token` 是阶段二提交的凭据；服务端把计划落库而非放内存，
 * 因此预检落实例 A、提交落实例 B 也不会「找不到 token」。
 */
export interface KbSynonymImportPrecheck {
  token: string;
  batchId: number | null;
  format: string;
  plannedCreate: number | null;
  plannedMerge: number | null;
  plannedSkip: number | null;
  rows: KbSynonymImportRow[] | null;
  warnings: string[] | null;
  expiresAt: string | null;
}

/** 导入提交回执（阶段二产物）。 */
export interface KbSynonymImportCommit {
  batchId: number | null;
  createdCount: number | null;
  mergedCount: number | null;
  skippedCount: number | null;
}

// --------------------------------------------------------------- 命中测试（Q-04 / WA-07）

/** 命中测试请求（单库 + 问题 + 可选临时覆盖参数；覆盖值不写回库设置）。 */
export interface KbHitTestRequest {
  libraryId: number;
  question: string;
  topK?: number | null;
  threshold?: number | null;
  retrievalMethod?: string | null;
  vectorSimilarityWeight?: number | null;
  rerank?: boolean | null;
  /**
   * 本次不使用同义词扩展（WD-11，Wave D 新增，末位追加）。
   *
   * <p>⛔ **仅影响本次测试**，绝不写回全局开关——与本页「调参只影响本次」口径一致。
   */
  disableSynonym?: boolean | null;
}

/** 命中测试单条命中（与 BFF `KbHitTestHitVO` 镜像）。 */
export interface KbHitTestHit {
  libraryId: number | null;
  documentId: number | null;
  chunkText: string | null;
  score: number | null;
  docTitle: string | null;
  offset: number | null;
  page: number | null;
}

/**
 * 本次检索生效参数（WA-02 / WA-14）。
 *
 * <p>`source` 三值：`LIBRARY` 单库取库设置 / `GLOBAL_DEFAULT` 多库回落全局默认 /
 * `REQUEST_OVERRIDE` 本次调参覆盖。多库回落这件事必须让用户看见，
 * 否则会误以为自己的库设置生效了。
 */
export interface KbEffectiveParams {
  topK: number | null;
  threshold: number | null;
  retrievalMethod: string | null;
  vectorSimilarityWeight: number | null;
  rerank: boolean | null;
  rerankModelId: string | null;
  emptyResultStrategy: string | null;
  source: string | null;
  degradedReasons: string[] | null;
}

/** 命中测试结果（与 BFF `KbHitTestResultVO` 镜像）。 */
export interface KbHitTestResult {
  hits: KbHitTestHit[] | null;
  effectiveParams: KbEffectiveParams | null;
  elapsedMs: number | null;
  emptyResultStrategy: string | null;
  degraded: boolean | null;
  /**
   * 同义词扩展轨迹（Wave D 新增，末位追加）。
   *
   * <p>命中测试是**唯一**被允许回显扩展结果的出口（设计 §7.1-3）。
   * 老后端未升级时为 undefined/null，卡片整体不渲染。
   */
  synonym?: KbSynonymExpansion | null;
}

/** 反馈提交表单模型（四个维度均为 0-5 分，未评为 null）。 */
export interface KbFeedbackForm {
  accuracy: number | null;
  helpful: number | null;
  offtopic: number | null;
  citeError: number | null;
}

// --------------------------------------------------------------- 展示常量

/**
 * 密级选项（X-01 修复）。
 *
 * <p>权威映射以 `V13__kb_seed.sql` 的字典种子为准：
 * `secret=秘密`、`confidential=机密`。修复前前端把两者对调，
 * 导致「机密」库在界面上显示成「秘密」，密级越高显示越低——属于安全展示缺陷。
 */
export const KB_SECRECY_OPTIONS: { value: KbSecrecy; label: string }[] = [
  { value: 'public', label: '公开' },
  { value: 'internal', label: '内部' },
  { value: 'secret', label: '秘密' },
  { value: 'confidential', label: '机密' },
];

export const KB_SUBJECT_TYPE_OPTIONS: { value: KbSubjectType; label: string }[] = [
  { value: 'user', label: '用户' },
  { value: 'role', label: '角色' },
  { value: 'dept', label: '部门' },
];

/** ACL 动作选项（X-02 修复：删除后端不存在的 write/admin）。 */
export const KB_ACL_ACTION_OPTIONS: { value: KbAclAction; label: string }[] = [
  { value: 'read', label: '只读' },
  { value: 'manage', label: '管理' },
  { value: 'acl', label: '授权' },
];

/**
 * 检索方式选项（WA-12 术语统一）。
 *
 * <p>`hybrid` 的中文名固定为「混合检索（关键字 + 语义）」——修复前面板里只写「混合检索」，
 * 与「知识图谱检索」容易被口头混为一谈，产品明确要求消歧。
 */
export const KB_RETRIEVAL_METHOD_OPTIONS: {
  value: KbRetrievalMethod;
  label: string;
  hint: string;
}[] = [
  {
    value: 'hybrid',
    label: '混合检索（关键字 + 语义）',
    hint: '同时用关键字与语义召回，按权重融合排序；可调节向量权重（默认）',
  },
  { value: 'vector', label: '向量检索（纯语义）', hint: '只按语义相似度召回，适合口语化提问' },
  { value: 'keyword', label: '关键字检索', hint: '只按关键字匹配召回，适合术语/编号精确查找' },
];

/** 参数来源中文名（命中测试生效参数回显）。 */
export const KB_PARAM_SOURCE_LABELS: Record<string, string> = {
  LIBRARY: '库级设置',
  GLOBAL_DEFAULT: '全局默认',
  REQUEST_OVERRIDE: '本次调参覆盖',
};

/** 空结果策略选项（L-08）。 */
export const KB_EMPTY_RESULT_STRATEGY_OPTIONS: {
  value: KbEmptyResultStrategy;
  label: string;
  hint: string;
}[] = [
  { value: 'SUGGEST', label: '推荐相关问题', hint: '未命中时给出兜底文案与相关问题建议（默认）' },
  { value: 'EMPTY', label: '直接返回空', hint: '未命中时如实告知无结果，不做任何推荐' },
  { value: 'TRANSFER', label: '转人工', hint: '未命中时提示联系人工；需已接入人工通道' },
];

/** 工单状态选项（A-02c）。 */
export const KB_TICKET_STATUS_OPTIONS: { value: KbTicketStatus; label: string }[] = [
  { value: 'open', label: '待处理' },
  { value: 'processing', label: '处理中' },
  { value: 'resolved', label: '已解决' },
  { value: 'closed', label: '已关闭' },
];

/** 工单类型选项（F-10）。 */
export const KB_TICKET_TYPE_OPTIONS: { value: KbTicketType; label: string }[] = [
  { value: 'answer_error', label: '答案错误' },
  { value: 'cite_error', label: '引用错误' },
  { value: 'missing_doc', label: '缺少文档' },
  { value: 'permission', label: '权限问题' },
  { value: 'other', label: '其他' },
];

/** 工单关联动作选项（A-02c）。 */
export const KB_TICKET_REL_ACTION_OPTIONS: { value: KbTicketRelAction; label: string }[] = [
  { value: 'none', label: '无需处理' },
  { value: 'add_doc', label: '补充文档' },
  { value: 'fix_doc', label: '修正文档' },
  { value: 'adjust_acl', label: '调整权限' },
  { value: 'adjust_rag', label: '调整RAG参数' },
];

/** 密级中文名（未知值原样回显）。 */
export function secrecyLabel(secrecy: string | null | undefined): string {
  return KB_SECRECY_OPTIONS.find((o) => o.value === secrecy)?.label ?? secrecy ?? '-';
}

/** 主体类型中文名。 */
export function subjectTypeLabel(subjectType: string | null | undefined): string {
  return KB_SUBJECT_TYPE_OPTIONS.find((o) => o.value === subjectType)?.label ?? subjectType ?? '-';
}

/** ACL 动作中文名。 */
export function aclActionLabel(action: string | null | undefined): string {
  return KB_ACL_ACTION_OPTIONS.find((o) => o.value === action)?.label ?? action ?? '-';
}

/** 工单状态中文名。 */
export function ticketStatusLabel(status: string | null | undefined): string {
  return KB_TICKET_STATUS_OPTIONS.find((o) => o.value === status)?.label ?? status ?? '-';
}

/** 工单类型中文名。 */
export function ticketTypeLabel(type: string | null | undefined): string {
  return KB_TICKET_TYPE_OPTIONS.find((o) => o.value === type)?.label ?? type ?? '-';
}

/** 工单关联动作中文名。 */
export function ticketRelActionLabel(action: string | null | undefined): string {
  return KB_TICKET_REL_ACTION_OPTIONS.find((o) => o.value === action)?.label ?? action ?? '-';
}

/** 空结果策略中文名。 */
export function emptyResultStrategyLabel(strategy: string | null | undefined): string {
  return (
    KB_EMPTY_RESULT_STRATEGY_OPTIONS.find((o) => o.value === strategy)?.label ?? strategy ?? '-'
  );
}

/**
 * 切片方法选项（kb_settings_model_chunk；对齐 RAGFlow `chunk_method`）。
 *
 * <p>与后端 `DocumentChunkConfig.VALID_CHUNK_METHODS` 一一对应，新增码值必须两侧同步。
 */
export const KB_CHUNK_METHOD_OPTIONS: { value: string; label: string }[] = [
  { value: 'naive', label: '通用（Naive）' },
  { value: 'qa', label: '问答对（QA）' },
  { value: 'paper', label: '论文（Paper）' },
  { value: 'book', label: '书籍（Book）' },
  { value: 'laws', label: '法律法规（Laws）' },
  { value: 'presentation', label: '演示文稿（Presentation）' },
  { value: 'table', label: '表格（Table）' },
  { value: 'picture', label: '图片（Picture）' },
  { value: 'one', label: '整篇（One）' },
];

/** 切片方法中文名（未知值原样回显，不吞）。 */
export function chunkMethodLabel(method: string | null | undefined): string {
  if (!method) return '-';
  return KB_CHUNK_METHOD_OPTIONS.find((o) => o.value === method)?.label ?? method;
}

/** 检索方式中文名（未知值原样回显）。 */
export function retrievalMethodLabel(method: string | null | undefined): string {
  return KB_RETRIEVAL_METHOD_OPTIONS.find((o) => o.value === method)?.label ?? method ?? '-';
}

/** 参数来源中文名。 */
export function paramSourceLabel(source: string | null | undefined): string {
  if (!source) return '-';
  return KB_PARAM_SOURCE_LABELS[source] ?? source;
}

/** 解析状态中文名。 */
export function parseStatusLabel(status: string | null | undefined): string {
  switch (status) {
    case 'pending':
      return '待解析';
    case 'parsing':
      return '解析中';
    case 'success':
      return '已就绪';
    case 'failed':
      return '解析失败';
    default:
      return status ?? '-';
  }
}

/** 字节数人类可读化。 */
export function formatSize(size: number | null | undefined): string {
  if (size == null || Number.isNaN(size)) return '-';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(2)} MB`;
}

/** ISO 时间 → 本地可读串。 */
export function formatTime(iso: string | null | undefined): string {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('zh-CN', { hour12: false });
}

// --------------------------------------------------------------- 同义词展示常量（Wave D）

/** 术语组状态筛选项（空串 = 全部，交由 `cleanParams` 剔除）。 */
export const KB_SYNONYM_STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: '全部状态' },
  { value: '1', label: '启用' },
  { value: '0', label: '停用' },
];

/**
 * 四态徽标口径（PRD §5.2-1，四种状态**都必须显式展示**）。
 *
 * <p>`variant` 与 `Badge` 组件的变体一一对应：绿 / 灰 / 蓝 / 黄。
 */
export const KB_SYNONYM_EXPANSION_STATUS_META: Record<
  string,
  { label: string; variant: 'success' | 'secondary' | 'info' | 'warning' }
> = {
  EXPANDED: { label: '已扩展', variant: 'success' },
  NO_MATCH: { label: '未扩展 — 问句未命中任何术语组', variant: 'secondary' },
  DISABLED_REQUEST: { label: '已关闭 — 本次测试临时关闭', variant: 'info' },
  DISABLED_GLOBAL: { label: '已关闭 — 同义词扩展已全局关闭', variant: 'warning' },
};

/** 导入行级动作中文名。 */
export const KB_SYNONYM_IMPORT_ACTION_LABELS: Record<string, string> = {
  CREATE: '新增',
  MERGE: '并入已有组',
  SKIP: '跳过',
};

/** 术语组状态中文名（1 启用 / 0 停用）。 */
export function synonymStatusLabel(status: number | null | undefined): string {
  if (status === 1) return '启用';
  if (status === 0) return '停用';
  return '-';
}

/** 扩展状态徽标文案（未知状态原样回显，不吞）。 */
export function synonymExpansionStatusLabel(status: string | null | undefined): string {
  if (!status) return '-';
  return KB_SYNONYM_EXPANSION_STATUS_META[status]?.label ?? status;
}

/** 导入动作中文名。 */
export function synonymImportActionLabel(action: string | null | undefined): string {
  if (!action) return '-';
  return KB_SYNONYM_IMPORT_ACTION_LABELS[action] ?? action;
}

/**
 * 词条归一化（与后端 `SynonymTermNormalizer.normalize` 同口径）。
 *
 * <p>口径 = `trim` → `NFKC` → `toLowerCase`。**做全半角折叠，不做繁简折叠**
 * —— 设计 §8.1-U4 原定「不折叠」，主理人已推翻并改为 NFKC（PRD v1.1 §4.3 / AC-11）：
 * 新建表无回填负担，而全角「ＯＫＲ」是中文办公从 Word 粘贴的高频场景，
 * 不折叠会让同一个词被存成两组。NFKC 不处理繁简，繁简仍是两个词。
 *
 * <p>⚠️ 此函数必须与后端 `SynonymTermNormalizer.normalize` **逐步骤对齐**。
 * 任何一侧单方面改动都会造成「前端说能存、后端报冲突」（或反之）的假象。
 */
export function normalizeSynonymTerm(raw: string): string {
  return raw.trim().normalize('NFKC').toLowerCase();
}

/** 从当前 pathname 尾段解析数值 ID（KeepAlive 路由无 useParams，详情页统一走这里）。 */
export function parsePathId(pathname: string): number | null {
  const seg = pathname.split('/').filter(Boolean).pop();
  if (!seg) return null;
  const n = Number(seg);
  return Number.isFinite(n) && n > 0 ? n : null;
}
