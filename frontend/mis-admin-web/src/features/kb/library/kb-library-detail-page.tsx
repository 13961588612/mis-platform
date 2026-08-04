import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft, RefreshCw, Save } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { PageHeader } from '@/components/common/page-header';
import { PermissionGate } from '@/components/auth/permission-gate';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { EnabledBadge, SecrecyBadge } from '../components/kb-badges';
import { KbWeightSlider } from '../components/kb-weight-slider';
import { getLibraryDetail, updateRagSettings } from '../api/kb-api';
import { KbDocumentTable } from '../document/kb-document-table';
import { useKbStore } from '../stores/use-kb-store';
import type { KbAclSummary, KbLibraryDetail, KbRagSettings } from '../types';
import {
  KB_EMPTY_RESULT_STRATEGY_OPTIONS,
  KB_RETRIEVAL_METHOD_OPTIONS,
  aclActionLabel,
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
};

/** 切片相关字段：这几个改了才需要弹重解析引导（WA-10）。 */
const CHUNK_FIELDS = ['chunkMethod', 'chunkTokenNum', 'separator'] as const;

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
      f.chunkTokenNum.trim() !== '' && Number.isFinite(tokenNum) && tokenNum > 0
        ? Math.trunc(tokenNum)
        : null,
    // separator 允许是纯空白（如换行符），只在完全为空串时归 null
    separator: f.separator === '' ? null : f.separator,
    emptyResultStrategy: f.emptyResultStrategy || null,
    vectorSimilarityWeight: f.vectorSimilarityWeight,
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

  const capabilities = useKbStore((s) => s.capabilities);
  const refreshEngine = useKbStore((s) => s.refreshEngine);
  // QA P2-A：原写法 `!== false` 在能力未拉到 / 返回 null 时推导为 true，属 fail-open。
  // 现改 `=== true`——能力未确认即置灰，与后端保存期强制关闭 rerank 的口径一致。
  const rerankSupported = capabilities?.rerankSupported === true;
  // 同 rerankSupported：fail-safe，能力未确认即置灰（QA P2-A）。检索方式选择器据此
  // 临时禁用 hybrid 选项并提示，但已保存的 hybrid 配置仍照常回显、权重滑条照常显示。
  const hybridSupported = capabilities?.hybridSupported === true;
  const isHybrid = form.retrievalMethod === 'hybrid';

  const load = useCallback(async (id: number) => {
    setLoading(true);
    try {
      const d = await getLibraryDetail(id);
      setDetail(d);
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

  async function onSaveSettings(): Promise<void> {
    if (libraryId == null) return;
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

  if (libraryId == null) {
    return (
      <div className="flex min-h-0 flex-1 flex-col p-4 md:p-5">
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
    <div className="flex min-h-0 flex-1 flex-col p-4 md:p-5">
      <PageHeader
        title={meta?.name ? `知识库 · ${meta.name}` : `知识库 #${libraryId}`}
        description="查看知识库元信息与授权范围，并调整检索（RAG）参数；保存后即时同步到引擎。"
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
                label="引擎"
                value={<Badge variant="outline">{meta.engineType ?? '未知'}</Badge>}
              />
              <MetaRow label="创建时间" value={formatTime(meta.createdAt)} />
              <MetaRow label="更新时间" value={formatTime(meta.updatedAt)} />
            </dl>
          )}
        </TabsContent>

        {/* ---------------------------------------------------------- 文档（L-06） */}
        <TabsContent value="docs" className="min-h-0 flex-1">
          <KbDocumentTable libraryId={libraryId} showUpload fill />
        </TabsContent>

        {/* ---------------------------------------------------------- 授权范围 */}
        <TabsContent value="acls" className="min-h-0 flex-1">
          <div className="h-full min-h-0 overflow-auto rounded-lg border bg-table-surface">
            <table className="w-full bg-table-surface text-left text-sm">
              <thead className="sticky top-0 z-10 border-b-2 border-foreground/20 bg-table-header text-muted-foreground backdrop-blur">
                <tr>
                  <th className="px-3 py-2 font-bold">主体类型</th>
                  <th className="px-3 py-2 font-bold">主体名称</th>
                  <th className="px-3 py-2 font-bold">主体 ID</th>
                  <th className="px-3 py-2 font-bold">权限</th>
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
                  acls.map((a, i) => (
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
                  <Input
                    value={form.embeddingModel}
                    onChange={(e) => setForm((f) => ({ ...f, embeddingModel: e.target.value }))}
                    placeholder="留空使用引擎默认"
                  />
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

              {/* WA-06：rerank 区展示全局模型名，不可用时置灰并给出明确理由 */}
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
                  <p className="mt-2 text-xs text-muted-foreground">
                    重排模型由平台统一配置（
                    <span className="font-mono">mis.kb.engine.rerank-model-id</span>
                    ），库级只控制开关，不可单独指定模型。
                  </p>
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
                    value={form.chunkTokenNum}
                    onChange={(e) => setForm((f) => ({ ...f, chunkTokenNum: e.target.value }))}
                    placeholder="如 512"
                  />
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
              {/* WA-12：此处原文写的是 Markdown 星号，在 JSX 里不会被渲染成加粗，
                  只会原样显示两个星号。改用 <strong> 才是对的。 */}
              <p className="mt-2 text-xs text-muted-foreground">
                切片参数改动只影响<strong>此后新解析</strong>的文档；已入库文档需在「文档」页重新解析才会生效。
              </p>
              {chunkDirty(form, baseline) ? (
                <p className="mt-1 text-xs text-amber-600">
                  检测到切片参数已修改，保存后请记得对相关文档执行「重新解析」。
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

            {/* WA-10：保存成功且切片参数确有改动时，才弹重解析引导 */}
            {showReparseHint ? (
              <Alert>
                <AlertTitle>切片参数已更新，建议重新解析文档</AlertTitle>
                <AlertDescription>
                  <p>
                    新的切片方法 / 长度 / 分隔符只对<strong>此后新解析</strong>的内容生效。
                    已入库文档需要重新解析才会按新参数重新切片。
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
