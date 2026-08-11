import { useCallback, useEffect, useMemo, useState } from 'react';
import { Download, Play, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { PageHeader } from '@/components/common/page-header';
import { buildAppBreadcrumbs } from '@/components/common/app-breadcrumbs';
import { PermissionGate } from '@/components/auth/permission-gate';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { KbLibraryCombobox } from '../components/kb-library-combobox';
import { KbWeightSlider } from '../components/kb-weight-slider';
import { KbHitTestResultList } from './kb-hit-test-result-list';
import { KbSynonymStatusBadge, KbSynonymTraceCard } from './kb-synonym-trace-card';
import { getRagSettings, getSynonymConfig, hitTest, listDocuments } from '../api/kb-api';
import { useKbStore } from '../stores/use-kb-store';
import type {
  KbDocument,
  KbEffectiveParams,
  KbHitTestHit,
  KbHitTestResult,
  KbSynonymConfig,
  KbSynonymExpansion,
} from '../types';
import {
  KB_RETRIEVAL_METHOD_OPTIONS,
  emptyResultStrategyLabel,
  paramSourceLabel,
  retrievalMethodLabel,
  synonymExpansionStatusLabel,
} from '../types';

const fieldLabel = 'mb-[0.4rem] block text-sm font-medium text-foreground';
const selectClass =
  'h-9 w-full rounded-md border border-input bg-card px-[0.7rem] text-sm text-foreground shadow-none';

/** 默认向量相似度权重，与后端 `RagSettings.DEFAULT_VECTOR_SIMILARITY_WEIGHT` 一致。 */
const DEFAULT_WEIGHT = 0.3;

/** 调参面板模型：数值走字符串，空串表示「不覆盖，用库设置」。 */
interface TuneForm {
  question: string;
  topK: string;
  threshold: string;
  retrievalMethod: string;
  vectorSimilarityWeight: number;
  rerank: boolean;
  /** 本次不使用同义词扩展（Wave D；仅影响本次测试，不写回全局开关）。 */
  disableSynonym: boolean;
  /** 按文档过滤：MIS 文档 id 多选（KE-08）；空数组 = 不过滤。 */
  documentIds: number[];
  /** 上传时间范围下界（datetime-local 原始值，KE-09）；空串 = 不限制。 */
  uploadFrom: string;
  /** 上传时间范围上界（datetime-local 原始值，KE-09）；空串 = 不限制。 */
  uploadTo: string;
}

const EMPTY_TUNE: TuneForm = {
  question: '',
  topK: '',
  threshold: '',
  retrievalMethod: 'hybrid',
  vectorSimilarityWeight: DEFAULT_WEIGHT,
  rerank: false,
  disableSynonym: false,
  documentIds: [],
  uploadFrom: '',
  uploadTo: '',
};

/** 一次已完成的测试记录（用于 WA-14 并排对比）。 */
interface TestRun {
  question: string;
  result: KbHitTestResult;
  at: string;
  /** 本次实际下发的过滤条件摘要（KE-08/09 结果回显，随运行定格）。 */
  filterEcho: string | null;
}

/** CSV 单元格转义：双引号翻倍并整体加引号，避免逗号/换行撕裂表格。 */
function csvCell(v: string | number | null | undefined): string {
  const s = v == null ? '' : String(v);
  return `"${s.replace(/"/g, '""')}"`;
}

/**
 * 导出命中结果为 CSV（WA-15）。
 *
 * <p>用原生 `Blob` + `URL.createObjectURL`，不引 `xlsx` / `file-saver`——
 * 导出内容就是一张扁平表，为它加 ~1MB 依赖不值当（设计文档 §6.2 / U6）。
 * 加 BOM 头是为了 Excel 打开中文不乱码。
 *
 * <p>导出本身<b>不记审计</b>（U6）：内容用户在页面上已经看得见了；
 * 但「执行命中测试」这个动作在后端有 `@OperLog` 留痕。
 */
function exportCsv(
  question: string,
  hits: KbHitTestHit[],
  expansion: KbSynonymExpansion | null | undefined,
): void {
  const header = ['序号', '得分', '来源文档', '文档ID', '页码', '偏移', '片段原文'];
  const rows = hits.map((h, i) => [
    csvCell(i + 1),
    csvCell(h.score ?? ''),
    csvCell(h.docTitle ?? ''),
    csvCell(h.documentId ?? ''),
    csvCell(h.page ?? ''),
    csvCell(h.offset ?? ''),
    csvCell(h.chunkText ?? ''),
  ]);
  const csv = [
    `${csvCell('测试问题')},${csvCell(question)}`,
    // Wave D（PRD §5.4）：同义词扩展轨迹随 CSV 一并导出，方便离线核对。
    `${csvCell('实际检索问句')},${csvCell(expansion?.expandedQuery ?? question)}`,
    `${csvCell('同义词扩展')},${csvCell(synonymExpansionStatusLabel(expansion?.status))}`,
    header.map(csvCell).join(','),
    ...rows.map((r) => r.join(',')),
  ].join('\r\n');

  const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `kb-hit-test-${Date.now()}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * datetime-local 原始值（"YYYY-MM-DDTHH:mm"）→ ISO-8601 UTC 串（KE-09）。
 *
 * <p>浏览器规范：不带时区的日期时间串按「本地时区」解释，`toISOString()`
 * 再转成 UTC——用户选的是本地时刻，后端拿到的就是绝对时刻，不硬编码 +08:00。
 * 空串 / 非法输入返回 null（= 不限制，与后端「空 = 不过滤」语义对齐）。
 */
function toIsoInstant(localValue: string): string | null {
  const v = localValue.trim();
  if (!v) return null;
  // "YYYY-MM-DDTHH:mm" 补秒成 "YYYY-MM-DDTHH:mm:ss"，避免省略秒导致的解析歧义
  const withSeconds = v.length === 16 ? `${v}:00` : v;
  const d = new Date(withSeconds);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * 本次请求的过滤条件摘要（结果回显用，设计 §2.2「结果回显过滤条件」）。
 *
 * <p>只反映「本次请求下发了什么」，不做生效性判断——引擎不支持时由后端
 * 降级并在 `effectiveParams.degradedReasons` 回显原因，前端不重复解读。
 */
function filterSummaryText(form: TuneForm, documents: KbDocument[]): string | null {
  const parts: string[] = [];
  if (form.documentIds.length > 0) {
    const matched = documents.filter((d) => form.documentIds.includes(d.id)).length;
    parts.push(`文档 ${matched}/${form.documentIds.length} 篇`);
  }
  const from = form.uploadFrom ? form.uploadFrom.slice(0, 10) : '';
  const to = form.uploadTo ? form.uploadTo.slice(0, 10) : '';
  if (from || to) {
    parts.push(`上传时间 ${from || '不限'} ~ ${to || '不限'}`);
  }
  return parts.length > 0 ? parts.join('，') : null;
}

/**
 * 命中测试页（Q-04 / WA-08 / WA-14 / WA-15）。
 *
 * <p>知识管理员的调参工作台：选一个库、输一个问题、临时改几个参数，
 * 立刻看到召回了哪些 chunk。所有调参<b>只影响本次测试，不写回库设置</b>——
 * 试满意了再去「知识库详情 → RAG 设置」正式保存。
 *
 * <p>WA-14 的「上一次结果」对比只保留 1 组，纯内存不落库：调参是高频短时行为，
 * 存服务端既无必要也徒增审计面。<b>切换知识库时必须清空对比槽</b>——
 * 拿 A 库的结果和 B 库的结果并排看，只会得出错误结论。
 */
export function KbHitTestPage() {
  const [libraryId, setLibraryId] = useState<number | null>(null);
  const [form, setForm] = useState<TuneForm>(EMPTY_TUNE);
  const [running, setRunning] = useState(false);
  const [current, setCurrent] = useState<TestRun | null>(null);
  const [previous, setPrevious] = useState<TestRun | null>(null);
  const [synonymConfig, setSynonymConfig] = useState<KbSynonymConfig | null>(null);
  // 当前库文档列表，供「限定文档」多选数据源（KE-08）；切库时随设置一并刷新。
  const [documents, setDocuments] = useState<KbDocument[]>([]);

  const capabilities = useKbStore((s) => s.capabilities);
  const refreshEngine = useKbStore((s) => s.refreshEngine);
  // QA P2-A：capabilities 未加载、或 rerankSupported 返回 null（types.ts:389 声明
  // boolean | null）时，`!== false` 会推导为 true = 开关可用，属 fail-open。
  // 改 `=== true` 收敛为 fail-safe：能力未确认就置灰，避免用户勾上保存后被后端
  // RagSettingsService 的第一道防线强制回落却看不到任何解释。
  const rerankSupported = capabilities?.rerankSupported === true;
  // 同 rerankSupported：能力位一律 `=== true`（fail-safe）。未确认时置灰，
  // 避免用户勾上 hybrid 后被后端强制回落却看不到解释。
  const hybridSupported = capabilities?.hybridSupported === true;
  const isHybrid = form.retrievalMethod === 'hybrid';
  // 同义词全局生效态：`=== true` 收敛（设计 §7.8）。未加载 / 被熔断 / 已关
  // 一律视为「未生效」——此时「本次不使用」开关无意义，置灰更安全。
  const synonymEffective = synonymConfig?.effective === true;
  // 文档/时间范围过滤能力：`=== true`（fail-safe，对齐 rerankSupported 口径）。
  // 未确认一律置灰——过滤条件在引擎不支持时会被后端清空，与其让人白勾不如提前挡住。
  const filterSupported = capabilities?.metadataFilterSupported === true;

  useEffect(() => {
    if (!capabilities) void refreshEngine();
  }, [capabilities, refreshEngine]);

  // 拉取同义词全局配置，决定「本次不使用」勾选框是否可用（不阻塞命中测试）。
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const cfg = await getSynonymConfig();
        if (!cancelled) setSynonymConfig(cfg);
      } catch {
        // 老后端未升级同义词接口时静默忽略，不阻塞命中测试主流程。
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * 切库：调参面板初值取该库当前设置，同时清空两个结果槽。
   *
   * <p>清空是硬要求（WA-14）：跨库对比会误导。哪怕用户只是手滑点错库，
   * 也宁可让他重跑一次，也不能留着上一个库的结果假装可比。
   *
   * <p>过滤条件一并清空（KE-08/09）：文档 id 属于具体库，切库后原 id 在新库
   * 可能指向别的文档甚至不存在——留着只会让结果莫名其妙，重置最安全。
   */
  const onLibraryChange = useCallback((id: number | null) => {
    setLibraryId(id);
    setCurrent(null);
    setPrevious(null);
    if (id == null) {
      setDocuments([]);
      setForm((f) => ({ ...EMPTY_TUNE, question: f.question }));
      return;
    }
    void (async () => {
      try {
        const s = await getRagSettings(id);
        setForm((f) => ({
          question: f.question,
          topK: s.topK == null ? '' : String(s.topK),
          threshold: s.scoreThreshold == null ? '' : String(s.scoreThreshold),
          retrievalMethod: s.retrievalMethod ?? 'hybrid',
          vectorSimilarityWeight: s.vectorSimilarityWeight ?? DEFAULT_WEIGHT,
          rerank: s.rerank === true,
          disableSynonym: f.disableSynonym,
          documentIds: [],
          uploadFrom: '',
          uploadTo: '',
        }));
      } catch (e) {
        toast.error(e instanceof Error ? e.message : '加载该库 RAG 设置失败');
      }
      // 文档列表供「限定文档」多选；拉取失败只影响过滤区数据，不阻塞主流程。
      try {
        setDocuments(await listDocuments(id));
      } catch {
        setDocuments([]);
      }
    })();
  }, []);

  async function onRun(): Promise<void> {
    if (libraryId == null) {
      toast.error('请先选择知识库');
      return;
    }
    if (!form.question.trim()) {
      toast.error('请输入测试问题');
      return;
    }
    const topK = Number(form.topK);
    const threshold = Number(form.threshold);
    setRunning(true);
    try {
      const result = await hitTest({
        libraryId,
        question: form.question.trim(),
        topK: form.topK.trim() !== '' && Number.isFinite(topK) ? Math.trunc(topK) : null,
        threshold:
          form.threshold.trim() !== '' && Number.isFinite(threshold) ? threshold : null,
        retrievalMethod: form.retrievalMethod || null,
        // 非 hybrid 时不发权重：后端会按检索方式强制换算，发了也是白发
        vectorSimilarityWeight: isHybrid ? form.vectorSimilarityWeight : null,
        rerank: form.rerank,
        // Wave D：仅影响本次测试，绝不写回全局开关。
        disableSynonym: form.disableSynonym,
        // KE-08/09：空数组/空串归 null（cleanParams 会剔除 null），
        // 保证「均未设置时行为与现状一致」——不下发 document_ids 键。
        documentIds: form.documentIds.length > 0 ? [...form.documentIds] : null,
        uploadFrom: toIsoInstant(form.uploadFrom),
        uploadTo: toIsoInstant(form.uploadTo),
      });
      // 当前结果挤到「上一次」，形成 1 组对比
      setPrevious(current);
      setCurrent({
        question: form.question.trim(),
        result,
        at: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
        filterEcho: filterSummaryText(form, documents),
      });
      if ((result.hits?.length ?? 0) === 0) {
        toast.warning('本次未命中任何片段，可尝试降低阈值或切换检索方式');
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '命中测试失败');
    } finally {
      setRunning(false);
    }
  }

  const currentHits = useMemo<KbHitTestHit[]>(() => current?.result.hits ?? [], [current]);
  const previousHits = useMemo<KbHitTestHit[]>(() => previous?.result.hits ?? [], [previous]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <PageHeader
        title="命中测试"
        description="选择一个知识库并输入问题，查看当前参数下实际召回的片段；此处的调参仅影响本次测试，不会写回知识库设置。"
        breadcrumbs={buildAppBreadcrumbs({ app: 'kb', title: '命中测试' })}
      />

      {/* ------------------------------------------------------ 调参面板 */}
      <div className="space-y-4 rounded-lg border bg-card p-4">
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
          <div className="min-w-0 lg:col-span-6">
            <label className={fieldLabel}>知识库（单选）</label>
            <KbLibraryCombobox
              value={libraryId}
              onChange={(id) => onLibraryChange(id)}
              activePath="/kb/hit-test"
            />
          </div>
          <div className="min-w-0 lg:col-span-2">
            <label className={fieldLabel}>topK（召回条数）</label>
            <Input
              value={form.topK}
              onChange={(e) => setForm((f) => ({ ...f, topK: e.target.value }))}
              placeholder="留空用库设置"
            />
          </div>
          <div className="min-w-0 lg:col-span-2">
            <label className={fieldLabel}>相似度阈值</label>
            <Input
              value={form.threshold}
              onChange={(e) => setForm((f) => ({ ...f, threshold: e.target.value }))}
              placeholder="0 ~ 1，留空用库设置"
            />
          </div>
          <div className="min-w-0 lg:col-span-2">
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
          </div>
          {isHybrid ? (
            <div className="rounded-md border border-dashed bg-muted/30 p-3 lg:col-span-6">
              <label className={fieldLabel}>向量 / 关键字权重</label>
              <KbWeightSlider
                value={form.vectorSimilarityWeight}
                onChange={(v) => setForm((f) => ({ ...f, vectorSimilarityWeight: v }))}
              />
            </div>
          ) : null}
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="h-4 w-4"
            checked={form.rerank && rerankSupported}
            disabled={!rerankSupported}
            onChange={(e) => setForm((f) => ({ ...f, rerank: e.target.checked }))}
          />
          启用重排（rerank）
          {!rerankSupported ? (
            <span className="text-xs text-amber-600">
              平台未配置全局重排模型，当前不可用
            </span>
          ) : null}
        </label>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="h-4 w-4"
            checked={form.disableSynonym}
            disabled={!synonymEffective}
            onChange={(e) => setForm((f) => ({ ...f, disableSynonym: e.target.checked }))}
          />
          本次不使用同义词扩展
          {!synonymEffective ? (
            <span className="text-xs text-amber-600">
              同义词扩展已全局关闭，本轮测试不会进行扩展
            </span>
          ) : null}
        </label>

        {/* 检索范围过滤（KE-08/09）：限定文档多选 + 上传时间范围。
            能力未确认/不支持时整体置灰（fail-safe，`=== true`），与 rerank 区同款
            置灰 + amber 提示结构；后端仍会二次清洗（仅库内 + enabled=1）与强制降级。 */}
        <div className="space-y-2 rounded-md border border-dashed bg-muted/30 p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium text-foreground">检索范围过滤（KE-08/09）</span>
            {filterSupported &&
            (form.documentIds.length > 0 || form.uploadFrom || form.uploadTo) ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-6 px-2 text-xs"
                onClick={() =>
                  setForm((f) => ({ ...f, documentIds: [], uploadFrom: '', uploadTo: '' }))
                }
              >
                清除过滤
              </Button>
            ) : null}
          </div>
          <p className="text-xs text-muted-foreground">
            限定只在选中文档 / 上传时间范围内的片段中检索；留空 = 不限。
          </p>
          {!filterSupported ? (
            <p className="text-xs text-amber-600">
              当前引擎不支持文档/时间范围过滤，过滤条件不可用
            </p>
          ) : null}
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="min-w-0">
              <label className={fieldLabel}>限定文档（多选）</label>
              {!filterSupported ? (
                <div className="rounded-md border border-input bg-card px-2 py-1 text-xs text-amber-600">
                  引擎不支持过滤，文档列表不可用
                </div>
              ) : documents.length === 0 ? (
                <div className="rounded-md border border-input bg-card px-2 py-1 text-xs text-muted-foreground">
                  该库暂无文档
                </div>
              ) : (
                <div className="max-h-44 overflow-auto rounded-md border border-input bg-card p-1">
                  {documents.map((doc) => {
                    const selectable = doc.enabled === 1;
                    const checked = form.documentIds.includes(doc.id);
                    return (
                      <label
                        key={doc.id}
                        className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-muted/60"
                        title={doc.title}
                      >
                        <input
                          type="checkbox"
                          className="h-3.5 w-3.5 shrink-0"
                          checked={checked}
                          // 停用文档后端必然清洗掉（enabled=1），勾了也白勾，直接禁选
                          disabled={!selectable}
                          onChange={(e) => {
                            const next = e.target.checked
                              ? [...form.documentIds, doc.id]
                              : form.documentIds.filter((id) => id !== doc.id);
                            setForm((f) => ({ ...f, documentIds: next }));
                          }}
                        />
                        <span className="min-w-0 flex-1 truncate">{doc.title}</span>
                        {!selectable ? (
                          <Badge variant="outline" className="shrink-0 text-[0.65rem]">
                            已停用
                          </Badge>
                        ) : null}
                      </label>
                    );
                  })}
                </div>
              )}
            </div>
            <div className="min-w-0">
              <label className={fieldLabel}>上传时间范围（按 kb_document.created_at）</label>
              <div className="grid grid-cols-2 gap-2">
                <Input
                  type="datetime-local"
                  aria-label="上传时间起"
                  value={form.uploadFrom}
                  disabled={!filterSupported}
                  onChange={(e) => setForm((f) => ({ ...f, uploadFrom: e.target.value }))}
                />
                <Input
                  type="datetime-local"
                  aria-label="上传时间止"
                  value={form.uploadTo}
                  disabled={!filterSupported}
                  onChange={(e) => setForm((f) => ({ ...f, uploadTo: e.target.value }))}
                />
              </div>
            </div>
          </div>
        </div>

        <div>
          <label className={fieldLabel}>测试问题</label>
          <Input
            value={form.question}
            onChange={(e) => setForm((f) => ({ ...f, question: e.target.value }))}
            placeholder="输入一个真实用户可能会问的问题"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !running) void onRun();
            }}
          />
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 border-t pt-3">
          <Button
            size="sm"
            variant="outline"
            disabled={!current && !previous}
            onClick={() => {
              setCurrent(null);
              setPrevious(null);
            }}
          >
            <RotateCcw className="h-4 w-4" />
            清空结果
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={currentHits.length === 0}
            onClick={() => exportCsv(current?.question ?? '', currentHits, current?.result.synonym)}
          >
            <Download className="h-4 w-4" />
            导出 CSV
          </Button>
          <PermissionGate permission="kb:hittest:run">
            <Button size="sm" disabled={running || libraryId == null} onClick={() => void onRun()}>
              <Play className="h-4 w-4" />
              {running ? '执行中…' : '执行测试'}
            </Button>
          </PermissionGate>
        </div>
      </div>

      {/* ------------------------------------------------------ 生效参数与降级提示 */}
      {current ? (
        <EffectiveParamsPanel result={current.result} filterEcho={current.filterEcho} />
      ) : null}

      {/* ------------------------------------------------------ 同义词扩展轨迹（唯一回显出口，T13） */}
      {current?.result.synonym ? <KbSynonymTraceCard expansion={current.result.synonym} /> : null}

      {/* ------------------------------------------------------ 结果（含 WA-14 并排对比） */}
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-2">
        <section className="flex min-h-0 flex-col">
          <div className="mb-2 flex items-center gap-2">
            <h3 className="text-sm font-medium">本次结果</h3>
            {current ? (
              <>
                <Badge variant="secondary" className="tabular-nums">
                  {currentHits.length} 条
                </Badge>
                <span className="text-xs text-muted-foreground">
                  耗时 {current.result.elapsedMs ?? '-'} ms · {current.at}
                </span>
                <KbSynonymStatusBadge expansion={current.result.synonym ?? null} />
              </>
            ) : null}
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            <KbHitTestResultList
              hits={currentHits}
              emptyText={current ? '本次未命中任何片段' : '尚未执行测试'}
            />
          </div>
        </section>

        <section className="flex min-h-0 flex-col">
          <div className="mb-2 flex items-center gap-2">
            <h3 className="text-sm font-medium">上一次结果（对比）</h3>
            {previous ? (
              <>
                <Badge variant="outline" className="tabular-nums">
                  {previousHits.length} 条
                </Badge>
                <span className="text-xs text-muted-foreground">
                  耗时 {previous.result.elapsedMs ?? '-'} ms · {previous.at}
                </span>
                <KbSynonymStatusBadge expansion={previous.result.synonym ?? null} />
              </>
            ) : null}
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            {previous ? (
              <>
                <p className="mb-2 truncate text-xs text-muted-foreground" title={previous.question}>
                  问题：{previous.question}
                </p>
                <KbHitTestResultList
                  hits={previousHits}
                  emptyText="上一次未命中任何片段"
                  compact
                />
              </>
            ) : (
              <div className="flex h-full min-h-[8rem] items-center justify-center rounded-md border border-dashed text-sm text-muted-foreground">
                改一个参数再跑一次，即可与上一次结果并排对比（切换知识库会清空）
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

/**
 * 生效参数回显 + 降级原因（WA-14 / WA-02）。
 *
 * @param filterEcho 本次请求的过滤条件摘要（KE-08/09 结果回显）；无过滤时为空。
 */
function EffectiveParamsPanel({
  result,
  filterEcho,
}: {
  result: KbHitTestResult;
  filterEcho?: string | null;
}) {
  const p: KbEffectiveParams | null = result.effectiveParams;
  const reasons = p?.degradedReasons ?? [];

  return (
    <div className="space-y-2 rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-medium">本次生效参数</h3>
        <Badge variant="outline">来源：{paramSourceLabel(p?.source)}</Badge>
        {result.degraded ? <Badge variant="destructive">已降级</Badge> : null}
      </div>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs sm:grid-cols-3 lg:grid-cols-4">
        <ParamItem label="检索方式" value={retrievalMethodLabel(p?.retrievalMethod)} />
        <ParamItem
          label="向量权重"
          value={p?.vectorSimilarityWeight == null ? '-' : p.vectorSimilarityWeight.toFixed(2)}
        />
        <ParamItem label="topK" value={p?.topK ?? '-'} />
        <ParamItem
          label="相似度阈值"
          value={p?.threshold == null ? '-' : p.threshold.toFixed(2)}
        />
        <ParamItem label="重排" value={p?.rerank ? '已启用' : '未启用'} />
        <ParamItem label="重排模型" value={p?.rerankModelId ?? '—'} />
        <ParamItem
          label="空结果策略"
          value={emptyResultStrategyLabel(result.emptyResultStrategy)}
        />
        <ParamItem label="耗时" value={`${result.elapsedMs ?? '-'} ms`} />
      </dl>
      {filterEcho ? (
        <p className="text-xs text-muted-foreground">本次过滤条件：{filterEcho}</p>
      ) : null}
      {p?.source === 'GLOBAL_DEFAULT' ? (
        <p className="text-xs text-muted-foreground">
          提示：本次参数来自全局默认而非库级设置（该库未配置或走了多库回落）。
        </p>
      ) : null}
      {reasons.length > 0 ? (
        <Alert>
          <AlertTitle>参数已自动降级</AlertTitle>
          <AlertDescription>
            <ul className="list-inside list-disc space-y-0.5 text-xs">
              {reasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}

/** 生效参数单项。 */
function ParamItem({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex items-center gap-2">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 flex-1 truncate font-medium tabular-nums">{value}</dd>
    </div>
  );
}
