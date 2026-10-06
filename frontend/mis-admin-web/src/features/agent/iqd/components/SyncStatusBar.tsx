/**
 * SyncStatusBar.tsx — 问数增强同步状态条（闭环补全 P0-4）。
 *
 * <p>轮询 GET /iqd/enhance/sync-status，渲染最近一次 build/index 阶段状态、
 * 回填计数与 mdl_hash；并提供「立即同步」（POST /iqd/enhance/sync，wait=false，
 * 接受即返回）与手动刷新。无作业记录时展示「尚未同步」。
 *
 * <p>轮询间隔取 {@link IQD_SYNC_POLL_INTERVAL_MS}（15s；2026-09-27 由 5s 下调，
 * 与建模台状态条 / 自愈面板同频）。
 *
 * <p>保存物料（sql-pair / knowledge）后由 BFF 自动触发同步，状态条随之推进。
 */
import { useEffect, useRef, useState } from 'react';
import { RefreshCw, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  getIqdEnhancementSyncStatus,
  syncIqdEnhancements,
  type IqdSyncStatus,
} from '@/lib/api/iqd';
import { IQD_SYNC_POLL_INTERVAL_MS } from './shared/useSyncStatus';

const STATUS_LABEL: Record<string, string> = {
  pending: '待处理',
  running: '进行中',
  success: '成功',
  failed: '失败',
  skipped: '已跳过',
};

type BadgeVariant = 'default' | 'secondary' | 'destructive' | 'outline';

function statusVariant(status?: string): BadgeVariant {
  switch (status) {
    case 'success':
      return 'default';
    case 'failed':
      return 'destructive';
    case 'running':
    case 'pending':
      return 'secondary';
    default:
      return 'outline';
  }
}

function fmtTime(v?: string | null): string {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
}

export function SyncStatusBar({ connectionId }: { connectionId: number | null }) {
  const [status, setStatus] = useState<IqdSyncStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = async () => {
    if (connectionId == null) {
      setStatus(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setStatus(await getIqdEnhancementSyncStatus(connectionId));
    } catch (e) {
      setError(e instanceof Error ? e.message : '获取同步状态失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    if (timer.current) clearInterval(timer.current);
    timer.current = setInterval(() => void load(), IQD_SYNC_POLL_INTERVAL_MS);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionId]);

  const triggerSync = async () => {
    if (connectionId == null) return;
    setSyncing(true);
    setError(null);
    try {
      await syncIqdEnhancements(connectionId, false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : '触发同步失败');
    } finally {
      setSyncing(false);
    }
  };

  const selfcheckWarnings: string[] = (() => {
    const raw = status?.publish_warnings;
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.map((x) => String(x)).filter((x) => x.trim().length > 0);
      }
    } catch {
      /* 非 JSON：按单条文本展示 */
    }
    return [String(raw)];
  })();

  return (
  /**
   * 解析发布后引擎侧自检告警（JSON 字符串数组文本）。
   *
   * <p>解析失败按单条原文展示（宁可多显示一行，也不静默吞掉自检结果）。
   */
    <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-card p-3 text-xs">
      <span className="font-semibold text-muted-foreground">增强同步状态</span>
      {status == null ? (
        <span className="text-muted-foreground">尚未同步</span>
      ) : (
        <>
          <span className="flex items-center gap-1">
            <span className="text-muted-foreground">构建</span>
            <Badge variant={statusVariant(status.build_status)}>
              {STATUS_LABEL[status.build_status ?? ''] ?? status.build_status}
            </Badge>
          </span>
          <span className="flex items-center gap-1">
            <span className="text-muted-foreground">索引</span>
            <Badge variant={statusVariant(status.index_status)}>
              {STATUS_LABEL[status.index_status ?? ''] ?? status.index_status}
            </Badge>
          </span>
          <span className="text-muted-foreground">
            回填 样本对 {status.synced_sql_pair_count ?? 0} / 知识 {status.synced_knowledge_count ?? 0}
          </span>
          {status.build_mdl_hash ? (
            <span className="font-mono" title={status.build_mdl_hash}>
              mdl {String(status.build_mdl_hash).slice(0, 12)}…
            </span>
          ) : null}
          <span className="text-muted-foreground">构建于 {fmtTime(status.build_at)}</span>
          {status.build_error ? (
            <span className="text-destructive" title={status.build_error}>
              构建错误
            </span>
          ) : null}
          {status.index_error ? (
            <span className="text-destructive" title={status.index_error}>
              索引错误
            </span>
          ) : null}
          {selfcheckWarnings.length > 0 ? (
            <span className="text-amber-600" title={selfcheckWarnings.join('\n')}>
              引擎自检 {selfcheckWarnings.length} 条告警
            </span>
          ) : null}
        </>
      )}
      {error ? <span className="text-destructive">{error}</span> : null}
      {selfcheckWarnings.length > 0 ? (
        <div className="w-full rounded border border-amber-500/40 bg-amber-500/5 px-2 py-1 text-[11px] text-amber-700">
          <div className="font-medium">发布后引擎侧自检：发现不一致（点刷新可重试）</div>
          <ul className="mt-0.5 list-disc pl-4">
            {selfcheckWarnings.slice(0, 3).map((w, i) => (
              <li key={"warn-" + i}>{w}</li>
            ))}
            {selfcheckWarnings.length > 3 ? (
              <li>…另有 {selfcheckWarnings.length - 3} 条（悬停徽标查看全部）</li>
            ) : null}
          </ul>
        </div>
      ) : null}
      <div className="ml-auto flex items-center gap-2">
        <Button size="sm" variant="outline" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={loading ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
          刷新
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => void triggerSync()}
          disabled={syncing || connectionId == null}
        >
          <Send className="h-4 w-4" />
          立即同步
        </Button>
      </div>
    </div>
  );
}

export default SyncStatusBar;
