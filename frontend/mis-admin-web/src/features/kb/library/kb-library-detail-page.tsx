import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft, RefreshCw, Save } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { PageHeader } from '@/components/common/page-header';
import { buildAppBreadcrumbs } from '@/components/common/app-breadcrumbs';
import { PermissionGate } from '@/components/auth/permission-gate';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { SortIndicator } from '@/components/common/sort-indicator';
import { useClientSort } from '@/components/common/use-client-sort';
import { useColumnWidths, type ResizableColumn } from '@/components/common/use-column-widths';
import { RESET_COL_WIDTH_OVERLAY_CLASS, ResetColWidthButton } from '@/components/common/header-action-buttons';
import { EnabledBadge, SecrecyBadge } from '../components/kb-badges';
import { KbWeightSlider } from '../components/kb-weight-slider';
import {
  getLibraryDetail,
  getEngineRef,
  updateRagSettings,
  buildGraph,
  graphBuildStatus,
  buildRaptor,
  raptorBuildStatus,
} from '../api/kb-api';
import { KbDocumentTable } from '../document/kb-document-table';
import { useKbStore } from '../stores/use-kb-store';
import type {
  KbAclSummary,
  KbEngineRef,
  KbGraphStatus,
  KbLibraryDetail,
  KbRagSettings,
  KbRaptorStatus,
} from '../types';
import {
  KB_EMPTY_RESULT_STRATEGY_OPTIONS,
  KB_ENGINE_SYNC_STATUS_META,
  KB_RETRIEVAL_METHOD_OPTIONS,
  aclActionLabel,
  engineSyncStatusLabel,
  formatTime,
  parsePathId,
  subjectTypeLabel,
} from '../types';

const fieldLabel = 'mb-[0.4rem] block text-sm font-medium text-foreground';
const selectClass =
  'h-9 w-full rounded-md border border-input bg-card px-[0.7rem] text-sm text-foreground shadow-none';

/** 默认向量相似度权重，与后端 `RagSettings.DEFAULT_VECTOR_SIMILARITY_WEIGHT` 一致。 */
const DEFAULT_WEIGHT = 0.3;

/** RAG 设置表单模型（数值走字符串，提交时再归一，避免受控 input 清空即变 0）。 */
interface RagForm {
  topK: string;
  scoreThreshold: string;
  rerank: boolean;
  embeddingModel: string;
  retrievalMethod: string;
  chunkMethod: string;
  chunkTokenNum: string;
  separator: string;
  emptyResultStrategy: string;
  /** 权重是滑条驱动的，天生就是合法数值，不需要走字符串中转。 */
  vectorSimilarityWeight: number;
  /**
   * 库级重排模型 id（kb_settings_model_chunk）。
   *
   * <p>空串 = 继承全局 `mis.kb.engine.rerank-model-id`；非空 = 本库固定使用该模型。
   * 由模型池下拉选择（不自建配置），池不可用时回落仅「继承全局」。
   */
  rerankModelId: string;
  /**
   * OCR 开关（企业级增强一期 KE-06，末位追加）。
   *
   * <p>当前引擎不支持（`parserOcrSupported=false`）时置灰 + 提示，但值仍可回显、
   * 保存照常成功（后端只落库不下发）。
   */
  ocrEnabled: boolean;
  /** OCR 语言码值 zh/en/zh_en（KE-06）；非法值由后端回落 zh。 */
  ocrLanguage: string;
  /** 分块重叠 token 数（KE-07）；空串 = 引擎默认/0。 */
  chunkOverlapTokenNum: string;
  /**
   * 知识图谱开关（Wave B GraphRAG PoC，T02，末位追加）。
   *
   * <p>默认 `false`；能力 `graphSupported=false` 时置灰 + 提示。保存时后端做
   * 能力/上限强制（`KB_GRAPH_LIBRARY_LIMIT`）。false→true 保存后后端自动触发构图，
   * 返回的设置里 `kgBuildStatus` 会反映 `building`（前端据此开始 3s 轮询）。
   */
  useKnowledgeGraph: boolean;
  /**
   * RAPTOR 摘要开关（Wave C RAPTOR，T02，末位追加）。
   *
   * <p>默认 `false`；能力 `raptorSupported=false` 时置灰 + 提示。保存时后端做
   * 能力强制（U4 无库数上限）。false→true 保存后后端自动触发建树，
   * 返回的设置里 `raptorBuildStatus` 会反映 `building`（前端据此开始 3s 轮询）。
   */
  useRaptor: boolean;
  /** RAPTOR 摘要 chunk 最大 token 数 [512,2048]（空串 = 继承默认 1024）。 */
  raptorMaxTokenNum: string;
  /** RAPTOR 聚类相似度阈值 [0,1]（空串 = 继承默认 0.1）。 */
  raptorThreshold: string;
  /** RAPTOR 最大聚类数 [1,1024]（空串 = 继承默认 64）。 */
  raptorMaxCluster: string;
  /** RAPTOR 递归摘要提示词（≤2000；留空 = 引擎默认官方 prompt）。 */
  raptorPrompt: string;
  /**
   * 页码索引 / TOC 提取开关（解析器增量，末位追加）。
   *
   * <p>对应 RAGFlow `parser_config.toc_extraction`，默认开（true）。
   * 与 OCR/overlap 不同：本开关<b>参与引擎下发</b>（每次 PUT 恒带），非只落库。
   */
  pageIndex: boolean;
  /** 图像与表格上下文窗口 token 数 [1,4096]（空串 = 继承默认 256）。 */
  imageTableContextWindow: string;
  /**
   * 重叠百分比 [0,100]（T1 切片参数对齐，末位追加）。
   *
   * <p>空串 = 关闭（0）。当前引擎不支持（`parserOverlapSupported=false`）时置灰 +
   * 提示「当前引擎版本暂不支持，参数已保留待引擎升级生效」，但值仍可回显、
   * 保存照常成功（后端只落库不下发）。
   */
  overlapPercent: string;
  /** 自动关键字提取数量 [0,32]（T1；0 = 关闭，空串 = 默认 0）。 */
  autoKeywords: string;
  /** 自动问题提取数量 [0,10]（T1；0 = 关闭，空串 = 默认 0）。 */
  autoQuestions: string;
}

const EMPTY_RAG_FORM: RagForm = {
  topK: '',
  scoreThreshold: '',
  rerank: false,
  embeddingModel: '',
  retrievalMethod: 'hybrid',
  chunkMethod: 'naive',
  chunkTokenNum: '',
  separator: '',
  emptyResultStrategy: 'SUGGEST',
  vectorSimilarityWeight: DEFAULT_WEIGHT,
  rerankModelId: '',
  ocrEnabled: false,
  ocrLanguage: 'zh',
  chunkOverlapTokenNum: '',
  useKnowledgeGraph: false,
  useRaptor: false,
  raptorMaxTokenNum: '',
  raptorThreshold: '',
  raptorMaxCluster: '',
  raptorPrompt: '',
  pageIndex: true,
  imageTableContextWindow: '',
  overlapPercent: '',
  autoKeywords: '',
  autoQuestions: '',
};

/** 切片相关字段：这几个改了才需要弹重解析引导（WA-10）。
 *  解析器增量两键（pageIndex/imageTableContextWindow）同为解析期配置，加入后
 *  任一变化即触发「重解析引导」，且仅在<b>相对基线确有改动</b>时弹（post-save baseline
 *  重建），不会「每次保存都弹」。 */
const CHUNK_FIELDS = [
  'chunkMethod',
  'chunkTokenNum',
  'separator',
  'pageIndex',
  'imageTableContextWindow',
  'overlapPercent',
  'autoKeywords',
  'autoQuestions',
] as const;

