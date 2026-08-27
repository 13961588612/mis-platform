import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Boxes, FileText, FolderTree, MessageSquare, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { buildAppBreadcrumbs } from '@/components/common/app-breadcrumbs';
import { PageHeader } from '@/components/common/page-header';
import { SortIndicator } from '@/components/common/sort-indicator';
import { StatCard } from '@/components/common/stat-card';
import { useClientSort } from '@/components/common/use-client-sort';
import { useColumnWidths, type ResizableColumn } from '@/components/common/use-column-widths';
import { RESET_COL_WIDTH_OVERLAY_CLASS, ResetColWidthButton } from '@/components/common/header-action-buttons';
import { EngineHealthBadge } from './components/kb-badges';
import { listCategories, listLibraries, listMySessions } from './api/kb-api';
import { useKbStore } from './stores/use-kb-store';
import type { KbLibrary } from './types';
import { formatTime, secrecyLabel } from './types';

/** 引擎心跳轮询间隔（ms）：与 ai-platform 健康检查节奏保持同量级。 */
const HEALTH_POLL_MS = 30_000;

/** 概览「最近知识库」表列定义（可调列宽 + 可排序）。 */
const OVERVIEW_COLS: ResizableColumn[] = [
  { key: 'name', label: '知识库' },
  { key: 'secrecy', label: '密级' },
  { key: 'docCount', label: '文档数' },
  { key: 'engineType', label: '建库引擎' },
  { key: 'updatedAt', label: '更新时间' },
];

/**
 * 知识库概览页。
 *
 * <p>聚合分类数 / 知识库数 / 文档总数 / 我的问答数 + 引擎连通性，
 * 全部指标由既有 BFF 端点前端组合得出，不新增后端聚合接口。
 */
export function KbOverviewPage() {
  const [categoryCount, setCategoryCount] = useState(0);
  const [libraries, setLibraries] = useState<KbLibrary[]>([]);
  const [sessionCount, setSessionCount] = useState(0);
  const [loading, setLoading] = useState(false);

  const health = useKbStore((s) => s.health);
  const refreshEngine = useKbStore((s) => s.refreshEngine);
  const refreshHealth = useKbStore((s) => s.refreshHealth);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [cats, libs] = await Promise.all([listCategories(), listLibraries(null)]);
      setCategoryCount(cats.length);
      setLibraries(libs);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '加载知识库概览失败');
    } finally {
      setLoading(false);
    }
    // 问答历史失败不应阻断概览
    try {
      setSessionCount((await listMySessions()).length);
    } catch {
      setSessionCount(0);
    }
  }, []);

  useEffect(() => {
    void load();
    void refreshEngine();
  }, [load, refreshEngine]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void refreshHealth();
    }, HEALTH_POLL_MS);
    return () => window.clearInterval(timer);
  }, [refreshHealth]);

  const docTotal = libraries.reduce((sum, l) => sum + (l.docCount ?? 0), 0);
  const recentLibraries = useMemo(
    () =>
      [...libraries]
        .sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''))
        .slice(0, 8),
    [libraries],
  );

  /* 列宽 + 表头排序（一次性加载数据，前端排序无分页副作用） */
  const { widthOf, startResize, hasCustom, reset } = useColumnWidths(OVERVIEW_COLS, 'mis-kb-overview-table-widths');
  const getSortValue = useCallback((row: KbLibrary, key: string) => row[key as keyof KbLibrary], []);
  const { sorted, sortKey, sortDir, toggleSort } = useClientSort(recentLibraries, getSortValue);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title="知识库概览"
        description="分类、知识库、文档与问答的总体运行情况。"
        breadcrumbs={buildAppBreadcrumbs({ app: 'kb', title: '概览' })}
        actions={
          <Button
            size="sm"
            variant="outline"
            disabled={loading}
            onClick={() => {
              void load();
              void refreshEngine();
            }}
          >
            <RefreshCw className="h-4 w-4" />
            刷新
          </Button>
        }
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="分类数" value={categoryCount} icon={FolderTree} description="启用与停用合计" />
        <StatCard label="可见知识库" value={libraries.length} icon={Boxes} description="按可见性裁定后" />
        <StatCard label="文档总数" value={docTotal} icon={FileText} description="可见知识库内文档" />
        <StatCard label="我的问答" value={sessionCount} icon={MessageSquare} description="历史会话数" />
      </div>

      <Card className="mt-3 p-4 shadow-card">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-sm font-medium">当前平台引擎</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              类型：{health?.engineType ?? '未知'} · 状态：{health?.status ?? '未知'}
              {health?.detail ? ` · ${health.detail}` : ''}
            </p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              指 Nacos 当前生效的检索引擎；下方「建库引擎」是创建知识库时落库的绑定类型，二者可能不同。
            </p>
          </div>
          <div className="flex items-center gap-2">
            <EngineHealthBadge healthy={health?.healthy} />
            <Link
              to="/kb/engine"
              className="text-xs text-primary underline-offset-2 hover:underline"
            >
              查看详情
            </Link>
          </div>
        </div>
      </Card>

      <div className="relative mt-3 min-h-0 flex-1 overflow-auto rounded-lg border bg-table-surface">
        {hasCustom ? (
          <ResetColWidthButton onClick={reset} className={RESET_COL_WIDTH_OVERLAY_CLASS} />
        ) : null}
        <table className="w-full table-fixed border-separate border-spacing-0 bg-table-surface text-left text-sm">
          <thead className="border-b-2 border-foreground/20 bg-table-header text-muted-foreground">
            <tr>
              {OVERVIEW_COLS.map((c, ci) => {
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
                <td colSpan={5} className="px-3 py-10 text-center text-muted-foreground">
                  加载中…
                </td>
              </tr>
            ) : recentLibraries.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-3 py-10 text-center text-muted-foreground">
                  暂无可见知识库
                </td>
              </tr>
            ) : (
              sorted.map((lib) => (
                <tr
                  key={lib.id}
                  className="border-b border-border/50 bg-table-row last:border-0 even:bg-table-stripe hover:bg-table-hover"
                >
                  <td className="overflow-hidden text-ellipsis whitespace-nowrap px-3 py-2">{lib.name}</td>
                  <td className="overflow-hidden text-ellipsis whitespace-nowrap px-3 py-2">{secrecyLabel(lib.secrecy)}</td>
                  <td className="px-3 py-2 tabular-nums">{lib.docCount ?? 0}</td>
                  <td className="overflow-hidden text-ellipsis whitespace-nowrap px-3 py-2 text-xs text-muted-foreground">
                    <span className="font-mono">{lib.engineType ?? '-'}</span>
                    {health?.engineType &&
                    lib.engineType &&
                    lib.engineType !== health.engineType ? (
                      <span
                        className="ml-1.5 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-400"
                        title={`该库在 ${lib.engineType} 下创建；当前平台引擎为 ${health.engineType}。noop 占位库无法直接用于 ragflow 检索，需在 ragflow 下重建知识库并重新上传文档。`}
                      >
                        与平台不一致
                      </span>
                    ) : null}
                  </td>
                  <td className="overflow-hidden text-ellipsis whitespace-nowrap px-3 py-2 text-xs text-muted-foreground">{formatTime(lib.updatedAt)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
