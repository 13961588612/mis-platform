import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Boxes, FileText, FolderTree, MessageSquare, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { PageHeader } from '@/components/common/page-header';
import { StatCard } from '@/components/common/stat-card';
import { EngineHealthBadge } from './components/kb-badges';
import { listCategories, listLibraries, listMySessions } from './api/kb-api';
import { useKbStore } from './stores/use-kb-store';
import type { KbLibrary } from './types';
import { formatTime, secrecyLabel } from './types';

/** 引擎心跳轮询间隔（ms）：与 ai-platform 健康检查节奏保持同量级。 */
const HEALTH_POLL_MS = 30_000;

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
  const recentLibraries = [...libraries]
    .sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''))
    .slice(0, 8);

  return (
    <div className="flex min-h-0 flex-1 flex-col p-4 md:p-5">
      <PageHeader
        title="知识库概览"
        description="分类、知识库、文档与问答的总体运行情况。"
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
            <p className="text-sm font-medium">检索引擎</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              类型：{health?.engineType ?? '未知'} · 状态：{health?.status ?? '未知'}
              {health?.detail ? ` · ${health.detail}` : ''}
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

      <div className="mt-3 min-h-0 flex-1 overflow-auto rounded-lg border bg-table-surface">
        <table className="w-full bg-table-surface text-left text-sm">
          <thead className="sticky top-0 z-10 border-b-2 border-foreground/20 bg-table-header text-muted-foreground backdrop-blur">
            <tr>
              <th className="px-3 py-2 font-bold">知识库</th>
              <th className="px-3 py-2 font-bold">密级</th>
              <th className="px-3 py-2 font-bold">文档数</th>
              <th className="px-3 py-2 font-bold">引擎</th>
              <th className="px-3 py-2 font-bold">更新时间</th>
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
              recentLibraries.map((lib) => (
                <tr
                  key={lib.id}
                  className="border-b border-border/50 bg-table-row last:border-0 even:bg-table-stripe hover:bg-table-hover"
                >
                  <td className="px-3 py-2">{lib.name}</td>
                  <td className="px-3 py-2">{secrecyLabel(lib.secrecy)}</td>
                  <td className="px-3 py-2 tabular-nums">{lib.docCount ?? 0}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">{lib.engineType ?? '-'}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">{formatTime(lib.updatedAt)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