/** 后端设置 → 表单。 */
function toForm(s: KbRagSettings | null | undefined): RagForm {
  if (!s) return { ...EMPTY_RAG_FORM };
  return {
    topK: s.topK == null ? '' : String(s.topK),
    scoreThreshold: s.scoreThreshold == null ? '' : String(s.scoreThreshold),
    rerank: s.rerank === true,
    embeddingModel: s.embeddingModel ?? '',
    retrievalMethod: s.retrievalMethod ?? 'hybrid',
    chunkMethod: s.chunkMethod ?? 'naive',
    chunkTokenNum: s.chunkTokenNum == null ? '' : String(s.chunkTokenNum),
    separator: s.separator ?? '',
    emptyResultStrategy: s.emptyResultStrategy ?? 'SUGGEST',
    vectorSimilarityWeight: s.vectorSimilarityWeight ?? DEFAULT_WEIGHT,
    rerankModelId: s.rerankModelId ?? '',
    ocrEnabled: s.ocrEnabled === true,
    ocrLanguage: s.ocrLanguage ?? 'zh',
    chunkOverlapTokenNum: s.chunkOverlapTokenNum == null ? '' : String(s.chunkOverlapTokenNum),
    useKnowledgeGraph: s.useKnowledgeGraph === true,
    useRaptor: s.useRaptor === true,
    raptorMaxTokenNum: s.raptorMaxTokenNum == null ? '' : String(s.raptorMaxTokenNum),
    raptorThreshold: s.raptorThreshold == null ? '' : String(s.raptorThreshold),
    raptorMaxCluster: s.raptorMaxCluster == null ? '' : String(s.raptorMaxCluster),
    raptorPrompt: s.raptorPrompt ?? '',
    // 解析器增量（T01）：pageIndex null/true 都按默认开（后端 withDefaults 兜底 true）；
    // imageTableContextWindow null → ''（表单留空 = 后端默认 256）
    pageIndex: s.pageIndex !== false,
    imageTableContextWindow:
      s.imageTableContextWindow == null ? '' : String(s.imageTableContextWindow),
    // 切片参数对齐（T1）：null → ''（表单留空 = 后端默认 0/0/0）；
    // overlapPercent 支持小数但不建议（0~100，后端只落库不下发）
    overlapPercent: s.overlapPercent == null ? '' : String(s.overlapPercent),
    autoKeywords: s.autoKeywords == null ? '' : String(s.autoKeywords),
    autoQuestions: s.autoQuestions == null ? '' : String(s.autoQuestions),
  };
}

/**
 * 表单 → 后端设置；空串一律归 null（表示「用引擎默认」，而不是 0 / 空字符串）。
 *
 * <p>`vectorSimilarityWeight` **无条件提交**，即使当前不是 hybrid——
 * 后端保存路径明确不覆写它（主理人约束②），这样用户「设 0.4 → 切 vector 保存 →
 * 再切回 hybrid」时权重仍是 0.4。若这里按检索方式清成 null，那条约束就白写了。
 */
function toSettings(f: RagForm): KbRagSettings {
  const topK = Number(f.topK);
  const threshold = Number(f.scoreThreshold);
  const tokenNum = Number(f.chunkTokenNum);
  return {
    topK: f.topK.trim() !== '' && Number.isFinite(topK) && topK > 0 ? Math.trunc(topK) : null,
    scoreThreshold:
      f.scoreThreshold.trim() !== '' && Number.isFinite(threshold) ? threshold : null,
    rerank: f.rerank,
    embeddingModel: f.embeddingModel.trim() || null,
    retrievalMethod: f.retrievalMethod.trim() || null,
    chunkMethod: f.chunkMethod.trim() || null,
    chunkTokenNum:
      f.chunkTokenNum.trim() !== '' && Number.isFinite(tokenNum) && tokenNum >= 256 && tokenNum <= 4096
        ? Math.trunc(tokenNum)
        : null,
    // separator 允许是纯空白（如换行符），只在完全为空串时归 null
    separator: f.separator === '' ? null : f.separator,
    emptyResultStrategy: f.emptyResultStrategy || null,
    vectorSimilarityWeight: f.vectorSimilarityWeight,
    // 库级重排模型：空串 → null（继承全局），非空原样提交（不自建配置，来自模型池下拉）
    rerankModelId: f.rerankModelId.trim() || null,
    // OCR/overlap（KE-06/KE-07）：值一律随保存提交；能力不支持时后端只落库不下发
    ocrEnabled: f.ocrEnabled,
    ocrLanguage: f.ocrLanguage.trim() || 'zh',
    chunkOverlapTokenNum:
      f.chunkOverlapTokenNum.trim() !== '' && Number.isFinite(Number(f.chunkOverlapTokenNum))
        ? Math.max(0, Math.trunc(Number(f.chunkOverlapTokenNum)))
        : null,
    // 图谱开关（Wave B GraphRAG PoC，T02）：随保存提交；kgBuildStatus/kgBuildMessage
    // 由服务端维护，前端不提交（后端忽略或仅回显）
    useKnowledgeGraph: f.useKnowledgeGraph,
    // RAPTOR（Wave C，T02）：开关随保存提交；raptorBuildStatus/raptorBuildMessage
    // 由服务端维护，前端不提交。参数空串归 null = 继承引擎默认（range 前端已拦，
    // 后端 validate() 再兜底）。⚠ U6：不发送 random_seed 键（引擎字段名）。
    useRaptor: f.useRaptor,
    raptorMaxTokenNum:
      f.raptorMaxTokenNum.trim() !== '' && Number.isFinite(Number(f.raptorMaxTokenNum))
        ? Math.trunc(Number(f.raptorMaxTokenNum))
        : null,
    raptorThreshold:
      f.raptorThreshold.trim() !== '' && Number.isFinite(Number(f.raptorThreshold))
        ? Number(f.raptorThreshold)
        : null,
    raptorMaxCluster:
      f.raptorMaxCluster.trim() !== '' && Number.isFinite(Number(f.raptorMaxCluster))
        ? Math.trunc(Number(f.raptorMaxCluster))
        : null,
    raptorPrompt: f.raptorPrompt.trim() || null,
    // 解析器增量（T01）：pageIndex 恒提交布尔（toc_extraction 默认开）；
    // imageTableContextWindow 空串 → null（引擎默认 256），有值 → 整数（[1,4096] 由
    // 前端校验 + 后端 validate() 双兜底）
    pageIndex: f.pageIndex,
    imageTableContextWindow:
      f.imageTableContextWindow.trim() !== '' && Number.isFinite(Number(f.imageTableContextWindow))
        ? Math.trunc(Number(f.imageTableContextWindow))
        : null,
    // 切片参数对齐（T1）：overlapPercent 空串 → null（默认 0，只落库不下发）；
    // autoKeywords/autoQuestions 空串 → null（默认 0，随每次 PUT 恒下发）
    overlapPercent:
      f.overlapPercent.trim() !== '' && Number.isFinite(Number(f.overlapPercent))
        ? Number(f.overlapPercent)
        : null,
    autoKeywords:
      f.autoKeywords.trim() !== '' && Number.isFinite(Number(f.autoKeywords))
        ? Math.trunc(Number(f.autoKeywords))
        : null,
    autoQuestions:
      f.autoQuestions.trim() !== '' && Number.isFinite(Number(f.autoQuestions))
        ? Math.trunc(Number(f.autoQuestions))
        : null,
  };
}

/** 切片参数是否相对基线有改动。 */
function chunkDirty(current: RagForm, baseline: RagForm | null): boolean {
  if (!baseline) return false;
  return CHUNK_FIELDS.some((k) => current[k] !== baseline[k]);
}

/**
 * 知识库详情页（L-06 + L-08，Wave A 增强 WA-04/06/10/12）。
 *
 * <p>四 Tab：基本信息 / 文档 / 授权范围 / RAG 设置。首屏用 `/kb/libraries/{id}/detail`
 * 一次性拉全（元信息 + 文档数 + ACL 摘要 + RAG 设置），避免各 Tab 各打一次接口。
 * 文档 Tab 复用 {@link KbDocumentTable}（与文档管理页同一份列表 UI），就地传 `libraryId`
 * 过滤，不另造列表。
 *
 * <p>路由 ID 从 `pathname` 尾段解析而非 `useParams`：本应用页面由 KeepAliveOutlet
 * 按路径直挂，Route 只登记了 `/kb/*` 通配，`useParams` 在这里恒为空对象。
 */
