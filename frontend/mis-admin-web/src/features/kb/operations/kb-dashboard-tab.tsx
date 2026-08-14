import { useCallback, useEffect, useState } from 'react';
import {
  Database,
  MessageSquare,
  RefreshCw,
  Star,
  Ticket,
  ThumbsUp,
  TrendingUp,
  TriangleAlert,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { StatCard } from '@/components/common/stat-card';
import { todayLocalDate } from '@/lib/utils';
import { getDashboard } from '../api/kb-api';
import type {
  KbDashboard,
  KbDashboardDimensionCount,
  KbDashboardDocumentScore,
  KbDashboardLibraryScore,
  KbDashboardQuestionCount,
} from '../types';

const fieldLabel = 'mb-[0.3rem] block text-xs font-medium text-muted-foreground';

/** 整数展示：null → 0（计数类指标缺失即 0，语义安全）。 */
function count(v: number | null | undefined): number {
  return v == null || !Number.isFinite(v) ? 0 : v;
}

/** 均分展示：null → `-`（0 分与「无数据」必须区分，不能拿 0 兜底）。 */
function avg(v: number | null | undefined): string {
  return v == null || !Number.isFinite(v) ? '-' : v.toFixed(2);
}

/** 百分比展示：后端给的是 0-1 小数 or 0-100？统一按 0-1 处理，>1 视为已是百分数。 */
function percent(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '-';
  const p = v > 1 ? v : v * 100;
  return `${p.toFixed(1)}%`;
}

/**
 * 评价看板页签（A-02b / A-02d）。
 *
 * <p>趋势图与各类分布图均用纯 CSS 柱状/列表实现，**不引入图表库**：当前只有单序列日趋势 +
 * 若干条形分布，为此拉 recharts（~500KB）不划算；后续要做多序列联动再评估。
 *
 * <p>`feedbackRate` 后端口径可能是 0-1 小数也可能是 0-100 百分数，
 * 这里按 `>1 即已是百分数` 兼容——两种口径下展示都正确。好评/差评口径见后端 VO 注释
 * （表无点赞点踩字段，按 accuracy/helpful 折算综合分）。
 */
export function KbDashboardTab() {
  const [from, setFrom] = useState(todayLocalDate);
  const [to, setTo] = useState(todayLocalDate);
  const [data, setData] = useState<KbDashboard | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (f: string, t: string) => {
    setLoading(true);
    try {
      setData(await getDashboard(f || null, t || null));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '加载看板失败');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const today = todayLocalDate();
    void load(today, today);
  }, [load]);

  const trend = data?.trend ?? [];
  const topLibraries = data?.topLibraries ?? [];
  const negativeDimensions = data?.negativeDimensions ?? [];
  const topNegativeQuestions = data?.topNegativeQuestions ?? [];
  const lowScoreLibraries = data?.lowScoreLibraries ?? [];
  const lowScoreDocuments = data?.lowScoreDocuments ?? [];

  const maxTrend = trend.reduce((m, p) => Math.max(m, count(p.sessionCount)), 0);
  const maxHit = topLibraries.reduce((m, l) => Math.max(m, count(l.hitCount)), 0);
  const maxDim = negativeDimensions.reduce((m, d) => Math.max(m, count(d.count)), 0);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto">
      <div className="flex shrink-0 flex-wrap items-end gap-2 rounded-lg border bg-card p-3">
        <div className="w-40">
          <label className={fieldLabel}>起始日期</label>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div className="w-40">
          <label className={fieldLabel}>截止日期</label>
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <Button size="sm" disabled={loading} onClick={() => void load(from, to)}>
          <RefreshCw className="h-4 w-4" />
          刷新
        </Button>
        <span className="text-xs text-muted-foreground">留空表示全时段统计。</span>
      </div>

      <div className="grid shrink-0 grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="问答会话"
          value={count(data?.sessionCount)}
          icon={MessageSquare}
          description={`消息 ${count(data?.messageCount)} 条`}
        />
        <StatCard
          label="反馈覆盖率"
          value={percent(data?.feedbackRate)}
          icon={TrendingUp}
          description={`已评价 ${count(data?.feedbackCount)} 次`}
        />
        <StatCard
          label="准确性均分"
          value={avg(data?.avgAccuracy)}
          icon={Star}
          description="0-5 分，越高越好"
        />
        <StatCard
          label="有用性均分"
          value={avg(data?.avgHelpful)}
          icon={ThumbsUp}
          description="0-5 分，越高越好"
        />
        <StatCard
          label="跑题反馈"
          value={count(data?.offtopicCount)}
          icon={TriangleAlert}
          description="被标记跑题的次数"
        />
        <StatCard
          label="引用错误反馈"
          value={count(data?.citeErrorCount)}
          icon={TriangleAlert}
          description="被标记引用错误的次数"
        />
        <StatCard
          label="待处理工单"
          value={count(data?.openTickets)}
          icon={Ticket}
          description={`累计 ${count(data?.totalTickets)} 单`}
        />
        <StatCard
          label="待处理反馈"
          value={count(data?.pendingFeedback)}
          icon={MessageSquare}
          description="feedback_status=pending"
        />
        <StatCard
          label="热门知识库"
          value={topLibraries.length}
          icon={Database}
          description="有命中记录的知识库数"
        />
        <StatCard
          label="好评率"
          value={percent(data?.positiveRate)}
          icon={ThumbsUp}
          description={`好评 ${count(data?.positiveCount)} / 差评 ${count(data?.negativeCount)}`}
        />
        <StatCard
          label="综合平均分"
          value={avg(data?.avgScore)}
          icon={Star}
          description="accuracy/helpful 折算"
        />
        <StatCard
          label="好评数"
          value={count(data?.positiveCount)}
          icon={ThumbsUp}
          description="综合分 ≥ 4"
        />
        <StatCard
          label="差评数"
          value={count(data?.negativeCount)}
          icon={TriangleAlert}
          description="综合分 ≤ 2 或跑题/引用错误"
        />
      </div>

      <div className="grid min-h-0 grid-cols-1 gap-3 lg:grid-cols-2">
        <section className="rounded-lg border bg-card p-3">
          <h3 className="mb-3 flex items-center gap-1.5 text-sm font-semibold">
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
            日趋势（会话 / 反馈 / 均分）
          </h3>
          {trend.length === 0 ? (
            <p className="py-8 text-center text-xs text-muted-foreground">暂无趋势数据</p>
          ) : (
            <div className="flex h-48 items-end gap-1 overflow-x-auto">
              {trend.map((p) => {
                const s = count(p.sessionCount);
                const f = count(p.feedbackCount);
                const h = maxTrend === 0 ? 0 : Math.round((s / maxTrend) * 100);
                const fh = maxTrend === 0 ? 0 : Math.round((f / maxTrend) * 100);
                const scoreText =
                  p.avgScore == null || !Number.isFinite(p.avgScore) ? '无评分' : `${p.avgScore.toFixed(2)} 分`;
                return (
                  <div
                    key={p.date}
                    className="flex min-w-[1.5rem] flex-1 flex-col items-center justify-end gap-1"
                    title={`${p.date} · 会话 ${s} · 反馈 ${f} · 均分 ${scoreText}`}
                  >
                    <div className="flex h-40 w-full items-end justify-center gap-0.5">
                      <div
                        className="w-1/2 rounded-t bg-primary/70"
                        style={{ height: `${h}%`, minHeight: s > 0 ? '2px' : '0' }}
                      />
                      <div
                        className="w-1/2 rounded-t bg-primary/25"
                        style={{ height: `${fh}%`, minHeight: f > 0 ? '2px' : '0' }}
                      />
                    </div>
                    <span className="w-full truncate text-center text-[10px] text-muted-foreground">
                      {p.date.slice(5)}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
          <div className="mt-2 flex items-center gap-3 text-[10px] text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <span className="inline-block h-2 w-2 rounded-sm bg-primary/70" />
              会话
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="inline-block h-2 w-2 rounded-sm bg-primary/25" />
              反馈
            </span>
            <span className="inline-flex items-center gap-1">均分见悬浮提示</span>
          </div>
        </section>

        <section className="rounded-lg border bg-card p-3">
          <h3 className="mb-3 flex items-center gap-1.5 text-sm font-semibold">
            <Database className="h-4 w-4 text-muted-foreground" />
            热门知识库 TOP
          </h3>
          {topLibraries.length === 0 ? (
            <p className="py-8 text-center text-xs text-muted-foreground">暂无命中数据</p>
          ) : (
            <ul className="space-y-2">
              {topLibraries.map((l, i) => {
                const hit = count(l.hitCount);
                const w = maxHit === 0 ? 0 : Math.round((hit / maxHit) * 100);
                return (
                  <li key={`${l.libraryId ?? 'x'}-${i}`} className="text-xs">
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <span className="min-w-0 truncate">
                        {l.libraryName ?? (l.libraryId == null ? '未知知识库' : `#${l.libraryId}`)}
                      </span>
                      <span className="shrink-0 tabular-nums text-muted-foreground">{hit}</span>
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary">
                      <div className="h-full rounded-full bg-primary/70" style={{ width: `${w}%` }} />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>

      <div className="grid min-h-0 grid-cols-1 gap-3 lg:grid-cols-3">
        {/* 图1：差评维度分布 */}
        <section className="rounded-lg border bg-card p-3">
          <h3 className="mb-3 flex items-center gap-1.5 text-sm font-semibold">
            <TriangleAlert className="h-4 w-4 text-muted-foreground" />
            差评维度分布
          </h3>
          {negativeDimensions.length === 0 ? (
            <p className="py-8 text-center text-xs text-muted-foreground">暂无差评数据</p>
          ) : (
            <ul className="space-y-3">
              {negativeDimensions.map((d: KbDashboardDimensionCount) => {
                const c = count(d.count);
                const w = maxDim === 0 ? 0 : Math.round((c / maxDim) * 100);
                return (
                  <li key={d.code} className="text-xs">
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <span className="min-w-0 truncate">{d.label ?? d.code}</span>
                      <span className="shrink-0 tabular-nums text-muted-foreground">{c}</span>
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary">
                      <div
                        className="h-full rounded-full bg-destructive/70"
                        style={{ width: `${w}%`, minHeight: c > 0 ? '2px' : '0' }}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* 图2：高频差评问 Top10 */}
        <section className="rounded-lg border bg-card p-3">
          <h3 className="mb-3 flex items-center gap-1.5 text-sm font-semibold">
            <MessageSquare className="h-4 w-4 text-muted-foreground" />
            高频差评问 Top10
          </h3>
          {topNegativeQuestions.length === 0 ? (
            <p className="py-8 text-center text-xs text-muted-foreground">暂无差评问数据</p>
          ) : (
            <ol className="space-y-1.5">
              {topNegativeQuestions.map((q: KbDashboardQuestionCount, i) => (
                <li
                  key={`${q.sessionId ?? 'x'}-${i}`}
                  className="flex items-start gap-2 text-xs"
                >
                  <span className="shrink-0 rounded bg-secondary px-1.5 py-0.5 tabular-nums text-muted-foreground">
                    {i + 1}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate" title={q.question ?? ''}>
                      {q.question ?? '(空提问)'}
                    </span>
                    <span className="text-[10px] text-muted-foreground">
                      出现 {count(q.count)} 次
                    </span>
                  </span>
                </li>
              ))}
            </ol>
          )}
        </section>

        {/* 图3：低分库 / 低分文档 TopN */}
        <section className="rounded-lg border bg-card p-3">
          <h3 className="mb-3 flex items-center gap-1.5 text-sm font-semibold">
            <Star className="h-4 w-4 text-muted-foreground" />
            低分库 / 低分文档 TopN
          </h3>
          {lowScoreLibraries.length === 0 && lowScoreDocuments.length === 0 ? (
            <p className="py-8 text-center text-xs text-muted-foreground">暂无低分归因数据</p>
          ) : (
            <div className="space-y-3">
              {lowScoreLibraries.length > 0 && (
                <div>
                  <p className="mb-1.5 text-[11px] font-medium text-muted-foreground">
                    低分知识库（按均分升序）
                  </p>
                  <ul className="space-y-1">
                    {lowScoreLibraries.map((l: KbDashboardLibraryScore, i) => (
                      <li
                        key={`${l.libraryId ?? 'x'}-${i}`}
                        className="flex items-center justify-between gap-2 text-xs"
                      >
                        <span className="min-w-0 truncate">
                          {l.libraryName ?? (l.libraryId == null ? '未知库' : `#${l.libraryId}`)}
                        </span>
                        <span className="shrink-0 tabular-nums text-destructive">
                          {avg(l.avgScore)} · {count(l.ratedCount)}评
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {lowScoreDocuments.length > 0 && (
                <div>
                  <p className="mb-1.5 text-[11px] font-medium text-muted-foreground">
                    低分文档（按均分升序）
                  </p>
                  <ul className="space-y-1">
                    {lowScoreDocuments.map((d: KbDashboardDocumentScore, i) => (
                      <li
                        key={`${d.documentId ?? 'x'}-${i}`}
                        className="flex items-center justify-between gap-2 text-xs"
                      >
                        <span className="min-w-0 truncate" title={d.title ?? ''}>
                          {d.title ?? (d.documentId == null ? '未知文档' : `#${d.documentId}`)}
                        </span>
                        <span className="shrink-0 tabular-nums text-destructive">
                          {avg(d.avgScore)} · {count(d.ratedCount)}评
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
