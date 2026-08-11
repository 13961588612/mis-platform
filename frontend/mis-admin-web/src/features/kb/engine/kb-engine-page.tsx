import { useCallback, useEffect, useState } from 'react';
import { PlayCircle, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { PageHeader } from '@/components/common/page-header';
import { buildAppBreadcrumbs } from '@/components/common/app-breadcrumbs';
import { PermissionGate } from '@/components/auth/permission-gate';
import { CapabilityBadge, EngineHealthBadge } from '../components/kb-badges';
import { getReconcileReport, runReconcile } from '../api/kb-api';
import { useKbStore } from '../stores/use-kb-store';
import type { KbEngineReconcileReport } from '../types';
import { formatTime } from '../types';

/** 引擎类型说明（S-04 Port/Adapter，切换由 Nacos `mis.kb.engine.type` 决定）。 */
const ENGINE_DESC: Record<string, string> = {
  ragflow: 'RAGFlow 引擎：完整解析 / 切片 / 向量检索能力，需外部 Compose 栈就绪。',
  noop: '空实现引擎：所有检索返回空结果，用于关闭 RAG 能力时的安全降级。',
  mock: '模拟引擎：返回固定桩数据，用于本地开发与联调，不依赖外部服务。',
};

/** 明细表最多渲染的行数（后端已按 200 截断，这里再兜一层，避免一屏几千行）。 */
const MAX_ROWS = 50;

/**
 * 引擎配置页（只读展示 + 对账）。
 *
 * <p>引擎类型由 Nacos 配置项 `mis.kb.engine.type` 决定，不允许运行时从前端切换
 * （避免与索引数据状态不一致）；本页呈现当前生效引擎、连通性、能力清单与对账结果。
 *
 * <p>对账区（T04）解决的是「引擎侧和 MIS 侧悄悄对不上」——归档改名失败、
 * 引擎侧被人手工删库、旧流程留下的游离 dataset，这些平时都没有任何征兆，
 * 直到某天检索突然返回空。
 */
export function KbEnginePage() {
  const health = useKbStore((s) => s.health);
  const capabilities = useKbStore((s) => s.capabilities);
  const loading = useKbStore((s) => s.loading);
  const refreshEngine = useKbStore((s) => s.refreshEngine);

  const [report, setReport] = useState<KbEngineReconcileReport | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  const loadReport = useCallback(async () => {
    setReportLoading(true);
    setReportError(null);
    try {
      setReport(await getReconcileReport());
    } catch (e) {
      setReportError(e instanceof Error ? e.message : '获取对账报告失败');
    } finally {
      setReportLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshEngine();
    void loadReport();
  }, [refreshEngine, loadReport]);

  async function onRunReconcile() {
    setRunning(true);
    try {
      const next = await runReconcile();
      setReport(next);
      setReportError(null);
      if (next.skipped === true) {
        toast.info(next.skipReason ?? '当前引擎不参与对账');
      } else {
        toast.success('对账完成');
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '对账失败');
    } finally {
      setRunning(false);
    }
  }

  const engineType = health?.engineType ?? capabilities?.engineType ?? null;
  const deleteSupported = capabilities?.deleteSupported === true;
  const counts = report?.counts ?? null;
  const skipped = report?.skipped === true;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-auto">
      <PageHeader
        title="检索引擎"
        description="当前生效的知识库检索引擎、能力清单与引擎侧一致性对账。"
        breadcrumbs={buildAppBreadcrumbs({ app: 'kb', title: '引擎配置' })}
        actions={
          <Button size="sm" variant="outline" disabled={loading} onClick={() => void refreshEngine()}>
            <RefreshCw className="h-4 w-4" />
            重新探测
          </Button>
        }
      />

      <Alert className="mb-3">
        <AlertTitle>引擎切换方式</AlertTitle>
        <AlertDescription>
          引擎类型由配置中心的 <code className="font-mono text-xs">mis.kb.engine.type</code>{' '}
          决定（可选 ragflow / noop / mock），修改后需重启或刷新 mis-kb 配置。为避免索引状态错乱，
          不提供前端在线切换。
        </AlertDescription>
      </Alert>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Card className="p-4 shadow-card">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-sm font-medium">连通性</p>
            <EngineHealthBadge healthy={health?.healthy} />
          </div>
          <dl className="space-y-2 text-sm">
            <div className="flex items-start justify-between gap-3">
              <dt className="text-muted-foreground">引擎类型</dt>
              <dd className="font-mono text-xs">{engineType ?? '未知'}</dd>
            </div>
            <div className="flex items-start justify-between gap-3">
              <dt className="text-muted-foreground">状态</dt>
              <dd className="font-mono text-xs">{health?.status ?? '未知'}</dd>
            </div>
            <div className="flex items-start justify-between gap-3">
              <dt className="shrink-0 text-muted-foreground">诊断</dt>
              <dd className="min-w-0 break-words text-right text-xs text-muted-foreground">
                {health?.detail ?? '（无）'}
              </dd>
            </div>
          </dl>
          {engineType && ENGINE_DESC[engineType] ? (
            <p className="mt-3 rounded-md bg-secondary/40 px-2.5 py-2 text-xs text-muted-foreground">
              {ENGINE_DESC[engineType]}
            </p>
          ) : null}
        </Card>

        <Card className="p-4 shadow-card">
          <p className="mb-3 text-sm font-medium">能力清单</p>
          <div className="flex flex-wrap gap-2">
            <CapabilityBadge label="重排 rerank" supported={capabilities?.rerankSupported} />
            <CapabilityBadge label="元数据过滤" supported={capabilities?.metadataFilterSupported} />
            <CapabilityBadge label="文档替换" supported={capabilities?.replaceSupported} />
            <CapabilityBadge label="在线删除" supported={capabilities?.deleteSupported} />
          </div>
          {!deleteSupported ? (
            <p className="mt-2 text-xs text-warning">
              当前版本经归档流程处理，删除不下发引擎——知识库「归档」只改引擎侧名称并在
              MIS 停用，引擎数据需运维按「删除指引单」手工清理。
            </p>
          ) : null}
          <div className="mt-3">
            <p className="mb-1.5 text-xs text-muted-foreground">引擎自述能力项</p>
            <div className="flex flex-wrap gap-1.5">
              {capabilities?.capabilities && capabilities.capabilities.length > 0 ? (
                capabilities.capabilities.map((c) => (
                  <Badge key={c} variant="outline">
                    {c}
                  </Badge>
                ))
              ) : (
                <span className="text-xs text-muted-foreground">（无）</span>
              )}
            </div>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            能力为 false 的项，其相关配置在「知识库管理」中会被灰化，避免下发引擎不支持的参数。
          </p>
        </Card>
      </div>

      {/* ------------------------------------------------ 引擎对账（T04） */}
      <Card className="mt-3 p-4 shadow-card">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-sm font-medium">引擎对账</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              上次对账：{formatTime(report?.lastRunAt)}
              {report?.engineType ? ` · 引擎 ${report.engineType}` : ''}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={reportLoading}
              onClick={() => void loadReport()}
            >
              <RefreshCw className="h-4 w-4" />
              刷新报告
            </Button>
            <PermissionGate permission="kb:engine:reconcile">
              <Button size="sm" disabled={running} onClick={() => void onRunReconcile()}>
                <PlayCircle className="h-4 w-4" />
                {running ? '对账中…' : '立即对账'}
              </Button>
            </PermissionGate>
          </div>
        </div>

        {reportError ? (
          <p className="rounded-md border border-destructive/40 bg-destructive/10 p-2.5 text-xs text-destructive">
            {reportError}
          </p>
        ) : skipped ? (
          /* noop/mock 不参与对账是常态，整块给说明而不是报错 */
          <p className="rounded-md border border-dashed border-border p-3 text-xs text-muted-foreground">
            当前引擎不支持对账{report?.skipReason ? `：${report.skipReason}` : ''}。
            切到 ragflow 引擎后本区块自动生效。
          </p>
        ) : report == null ? (
          <p className="text-xs text-muted-foreground">加载中…</p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
              <CountTile label="参与比对" value={counts?.total} />
              <CountTile label="一致" value={counts?.consistent} tone="success" />
              <CountTile label="引擎缺失" value={counts?.missingInEngine} tone="destructive" />
              <CountTile label="游离 dataset" value={counts?.orphan} tone="warning" />
              <CountTile label="名称漂移" value={counts?.nameDrift} tone="warning" />
            </div>

            <div className="mt-3 space-y-3">
              <DetailBlock
                title="MIS 有、引擎无（检索必失败）"
                empty="无"
                rows={(report.missingInEngine ?? []).slice(0, MAX_ROWS).map((it) => ({
                  key: `m-${it.libraryId}`,
                  cells: [
                    `#${it.libraryId ?? '-'}`,
                    it.name ?? '-',
                    it.engineLibraryRef ?? '（未绑定）',
                  ],
                }))}
                head={['库 ID', '库名', '失效 dataset_id']}
              />
              <DetailBlock
                title="引擎有、MIS 无（游离 dataset，占存储）"
                empty="无"
                rows={(report.orphans ?? []).slice(0, MAX_ROWS).map((it) => ({
                  key: `o-${it.nativeId}`,
                  cells: [
                    it.nativeId ?? '-',
                    it.nativeName ?? '-',
                    it.docCount == null ? '-' : String(it.docCount),
                    formatTime(it.firstSeenAt),
                  ],
                }))}
                head={['dataset_id', '引擎侧名称', '文档数', '首次发现']}
              />
              <DetailBlock
                title="名称漂移（两侧都在但名字对不上）"
                empty="无"
                rows={(report.nameDrift ?? []).slice(0, MAX_ROWS).map((it) => ({
                  key: `d-${it.libraryId}`,
                  cells: [
                    `#${it.libraryId ?? '-'}`,
                    it.name ?? '-',
                    it.expectedName ?? '-',
                    it.actualName ?? '（未知）',
                  ],
                }))}
                head={['库 ID', '库名', '期望名称', '实际名称']}
              />
            </div>
          </>
        )}
      </Card>
    </div>
  );
}

/** 计数瓦片；`tone` 只在计数 > 0 时着色，避免一屏全是红。 */
function CountTile({
  label,
  value,
  tone = 'default',
}: {
  label: string;
  value: number | null | undefined;
  tone?: 'default' | 'success' | 'warning' | 'destructive';
}) {
  const n = value ?? 0;
  const colored = n > 0 && tone !== 'default';
  return (
    <div className="rounded-md border border-border bg-muted/30 px-2.5 py-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p
        className={
          colored
            ? tone === 'success'
              ? 'text-lg font-semibold text-success'
              : tone === 'warning'
                ? 'text-lg font-semibold text-warning'
                : 'text-lg font-semibold text-destructive'
            : 'text-lg font-semibold text-foreground'
        }
      >
        {n}
      </p>
    </div>
  );
}

/** 可折叠明细表（默认折叠，差异为 0 时直接显示「无」）。 */
function DetailBlock({
  title,
  head,
  rows,
  empty,
}: {
  title: string;
  head: string[];
  rows: { key: string; cells: string[] }[];
  empty: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-md border border-border">
      <button
        type="button"
        className="flex w-full items-center justify-between px-3 py-2 text-left text-xs font-medium hover:bg-accent/50"
        onClick={() => setOpen((v) => !v)}
      >
        <span>
          {title}
          <span className="ml-2 font-normal text-muted-foreground">{rows.length} 条</span>
        </span>
        <span className="text-muted-foreground">{open ? '收起' : '展开'}</span>
      </button>
      {open ? (
        rows.length === 0 ? (
          <p className="px-3 pb-2 text-xs text-muted-foreground">{empty}</p>
        ) : (
          <div className="overflow-auto px-3 pb-2">
            <table className="w-full text-left text-xs">
              <thead className="text-muted-foreground">
                <tr>
                  {head.map((h) => (
                    <th key={h} className="whitespace-nowrap py-1 pr-3 font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.key} className="border-t border-border/50">
                    {r.cells.map((c, i) => (
                      <td key={i} className="break-all py-1 pr-3 font-mono">
                        {c}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : null}
    </div>
  );
}