export function KbLibraryDetailPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const libraryId = useMemo(() => parsePathId(location.pathname), [location.pathname]);

  const [detail, setDetail] = useState<KbLibraryDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState<RagForm>(EMPTY_RAG_FORM);
  /** 上次保存/加载后的基线，用于判断切片参数是否 dirty。 */
  const [baseline, setBaseline] = useState<RagForm | null>(null);
  const [saving, setSaving] = useState(false);
  /** 保存成功后是否展示重解析引导（WA-10）。 */
  const [showReparseHint, setShowReparseHint] = useState(false);
  /** 图谱构建状态（Wave B GraphRAG PoC，T02）：轮询刷新 + 手动触发后本地态。 */
  const [graphStatus, setGraphStatus] = useState<KbGraphStatus | null>(null);
  /** 图谱构建按钮 in-flight（防止连点重复触发；后端另有 building 状态机拒绝）。 */
  const [graphTriggering, setGraphTriggering] = useState(false);
  /**
   * 引擎引用（Q4 有限暴露 dataset id）。独立于 detail 拉取：`engine-ref` 需额外权限
   * （`kb:library:engine-ref:view`）+ 每次读审计，无权限 403 / 后端异常时 catch 保持 null，
   * 基本信息 Tab 降级展示 `-`，不允许未捕获异常打断详情页。
   */
  const [engineRef, setEngineRef] = useState<KbEngineRef | null>(null);

  /* 授权范围表：列宽 + 排序（当前库 ACL 一次性加载） */
  const DETAIL_ACL_COLS = useMemo<ResizableColumn[]>(
    () => [
      { key: 'subjectType', label: '主体类型' },
      { key: 'subjectName', label: '主体名称' },
      { key: 'subjectId', label: '主体 ID' },
      { key: 'action', label: '权限' },
    ],
    [],
  );
  const { widthOf, startResize, hasCustom, reset } = useColumnWidths(DETAIL_ACL_COLS, 'mis-kb-detail-acl-table-widths');
  const aclRows = detail?.aclSummary ?? [];
  const getSortValue = useCallback((row: KbAclSummary, key: string) => row[key as keyof KbAclSummary], []);
  const { sorted: sortedAcls, sortKey, sortDir, toggleSort } = useClientSort(aclRows, getSortValue);

  const capabilities = useKbStore((s) => s.capabilities);
  const refreshEngine = useKbStore((s) => s.refreshEngine);
  // kb_settings_model_chunk：模型池（嵌入/重排下拉数据源）。可用才展示下拉；
  // 不可用/未加载一律按「不可判定」回落自由文本/仅继承全局（设计 §8-6 降级语义）。
  const modelPool = useKbStore((s) => s.modelPool);
  const refreshModels = useKbStore((s) => s.refreshModels);
  const embeddingPool = modelPool?.available === true ? modelPool.embedding ?? [] : null;
  const rerankPool = modelPool?.available === true ? modelPool.rerank ?? [] : null;
  const globalRerankModelId =
    modelPool?.available === true ? modelPool.globalRerankModelId ?? '' : '';
  const poolDegraded = modelPool != null && modelPool.available !== true;
  // QA P2-A：原写法 `!== false` 在能力未拉到 / 返回 null 时推导为 true，属 fail-open。
  // 现改 `=== true`——能力未确认即置灰，与后端保存期强制关闭 rerank 的口径一致。
  const rerankSupported = capabilities?.rerankSupported === true;
  // 同 rerankSupported：fail-safe，能力未确认即置灰（QA P2-A）。检索方式选择器据此
  // 临时禁用 hybrid 选项并提示，但已保存的 hybrid 配置仍照常回显、权重滑条照常显示。
  const hybridSupported = capabilities?.hybridSupported === true;
  // KE-06/KE-07：OCR/overlap 能力（fail-safe，未确认即置灰）。当前 RAGFlow 实测不支持，
  // 置灰 + 提示「暂不生效」，但保存照常成功（只落库，引擎升级后翻转能力即放行下发）。
  const ocrSupported = capabilities?.parserOcrSupported === true;
  const overlapSupported = capabilities?.parserOverlapSupported === true;
  // T3：toc / imageTable 能力闸门（fail-safe）。本实例 T0 实测不支持 → 默认置灰；
  // 误开硬下发会拒整单并阻断 auto_keywords/auto_questions 同步。
  const tocSupported = capabilities?.parserTocSupported === true;
  const imageTableContextSupported = capabilities?.parserImageTableContextSupported === true;
  // Wave B GraphRAG PoC（T02）：图谱能力（fail-safe，未确认即置灰）。RAGFlow 实例
  // T00 实测支持（graphSupported=true），故开关可开；引擎升级破坏契约时翻转能力即置灰。
  const graphSupported = capabilities?.graphSupported === true;
  // 图谱状态：轮询结果优先，否则回退库设置（detail.ragSettings 由后端维护）。
  // 保存后返回的设置里 kgBuildStatus=building 会驱动下方 3s 轮询自动启动。
  const kgBuildStatus =
    graphStatus?.kgBuildStatus ?? detail?.ragSettings?.kgBuildStatus ?? 'none';
  const kgBuildMessage =
    graphStatus?.kgBuildMessage ?? detail?.ragSettings?.kgBuildMessage ?? null;
  const isBuilding = kgBuildStatus === 'building';
  const graphStatusLabel = useMemo(() => {
    switch (kgBuildStatus) {
      case 'building':
        return '构建中';
      case 'ready':
        return '已就绪';
      case 'failed':
        return '构建失败';
      default:
        return '未构建';
    }
  }, [kgBuildStatus]);
  // Wave C RAPTOR（T02）：构建状态 + 3s 轮询 + 手动触发，与图谱同款范式。
  // U4 无库数上限：开关只受平台总开关 mis.kb.engine.raptor-enabled + 能力闸门。
  const raptorSupported = capabilities?.raptorSupported === true;
  /** RAPTOR 构建状态（轮询结果优先，否则回退库设置；服务端维护）。 */
  const [raptorStatus, setRaptorStatus] = useState<KbRaptorStatus | null>(null);
  /** RAPTOR 构建按钮 in-flight（防止连点重复触发；后端另有 building 状态机拒绝）。 */
  const [raptorTriggering, setRaptorTriggering] = useState(false);
  const currentRaptorBuildStatus =
    raptorStatus?.raptorBuildStatus ?? detail?.ragSettings?.raptorBuildStatus ?? 'none';
  const raptorBuildMessage =
    raptorStatus?.raptorBuildMessage ?? detail?.ragSettings?.raptorBuildMessage ?? null;
  const isRaptorBuilding = currentRaptorBuildStatus === 'building';
  const raptorStatusLabel = useMemo(() => {
    switch (currentRaptorBuildStatus) {
      case 'building':
        return '构建中';
      case 'ready':
        return '已就绪';
      case 'failed':
        return '构建失败';
      default:
        return '未构建';
    }
  }, [currentRaptorBuildStatus]);
  const isHybrid = form.retrievalMethod === 'hybrid';
  // 全局重排模型友好名：池内按 id 反查 name，查不到原样回显 id（不吞）。
  const globalRerankName =
    (rerankPool ?? []).find((m) => m.id === globalRerankModelId)?.name ?? globalRerankModelId;

  const load = useCallback(async (id: number) => {
    setLoading(true);
    setEngineRef(null);
    try {
      // 详情与引擎引用（dataset id）并行拉取；engine-ref 无权限 403 / 异常时
      // 单请求降级为 null，不能因引用查询失败打断整个详情页
      const [d, ref] = await Promise.all([
        getLibraryDetail(id),
        getEngineRef(id).catch(() => null),
      ]);
      setDetail(d);
      setEngineRef(ref);
      const next = toForm(d.ragSettings);
      setForm(next);
      setBaseline(next);
      setShowReparseHint(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '加载知识库详情失败');
      setDetail(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (libraryId == null) return;
    void load(libraryId);
  }, [libraryId, load]);

  useEffect(() => {
    if (!capabilities) void refreshEngine();
  }, [capabilities, refreshEngine]);

  // kb_settings_model_chunk：模型池下拉数据，打开页即拉一次（60s TTL 内后端不重打引擎）
  useEffect(() => {
    if (modelPool == null) void refreshModels();
  }, [modelPool, refreshModels]);

  async function onSaveSettings(): Promise<void> {
    if (libraryId == null) return;
    // chunkTokenNum 范围 [256, 4096]：越界直接拦截（空值 = 继承默认 4096，不拦）
    const tokenRaw = form.chunkTokenNum.trim();
    if (tokenRaw !== '') {
      const tokenNum = Number(tokenRaw);
      if (!Number.isFinite(tokenNum) || tokenNum < 256 || tokenNum > 4096) {
        toast.warning('切片长度需在 256 ~ 4096 之间（留空则继承默认 4096）');
        return;
      }
    }
    // KE-07：overlap 为非负整数（空值 = 引擎默认/0）
    const overlapRaw = form.chunkOverlapTokenNum.trim();
    if (overlapRaw !== '') {
      const overlap = Number(overlapRaw);
      if (!Number.isFinite(overlap) || overlap < 0 || !Number.isInteger(overlap)) {
        toast.warning('分块重叠需为非负整数（留空 = 引擎默认/0）');
        return;
      }
    }
    // 解析器增量（T01）：图像/表格上下文窗口为正整数且 ≤4096（空值 = 继承默认 256）
    const imgTableWindowRaw = form.imageTableContextWindow.trim();
    if (imgTableWindowRaw !== '') {
      const imgTableWindow = Number(imgTableWindowRaw);
      if (!Number.isFinite(imgTableWindow) || imgTableWindow < 1 || imgTableWindow > 4096) {
        toast.warning('图像与表格上下文窗口需在 1 ~ 4096 之间（留空则继承默认 256）');
        return;
      }
    }
    // 切片参数对齐（T1）：overlapPercent ∈ [0,100]；autoKeywords ∈ [0,32]；
    // autoQuestions ∈ [0,10]——越界直接拦截（0 合法 = 关闭；留空 = 默认 0）。
    const overlapPercentRaw = form.overlapPercent.trim();
    if (overlapPercentRaw !== '') {
      const overlapPercent = Number(overlapPercentRaw);
      if (!Number.isFinite(overlapPercent) || overlapPercent < 0 || overlapPercent > 100) {
        toast.warning('重叠百分比需在 0 ~ 100 之间（留空则默认 0 = 关闭）');
        return;
      }
    }
    const autoKeywordsRaw = form.autoKeywords.trim();
    if (autoKeywordsRaw !== '') {
      const autoKeywords = Number(autoKeywordsRaw);
      if (
        !Number.isFinite(autoKeywords) ||
        autoKeywords < 0 ||
        autoKeywords > 32 ||
        !Number.isInteger(autoKeywords)
      ) {
        toast.warning('自动关键字数量需为 0 ~ 32 的整数（0 = 关闭）');
        return;
      }
    }
    const autoQuestionsRaw = form.autoQuestions.trim();
    if (autoQuestionsRaw !== '') {
      const autoQuestions = Number(autoQuestionsRaw);
      if (
        !Number.isFinite(autoQuestions) ||
        autoQuestions < 0 ||
        autoQuestions > 10 ||
        !Number.isInteger(autoQuestions)
      ) {
        toast.warning('自动问题数量需为 0 ~ 10 的整数（0 = 关闭）');
        return;
      }
    }
    // Wave C RAPTOR（T02）：参数区间校验（[512,2048]/[0,1]/[1,1024]/≤2000；
    // 空值 = 继承引擎默认，不拦）。越界直接拦截，与后端 validate() 同口径。
    const raptorTokenRaw = form.raptorMaxTokenNum.trim();
    if (raptorTokenRaw !== '') {
      const raptorToken = Number(raptorTokenRaw);
      if (!Number.isFinite(raptorToken) || raptorToken < 512 || raptorToken > 2048) {
        toast.warning('RAPTOR 摘要 token 数需在 512 ~ 2048 之间（留空则继承默认 1024）');
        return;
      }
    }
    const raptorThresholdRaw = form.raptorThreshold.trim();
    if (raptorThresholdRaw !== '') {
      const raptorThreshold = Number(raptorThresholdRaw);
      if (!Number.isFinite(raptorThreshold) || raptorThreshold < 0 || raptorThreshold > 1) {
        toast.warning('RAPTOR 聚类阈值需在 0 ~ 1 之间（留空则继承默认 0.1）');
        return;
      }
    }
    const raptorClusterRaw = form.raptorMaxCluster.trim();
    if (raptorClusterRaw !== '') {
      const raptorCluster = Number(raptorClusterRaw);
      if (!Number.isFinite(raptorCluster) || raptorCluster < 1 || raptorCluster > 1024) {
        toast.warning('RAPTOR 最大聚类数需在 1 ~ 1024 之间（留空则继承默认 64）');
        return;
      }
    }
    const raptorPromptRaw = form.raptorPrompt.trim();
    if (raptorPromptRaw.length > 2000) {
      toast.warning('RAPTOR 递归摘要提示词长度不能超过 2000 字符');
      return;
    }
    const needReparseHint = chunkDirty(form, baseline);
    setSaving(true);
    try {
      const saved = await updateRagSettings(libraryId, toSettings(form));
      const next = toForm(saved);
      setForm(next);
      setBaseline(next);
      setDetail((prev) => (prev == null ? prev : { ...prev, ragSettings: saved }));
      setShowReparseHint(needReparseHint);
      toast.success('已保存并同步引擎');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '保存失败');
    } finally {
      setSaving(false);
    }
  }

  /**
   * 手动触发图谱构建（Wave B GraphRAG PoC，T02）。
   *
   * <p>按钮在 `building` 态禁用（后端状态机同样拒绝重复触发，双保险）；
   * `none`/`failed` 可点（首次构建/失败重试），`ready` 可点（重新构建）。
   * 触发成功后把本地状态置 `building`，由下方 3s 轮询接管直到 `ready`/`failed`。
   */
  async function onBuildGraph(): Promise<void> {
    if (libraryId == null) return;
    setGraphTriggering(true);
    try {
      const result = await buildGraph(libraryId);
      const nextStatus: KbGraphStatus = {
        kgBuildStatus: result.kgBuildStatus,
        kgBuildMessage: null,
        graphragTaskId: result.taskId,
        updatedAt: null,
      };
      setGraphStatus(nextStatus);
      // 同步库设置里的状态（保证开关区与徽标一致；detail.ragSettings 由后端维护）
      setDetail((prev) =>
        prev == null || prev.ragSettings == null
          ? prev
          : { ...prev, ragSettings: { ...prev.ragSettings, kgBuildStatus: result.kgBuildStatus } },
      );
      toast.success('图谱构建已排队，构建完成后状态自动更新');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '触发图谱构建失败');
    } finally {
      setGraphTriggering(false);
    }
  }

  /**
   * 手动触发 RAPTOR 建树（Wave C RAPTOR，T02）。
   *
   * <p>按钮在 `building` 态禁用（后端状态机同样拒绝重复触发，双保险）；
   * `none`/`failed` 可点（首次构建/失败重试），`ready` 可点（重新构建）。
   * 触发成功后把本地状态置 `building`，由下方 3s 轮询接管直到 `ready`/`failed`。
   */
  async function onBuildRaptor(): Promise<void> {
    if (libraryId == null) return;
    setRaptorTriggering(true);
    try {
      const result = await buildRaptor(libraryId);
      const nextStatus: KbRaptorStatus = {
        raptorBuildStatus: result.raptorBuildStatus,
        raptorBuildMessage: null,
        raptorTaskId: result.taskId,
        updatedAt: null,
      };
      setRaptorStatus(nextStatus);
      // 同步库设置里的状态（保证开关区与徽标一致；detail.ragSettings 由后端维护）
      setDetail((prev) =>
        prev == null || prev.ragSettings == null
          ? prev
          : {
              ...prev,
              ragSettings: {
                ...prev.ragSettings,
                raptorBuildStatus: result.raptorBuildStatus,
              },
            },
      );
      toast.success('RAPTOR 建树已排队，构建完成后状态自动更新');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '触发 RAPTOR 建树失败');
    } finally {
      setRaptorTriggering(false);
    }
  }

  // building 态每 3s 轮询 build-status，直到 ready/failed（PoC 不引入后端定时任务，
  // 轮询走前端；R6 漂移防线：轮询失败保留当前状态，下轮再试）。
  useEffect(() => {
    if (libraryId == null) return;
    if (!isBuilding) return;
    const timer = window.setInterval(() => {
      graphBuildStatus(libraryId)
        .then((s) => {
          setGraphStatus(s);
          // 同步 detail（保存后 detail.ragSettings 也反映最新状态）
          setDetail((prev) =>
            prev == null || prev.ragSettings == null
              ? prev
              : {
                  ...prev,
                  ragSettings: {
                    ...prev.ragSettings,
                    kgBuildStatus: s.kgBuildStatus,
                    kgBuildMessage: s.kgBuildMessage,
                  },
                },
          );
        })
        .catch(() => {
          // 轮询失败静默，下轮再试；不打断用户操作
        });
    }, 3000);
    return () => window.clearInterval(timer);
  }, [libraryId, isBuilding]);

  // Wave C RAPTOR（T02）：building 态每 3s 轮询 raptor build-status，直到
  // ready/failed（对齐图谱轮询范式；R6 漂移防线：轮询失败保留当前状态，下轮再试）。
  useEffect(() => {
    if (libraryId == null) return;
    if (!isRaptorBuilding) return;
    const timer = window.setInterval(() => {
      raptorBuildStatus(libraryId)
        .then((s) => {
          setRaptorStatus(s);
          // 同步 detail（保存后 detail.ragSettings 也反映最新状态）
          setDetail((prev) =>
            prev == null || prev.ragSettings == null
              ? prev
              : {
                  ...prev,
                  ragSettings: {
                    ...prev.ragSettings,
                    raptorBuildStatus: s.raptorBuildStatus,
                    raptorBuildMessage: s.raptorBuildMessage,
                  },
                },
          );
        })
        .catch(() => {
          // 轮询失败静默，下轮再试；不打断用户操作
        });
    }, 3000);
    return () => window.clearInterval(timer);
  }, [libraryId, isRaptorBuilding]);

  if (libraryId == null) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <Alert variant="destructive">
          <AlertTitle>路径无效</AlertTitle>
          <AlertDescription>未能从当前地址解析出知识库 ID。</AlertDescription>
        </Alert>
      </div>
    );
  }

  const meta = detail?.meta ?? null;
  const acls: KbAclSummary[] = detail?.aclSummary ?? [];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title={meta?.name ? `知识库 · ${meta.name}` : `知识库 #${libraryId}`}
        description="查看知识库元信息与授权范围，并调整检索（RAG）参数；保存后即时同步到引擎。"
        breadcrumbs={buildAppBreadcrumbs({
          app: 'kb',
          title: meta?.name ?? '知识库详情',
          appTo: '/kb/libraries',
        })}
        actions={
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => navigate('/kb/libraries')}>
              <ArrowLeft className="h-4 w-4" />
              返回列表
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={loading}
              onClick={() => void load(libraryId)}
            >
              <RefreshCw className="h-4 w-4" />
              刷新
            </Button>
          </div>
        }
      />

      <Tabs defaultValue="meta" className="flex min-h-0 flex-1 flex-col">
        <TabsList>
          <TabsTrigger value="meta">基本信息</TabsTrigger>
          <TabsTrigger value="docs">文档（{detail?.docCount ?? 0}）</TabsTrigger>
          <TabsTrigger value="acls">授权范围（{acls.length}）</TabsTrigger>
          <TabsTrigger value="rag">RAG 设置</TabsTrigger>
        </TabsList>

        {/* ---------------------------------------------------------- 基本信息 */}
        <TabsContent value="meta" className="min-h-0 flex-1 overflow-auto">
          {loading ? (
            <p className="p-6 text-sm text-muted-foreground">加载中…</p>
          ) : meta == null ? (
            <p className="p-6 text-sm text-muted-foreground">未找到知识库</p>
          ) : (
            <dl className="grid grid-cols-1 gap-x-6 gap-y-3 rounded-lg border bg-card p-4 sm:grid-cols-2">
              <MetaRow label="知识库 ID" value={<span className="font-mono">{meta.id}</span>} />
              <MetaRow label="名称" value={meta.name} />
              <MetaRow label="密级" value={<SecrecyBadge secrecy={meta.secrecy} />} />
              <MetaRow label="状态" value={<EnabledBadge enabled={meta.status} />} />
              <MetaRow label="所属分类" value={meta.categoryId ?? '-'} />
              <MetaRow label="责任人" value={meta.owner ?? '-'} />
              <MetaRow
                label="文档数"
                value={<span className="tabular-nums">{detail?.docCount ?? meta.docCount ?? 0}</span>}
              />
              <MetaRow
                label="建库引擎"
                value={<Badge variant="outline">{meta.engineType ?? '未知'}</Badge>}
              />
              <MetaRow
                label="RAGFlow Dataset ID"
                value={
                  <span className="flex min-w-0 items-center gap-2">
                    <span
                      className="min-w-0 flex-1 truncate font-mono"
                      title="引擎侧原生 dataset id，运维据此在引擎控制台定位"
                    >
                      {engineRef?.engineLibraryRef ?? '-'}
                    </span>
                    {engineRef?.engineSyncStatus != null ? (
                      <Badge
                        variant={
                          KB_ENGINE_SYNC_STATUS_META[engineRef.engineSyncStatus]?.variant ??
                          'secondary'
                        }
                        title={KB_ENGINE_SYNC_STATUS_META[engineRef.engineSyncStatus]?.hint}
                        className="shrink-0"
                      >
                        {engineSyncStatusLabel(engineRef.engineSyncStatus)}
                      </Badge>
                    ) : null}
                  </span>
                }
              />
              <MetaRow label="创建时间" value={formatTime(meta.createdAt)} />
              <MetaRow label="更新时间" value={formatTime(meta.updatedAt)} />
            </dl>
          )}
        </TabsContent>

        {/* ---------------------------------------------------------- 文档（L-06） */}
        <TabsContent value="docs" className="min-h-0 flex-1">
          <KbDocumentTable
            libraryId={libraryId}
            showUpload
            fill
            librarySettings={detail?.ragSettings ?? null}
          />
        </TabsContent>

        {/* ---------------------------------------------------------- 授权范围 */}
        <TabsContent value="acls" className="min-h-0 flex-1">
          <div className="relative h-full min-h-0 overflow-auto rounded-lg border bg-table-surface">
            {hasCustom ? (
              <ResetColWidthButton onClick={reset} className={RESET_COL_WIDTH_OVERLAY_CLASS} />
            ) : null}
            <table className="w-full table-fixed border-separate border-spacing-0 bg-table-surface text-left text-sm">
              <thead className="border-b-2 border-foreground/20 bg-table-header text-muted-foreground">
                <tr>
                  {DETAIL_ACL_COLS.map((c, ci) => {
                    const active = sortKey === c.key;
                    return (
                      <th
                        key={c.key}
                        style={{ width: widthOf(c.key) }}
                        aria-sort={active ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
                        className={cn(
                          'overflow-hidden whitespace-nowrap px-3 py-2 font-bold',
                          ci > 0 && 'border-l border-border/60',
                        )}
                      >
                        <button
                          type="button"
                          onClick={() => toggleSort(c.key)}
                          className={cn(
                            'flex w-full items-center gap-1 text-left font-bold',
                            active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
                          )}
                        >
                          {c.label}
                          <SortIndicator state={active ? sortDir : 'none'} />
                        </button>
                        <span
                          role="separator"
                          aria-label={`调整${c.label}列宽`}
                          onMouseDown={(e) => startResize(e, c.key)}
                          className="absolute right-0 top-0 h-full w-[3px] cursor-col-resize"
                        />
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={4} className="px-3 py-10 text-center text-muted-foreground">
                      加载中…
                    </td>
                  </tr>
                ) : acls.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-3 py-10 text-center text-muted-foreground">
                      暂无显式授权（若密级为「公开」且启用，则默认全员可见）
                    </td>
                  </tr>
                ) : (
                  sortedAcls.map((a, i) => (
                    <tr
                      key={`${a.subjectType}-${a.subjectId ?? i}-${a.action}`}
                      className="border-b border-border/50 bg-table-row last:border-0 even:bg-table-stripe hover:bg-table-hover"
                    >
                      <td className="px-3 py-2">{subjectTypeLabel(a.subjectType)}</td>
                      <td className="px-3 py-2">{a.subjectName ?? '-'}</td>
                      <td className="px-3 py-2 font-mono text-xs">{a.subjectId ?? '-'}</td>
                      <td className="px-3 py-2">{aclActionLabel(a.action)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </TabsContent>

        {/* ---------------------------------------------------------- RAG 设置 */}
        <TabsContent value="rag" className="min-h-0 flex-1 overflow-auto">
          <div className="space-y-4 rounded-lg border bg-card p-4">
            <section>
              <p className="mb-3 text-sm font-medium">检索参数</p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className={fieldLabel}>topK（召回条数）</label>
                  <Input
                    value={form.topK}
                    onChange={(e) => setForm((f) => ({ ...f, topK: e.target.value }))}
                    placeholder="留空使用引擎默认"
                  />
                </div>
                <div>
                  <label className={fieldLabel}>相似度阈值</label>
                  <Input
                    value={form.scoreThreshold}
                    onChange={(e) => setForm((f) => ({ ...f, scoreThreshold: e.target.value }))}
                    placeholder="0 ~ 1，留空使用引擎默认"
                  />
                </div>
                <div>
                  <label className={fieldLabel}>检索方式</label>
                  <select
                    className={selectClass}
                    value={form.retrievalMethod}
                    onChange={(e) => setForm((f) => ({ ...f, retrievalMethod: e.target.value }))}
                  >
                    {KB_RETRIEVAL_METHOD_OPTIONS.map((o) => (
                      <option
                        key={o.value}
                        value={o.value}
                        disabled={o.value === 'hybrid' && !hybridSupported}
                      >
                        {o.label}
                      </option>
                    ))}
                  </select>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {KB_RETRIEVAL_METHOD_OPTIONS.find((o) => o.value === form.retrievalMethod)
                      ?.hint ?? ''}
                  </p>
                  {!hybridSupported ? (
                    <p className="mt-1 text-xs text-amber-600">
                      当前引擎不支持混合检索，选中也会在检索时自动降级为向量检索。
                    </p>
                  ) : null}
                </div>
                <div>
                  <label className={fieldLabel}>嵌入模型</label>
                  {/* kb_settings_model_chunk：嵌入模型创建后不可修改，详情页只读展示（设计 T05） */}
                  <Input
                    value={
                      embeddingPool != null && embeddingPool.length > 0
                        ? ((embeddingPool.find((m) => m.id === form.embeddingModel)?.name ??
                            form.embeddingModel) || '')
                        : form.embeddingModel
                    }
                    disabled
                    placeholder="未指定（使用引擎默认）"
                    title="嵌入模型在创建后不可修改"
                  />
                  <p className="mt-1 text-xs text-muted-foreground">
                    嵌入模型在创建时从模型池确定，创建后不可修改
                    {form.embeddingModel ? '（如需更换请删除后重建知识库）' : '；未指定时使用引擎默认模型'}。
                  </p>
                </div>
              </div>

              {/* WA-04：权重滑条仅 hybrid 显示；切走时隐藏但**不清值** */}
              {isHybrid ? (
                <div className="mt-4 rounded-md border border-dashed bg-muted/30 p-3">
                  <label className={fieldLabel}>向量 / 关键字权重</label>
                  <KbWeightSlider
                    value={form.vectorSimilarityWeight}
                    onChange={(v) => setForm((f) => ({ ...f, vectorSimilarityWeight: v }))}
                  />
                </div>
              ) : null}

              {/* WA-06 + kb_settings_model_chunk：rerank 区。全局模型是开关闸门（U3），
                  库级 rerankModelId 仅在有全局模型时可指定；从模型池下拉选择，不自建配置 */}
              <div className="mt-4 rounded-md border border-dashed bg-muted/30 p-3">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="h-4 w-4"
                    checked={form.rerank && rerankSupported}
                    disabled={!rerankSupported}
                    onChange={(e) => setForm((f) => ({ ...f, rerank: e.target.checked }))}
                  />
                  启用重排（rerank）
                </label>
                {rerankSupported ? (
                  <>
                    <div className="mt-2">
                      <label className="mb-1 block text-xs text-muted-foreground">重排模型</label>
                      {rerankPool != null && rerankPool.length > 0 ? (
                        <select
                          className={selectClass}
                          value={form.rerankModelId}
                          disabled={!form.rerank}
                          onChange={(e) => setForm((f) => ({ ...f, rerankModelId: e.target.value }))}
                        >
                          <option value="">
                            继承全局{globalRerankModelId ? `（${globalRerankName}）` : ''}
                          </option>
                          {rerankPool.map((m) => (
                            <option key={m.id} value={m.id}>
                              {modelOptionLabel(m)}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <div className="space-y-1.5">
                          <select className={selectClass} value="" disabled>
                            <option value="">
                              继承全局{globalRerankModelId ? `（${globalRerankName}）` : ''}
                            </option>
                          </select>
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs text-amber-600">
                              {poolDegraded
                                ? `模型池不可用：${modelPool?.degradedReason ?? '未知原因'}，当前仅可继承全局。`
                                : '模型池加载中，当前仅可继承全局。'}
                            </span>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => void refreshModels()}
                            >
                              重试
                            </Button>
                          </div>
                        </div>
                      )}
                      {form.rerankModelId &&
                      rerankPool != null &&
                      rerankPool.length > 0 &&
                      !rerankPool.some((m) => m.id === form.rerankModelId) ? (
                        <p className="mt-1 text-xs text-amber-600">
                          已选模型不在当前模型池，保存后检索时将自动回退全局模型
                          {globalRerankName ? `（${globalRerankName}）` : ''}。
                        </p>
                      ) : null}
                      <p className="mt-1 text-xs text-muted-foreground">
                        从平台已配置模型池选择；「继承全局」即使用{' '}
                        <span className="font-mono">mis.kb.engine.rerank-model-id</span>
                        指定的平台统一模型。
                      </p>
                    </div>
                  </>
                ) : (
                  <p className="mt-2 text-xs text-amber-600">
                    平台未配置全局重排模型，重排当前不可用。请联系运维配置{' '}
                    <span className="font-mono">mis.kb.engine.rerank-model-id</span>{' '}
                    后再启用；此时即使强行保存开启，服务端也会将其置为关闭。
                  </p>
                )}
              </div>
            </section>

            <section className="border-t pt-4">
              <p className="mb-3 text-sm font-medium">切片参数（L-08）</p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div>
                  <label className={fieldLabel}>切片方法</label>
                  <select
                    className={selectClass}
                    value={form.chunkMethod}
                    onChange={(e) => setForm((f) => ({ ...f, chunkMethod: e.target.value }))}
                  >
                    <option value="naive">通用（naive）</option>
                    <option value="qa">问答对（qa）</option>
                    <option value="paper">论文（paper）</option>
                    <option value="book">书籍（book）</option>
                    <option value="laws">法规（laws）</option>
                    <option value="table">表格（table）</option>
                  </select>
                </div>
                <div>
                  <label className={fieldLabel}>切片长度（token）</label>
                  <Input
                    type="number"
                    min={256}
                    max={4096}
                    value={form.chunkTokenNum}
                    onChange={(e) => setForm((f) => ({ ...f, chunkTokenNum: e.target.value }))}
                    placeholder="默认 4096（留空继承）"
                  />
                  <p className="mt-1 text-xs text-muted-foreground">
                    范围 256 ~ 4096，留空表示继承默认 4096
                  </p>
                </div>
                <div>
                  <label className={fieldLabel}>分隔符</label>
                  <Input
                    value={form.separator}
                    onChange={(e) => setForm((f) => ({ ...f, separator: e.target.value }))}
                    placeholder={'如 \\n。；！？'}
                  />
                </div>
              </div>

              {/* 解析器增量：页码索引（RAGFlow UI 文案 PageIndex，字段 toc_extraction）
                  + 图像表格上下文窗口。经 parser_config.ext 同步，与 RAGFlow Web 同口径。 */}
              <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="h-4 w-4"
                      checked={form.pageIndex}
                      disabled={!tocSupported}
                      onChange={(e) => setForm((f) => ({ ...f, pageIndex: e.target.checked }))}
                    />
                    页码索引（TOC 提取）
                  </label>
                  <p className="mt-1 text-xs text-muted-foreground">
                    提取目录/页码索引辅助召回，默认开启（对应 RAGFlow{' '}
                    <span className="font-mono">parser_config.ext.toc_extraction</span>，UI 称 PageIndex）
                  </p>
                  {!tocSupported ? (
                    <p className="mt-1 text-xs text-amber-600">
                      当前引擎版本暂不支持，参数已保留待引擎升级生效（保存仅落库，暂不生效）。
                    </p>
                  ) : null}
                </div>
                <div>
                  <label className={fieldLabel}>图像与表格上下文窗口（token）</label>
                  <Input
                    type="number"
                    min={1}
                    max={4096}
                    step={1}
                    value={form.imageTableContextWindow}
                    disabled={!imageTableContextSupported}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, imageTableContextWindow: e.target.value }))
                    }
                    placeholder="默认 256（留空继承）"
                  />
                  <p className="mt-1 text-xs text-muted-foreground">
                    范围 1 ~ 4096，图片/表格上下各取 N token 并入切片，留空表示继承默认 256
                  </p>
                  {!imageTableContextSupported ? (
                    <p className="mt-1 text-xs text-amber-600">
                      当前引擎版本暂不支持，参数已保留待引擎升级生效（保存仅落库，暂不生效）。
                    </p>
                  ) : null}
                </div>
              </div>

              {/* 切片参数对齐（T1）：overlapPercent（能力门控只落库）+ autoKeywords/autoQuestions
                  （官方 naive schema 键，随每次 PUT 恒下发）。overlapPercent 当前引擎不支持
                  （parserOverlapSupported=false）→ 置灰 + 「参数已保留待引擎升级生效」提示，
                  值仍可回显、保存照常成功；auto 两键恒可用。pageIndex/imageTableContextWindow
                  按能力闸门置灰（上一块）。 */}
              <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div>
                  <label className={fieldLabel}>重叠百分比（%）</label>
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    step={1}
                    value={form.overlapPercent}
                    disabled={!overlapSupported}
                    onChange={(e) => setForm((f) => ({ ...f, overlapPercent: e.target.value }))}
                    placeholder="默认 0（关闭）"
                  />
                  <p className="mt-1 text-xs text-muted-foreground">范围 0 ~ 100</p>
                  {!overlapSupported ? (
                    <p className="mt-1 text-xs text-amber-600">
                      当前引擎版本暂不支持，参数已保留待引擎升级生效（保存仅落库，暂不生效）。
                    </p>
                  ) : null}
                </div>
                <div>
                  <label className={fieldLabel}>自动关键字数量</label>
                  <Input
                    type="number"
                    min={0}
                    max={32}
                    step={1}
                    value={form.autoKeywords}
                    onChange={(e) => setForm((f) => ({ ...f, autoKeywords: e.target.value }))}
                    placeholder="0 = 关闭"
                  />
                  <p className="mt-1 text-xs text-muted-foreground">
                    范围 0 ~ 32（0 = 关闭，对应 RAGFlow{' '}
                    <span className="font-mono">auto_keywords</span>）
                  </p>
                </div>
                <div>
                  <label className={fieldLabel}>自动问题数量</label>
                  <Input
                    type="number"
                    min={0}
                    max={10}
                    step={1}
                    value={form.autoQuestions}
                    onChange={(e) => setForm((f) => ({ ...f, autoQuestions: e.target.value }))}
                    placeholder="0 = 关闭"
                  />
                  <p className="mt-1 text-xs text-muted-foreground">
                    范围 0 ~ 10（0 = 关闭，对应 RAGFlow{' '}
                    <span className="font-mono">auto_questions</span>）
                  </p>
                </div>
              </div>

              {/* KE-06/KE-07：OCR 开关 / 语言 / 分块重叠（企业级增强一期）。
                  当前引擎实测不支持（能力 false）→ 控件置灰 + 「暂不生效」提示；
                  值仍可回显、保存照常成功（后端只落库不下发，引擎升级后翻转能力即放行）。 */}
              <div className="mt-4 rounded-md border border-dashed bg-muted/30 p-3">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <div>
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        className="h-4 w-4"
                        checked={form.ocrEnabled && ocrSupported}
                        disabled={!ocrSupported}
                        onChange={(e) => setForm((f) => ({ ...f, ocrEnabled: e.target.checked }))}
                      />
                      启用 OCR（图片/扫描件识别）
                    </label>
                  </div>
                  <div>
                    <label className={fieldLabel}>OCR 语言</label>
                    <select
                      className={selectClass}
                      value={form.ocrLanguage}
                      disabled={!ocrSupported}
                      onChange={(e) => setForm((f) => ({ ...f, ocrLanguage: e.target.value }))}
                    >
                      <option value="zh">中文（zh）</option>
                      <option value="en">英文（en）</option>
                      <option value="zh_en">中英混合（zh_en）</option>
                    </select>
                  </div>
                  <div>
                    <label className={fieldLabel}>分块重叠（token）</label>
                    <Input
                      type="number"
                      min={0}
                      step={1}
                      value={form.chunkOverlapTokenNum}
                      disabled={!overlapSupported}
                      onChange={(e) => setForm((f) => ({ ...f, chunkOverlapTokenNum: e.target.value }))}
                      placeholder="留空 = 引擎默认/0"
                    />
                  </div>
                </div>
                {!ocrSupported || !overlapSupported ? (
                  <p className="mt-2 text-xs text-amber-600">
                    当前引擎版本暂不支持
                    {!ocrSupported ? 'OCR' : ''}
                    {!ocrSupported && !overlapSupported ? ' / ' : ''}
                    {!overlapSupported ? '分块重叠' : ''}
                    ，参数已保留待引擎升级生效（保存仅落库，暂不生效）。
                  </p>
                ) : (
                  <p className="mt-2 text-xs text-muted-foreground">
                    OCR 与分块重叠为解析期参数，改动只影响<strong>此后新上传/重解析</strong>的文档。
                  </p>
                )}
              </div>

              {/* Wave B GraphRAG PoC：知识图谱区（T02）。
                  开关随 RAG 设置保存（false→true 时后端自动触发构图 + 手动按钮重试）；
                  kgBuildStatus/kgBuildMessage 由服务端维护（查询时引擎刷新回写），
                  前端在 building 态每 3s 轮询 build-status，直到 ready/failed。 */}
              <div className="mt-4 rounded-md border border-dashed bg-muted/30 p-3">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="h-4 w-4"
                      checked={form.useKnowledgeGraph && graphSupported}
                      disabled={!graphSupported || saving}
                      onChange={(e) => setForm((f) => ({ ...f, useKnowledgeGraph: e.target.checked }))}
                    />
                    启用知识图谱增强
                  </label>
                  <span
                    className={
                      'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ' +
                      (kgBuildStatus === 'ready'
                        ? 'bg-emerald-100 text-emerald-700'
                        : kgBuildStatus === 'building'
                          ? 'bg-blue-100 text-blue-700'
                          : kgBuildStatus === 'failed'
                            ? 'bg-red-100 text-red-700'
                            : 'bg-muted text-muted-foreground')
                    }
                    title={kgBuildStatus === 'failed' && kgBuildMessage ? kgBuildMessage : undefined}
                  >
                    {graphStatusLabel}
                    {isBuilding ? (
                      <span className="h-3 w-3 animate-spin rounded-full border border-current border-t-transparent" />
                    ) : null}
                  </span>
                  <PermissionGate permission="kb:library:edit">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!graphSupported || isBuilding || graphTriggering || saving}
                      onClick={() => void onBuildGraph()}
                    >
                      {kgBuildStatus === 'ready' ? '重新构建' : '开始构建'}
                    </Button>
                  </PermissionGate>
                </div>
                {!graphSupported ? (
                  <p className="mt-2 text-xs text-amber-600">
                    当前引擎版本暂不支持知识图谱增强。
                  </p>
                ) : (
                  <p className="mt-2 text-xs text-muted-foreground">
                    开启后自动排队构建图谱，构建期间检索暂不启用图谱增强（回落混合检索）。
                    图谱增强仅<strong>单库</strong>检索生效，多库检索自动回落；最多 2 个库可开启。
                  </p>
                )}
                {kgBuildStatus === 'failed' && kgBuildMessage ? (
                  <p className="mt-2 text-xs text-red-600">
                    构建失败原因：{kgBuildMessage}
                  </p>
                ) : null}
                {form.useKnowledgeGraph && !isBuilding && kgBuildStatus !== 'ready' ? (
                  <p className="mt-2 text-xs text-amber-600">
                    开关已开启但图谱尚未构建完成，可点击「开始构建」触发/重试。
                  </p>
                ) : null}
              </div>

              {/* Wave C RAPTOR：RAPTOR 摘要区（T02）。
                  开关随 RAG 设置保存（false→true 时后端自动触发建树 + 手动按钮重试）；
                  raptorBuildStatus/raptorBuildMessage 由服务端维护（查询时引擎刷新回写），
                  前端在 building 态每 3s 轮询 build-status，直到 ready/failed。
                  U4：无库数上限——只有平台总开关 mis.kb.engine.raptor-enabled + 能力闸门。 */}
              <div className="mt-4 rounded-md border border-dashed bg-muted/30 p-3">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="h-4 w-4"
                      checked={form.useRaptor && raptorSupported}
                      disabled={!raptorSupported || saving}
                      onChange={(e) => setForm((f) => ({ ...f, useRaptor: e.target.checked }))}
                    />
                    启用 RAPTOR 摘要增强
                  </label>
                  <span
                    className={
                      'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ' +
                      (currentRaptorBuildStatus === 'ready'
                        ? 'bg-emerald-100 text-emerald-700'
                        : currentRaptorBuildStatus === 'building'
                          ? 'bg-blue-100 text-blue-700'
                          : currentRaptorBuildStatus === 'failed'
                            ? 'bg-red-100 text-red-700'
                            : 'bg-muted text-muted-foreground')
                    }
                    title={
                      currentRaptorBuildStatus === 'failed' && raptorBuildMessage
                        ? raptorBuildMessage
                        : undefined
                    }
                  >
                    {raptorStatusLabel}
                    {isRaptorBuilding ? (
                      <span className="h-3 w-3 animate-spin rounded-full border border-current border-t-transparent" />
                    ) : null}
                  </span>
                  <PermissionGate permission="kb:library:edit">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!raptorSupported || isRaptorBuilding || raptorTriggering || saving}
                      onClick={() => void onBuildRaptor()}
                    >
                      {currentRaptorBuildStatus === 'ready' ? '重新构建' : '开始构建'}
                    </Button>
                  </PermissionGate>
                </div>
                {/* RAPTOR 参数仅在开关开启时展开编辑；留空 = 继承引擎默认（T00 实测区间） */}
                {form.useRaptor ? (
                  <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <div>
                      <label className="mb-1 block text-xs text-muted-foreground">
                        摘要 chunk 最大 token 数
                      </label>
                      <Input
                        type="number"
                        min={512}
                        max={2048}
                        value={form.raptorMaxTokenNum}
                        onChange={(e) =>
                          setForm((f) => ({ ...f, raptorMaxTokenNum: e.target.value }))
                        }
                        placeholder="默认 1024"
                      />
                      <p className="mt-1 text-xs text-muted-foreground">范围 512 ~ 2048</p>
                    </div>
                    <div>
                      <label className="mb-1 block text-xs text-muted-foreground">
                        聚类相似度阈值
                      </label>
                      <Input
                        type="number"
                        min={0}
                        max={1}
                        step={0.05}
                        value={form.raptorThreshold}
                        onChange={(e) =>
                          setForm((f) => ({ ...f, raptorThreshold: e.target.value }))
                        }
                        placeholder="默认 0.1"
                      />
                      <p className="mt-1 text-xs text-muted-foreground">范围 0 ~ 1</p>
                    </div>
                    <div>
                      <label className="mb-1 block text-xs text-muted-foreground">
                        最大聚类数
                      </label>
                      <Input
                        type="number"
                        min={1}
                        max={1024}
                        value={form.raptorMaxCluster}
                        onChange={(e) =>
                          setForm((f) => ({ ...f, raptorMaxCluster: e.target.value }))
                        }
                        placeholder="默认 64"
                      />
                      <p className="mt-1 text-xs text-muted-foreground">范围 1 ~ 1024</p>
                    </div>
                    <div>
                      <label className="mb-1 block text-xs text-muted-foreground">
                        递归摘要提示词
                      </label>
                      <Input
                        value={form.raptorPrompt}
                        onChange={(e) =>
                          setForm((f) => ({ ...f, raptorPrompt: e.target.value }))
                        }
                        placeholder="留空使用引擎默认提示词"
                      />
                      <p className="mt-1 text-xs text-muted-foreground">≤2000 字符</p>
                    </div>
                  </div>
                ) : null}
                {!raptorSupported ? (
                  <p className="mt-2 text-xs text-amber-600">
                    当前引擎版本暂不支持 RAPTOR 摘要增强。
                  </p>
                ) : (
                  <p className="mt-2 text-xs text-muted-foreground">
                    开启后自动排队构建递归摘要树，构建完成后引擎在经典检索中自动融合摘要
                    （MIS 检索期零改动）。RAPTOR 与知识图谱构建
                    <strong>不互斥可并行</strong>，两个开关可同时开；无库数上限。
                  </p>
                )}
                {currentRaptorBuildStatus === 'failed' && raptorBuildMessage ? (
                  <p className="mt-2 text-xs text-red-600">
                    构建失败原因：{raptorBuildMessage}
                  </p>
                ) : null}
                {form.useRaptor && !isRaptorBuilding && currentRaptorBuildStatus !== 'ready' ? (
                  <p className="mt-2 text-xs text-amber-600">
                    开关已开启但摘要树尚未构建完成，可点击「开始构建」触发/重试。
                  </p>
                ) : null}
              </div>
              {/* WA-12：此处原文写的是 Markdown 星号，在 JSX 里不会被渲染成加粗，
                  只会原样显示两个星号。改用 <strong> 才是对的。 */}
              <p className="mt-2 text-xs text-muted-foreground">
                切片参数改动只影响<strong>此后新上传</strong>的文档；已入库文档需先
                <strong>删除、再重新上传</strong>才会按新参数切片（「重新解析」沿用文档上传时
                的参数，不会应用新分隔符；页码索引 / 表格图像上下文窗口 / 重叠百分比 /
                自动关键字 / 自动问题同理）。
              </p>
              {chunkDirty(form, baseline) ? (
                <p className="mt-1 text-xs text-amber-600">
                  检测到切片参数已修改，保存后请对相关文档执行「删除后重新上传」才会生效。
                </p>
              ) : null}
            </section>

            <section className="border-t pt-4">
              <p className="mb-3 text-sm font-medium">空结果策略（L-08）</p>
              <select
                className={`${selectClass} sm:w-80`}
                value={form.emptyResultStrategy}
                onChange={(e) => setForm((f) => ({ ...f, emptyResultStrategy: e.target.value }))}
              >
                {KB_EMPTY_RESULT_STRATEGY_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              <p className="mt-2 text-xs text-muted-foreground">
                {KB_EMPTY_RESULT_STRATEGY_OPTIONS.find((o) => o.value === form.emptyResultStrategy)
                  ?.hint ?? '未命中时的兜底行为。'}
              </p>
            </section>

            {/* WA-10：保存成功且切片参数确有改动时，才弹重解析引导（B2 已校正文案：
                RAGFlow 重新解析沿用文档上传时的参数，需删除后重新上传才会按新分隔符切片） */}
            {showReparseHint ? (
              <Alert>
                <AlertTitle>切片参数已更新，存量文档需重新上传</AlertTitle>
                <AlertDescription>
                  <p>
                    新的切片方法 / 长度 / 分隔符 / 页码索引 / 图像表格上下文窗口 / 重叠百分比 /
                    自动关键字 / 自动问题只对<strong>此后新上传</strong>的内容生效。
                    已入库文档请先<strong>删除、再重新上传</strong>，才会按新参数重新切片
                    （「重新解析」不会应用新参数）。
                  </p>
                  <Button
                    size="sm"
                    variant="outline"
                    className="mt-2"
                    onClick={() => setShowReparseHint(false)}
                  >
                    知道了
                  </Button>
                </AlertDescription>
              </Alert>
            ) : null}

            <div className="flex justify-end border-t pt-4">
              <PermissionGate permission="kb:library:edit">
                <Button disabled={saving || loading} onClick={() => void onSaveSettings()}>
                  <Save className="h-4 w-4" />
                  保存设置
                </Button>
              </PermissionGate>
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

/** 详情页字段行。 */
function MetaRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <dt className="w-24 shrink-0 text-sm text-muted-foreground">{label}</dt>
      <dd className="min-w-0 flex-1 truncate text-sm">{value}</dd>
    </div>
  );
}

/**
 * 模型下拉选项展示名（与库管理页创建向导同口径）。
 *
 * <p>列表接口不提供维度/语言时为 null，此时省略后缀（T00 实测）。
 */
function modelOptionLabel(m: {
  name: string;
  dimension: number | null;
  language: string | null;
}): string {
  return m.dimension != null || m.language != null
    ? `${m.name}（${[m.dimension, m.language].filter(Boolean).join('·')}）`
    : m.name;
}
