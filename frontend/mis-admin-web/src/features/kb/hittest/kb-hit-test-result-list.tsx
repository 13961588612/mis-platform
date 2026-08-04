import { Badge } from '@/components/ui/badge';
import type { KbHitTestHit } from '../types';

/**
 * 命中结果列表（WA-08）。
 *
 * <p>展示 chunk 原文 / score / 来源文档 / 页码。原文<b>不截断</b>——命中测试的
 * 全部价值就在于看清召回了什么，截成一行摘要等于什么都没看。用 `whitespace-pre-wrap`
 * 保留原文换行，配 `max-h` + 滚动避免超长 chunk 撑爆页面。
 */
interface KbHitTestResultListProps {
  hits: KbHitTestHit[];
  /** 空态文案（不同上下文提示不同，如「尚未执行」vs「零命中」）。 */
  emptyText: string;
  /** 是否紧凑模式（对比视图用，字号更小）。 */
  compact?: boolean;
}

/** 分数展示：保留 4 位小数；null 显示占位。 */
function formatScore(score: number | null): string {
  if (score == null || !Number.isFinite(score)) return '-';
  return score.toFixed(4);
}

export function KbHitTestResultList({
  hits,
  emptyText,
  compact = false,
}: KbHitTestResultListProps) {
  if (hits.length === 0) {
    return (
      <div className="flex h-full min-h-[8rem] items-center justify-center rounded-md border border-dashed text-sm text-muted-foreground">
        {emptyText}
      </div>
    );
  }

  return (
    <ol className="space-y-2">
      {hits.map((h, i) => (
        <li
          key={`${h.documentId ?? 'na'}-${i}`}
          className="rounded-md border bg-card p-3 shadow-none"
        >
          <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
            <Badge variant="outline" className="tabular-nums">
              #{i + 1}
            </Badge>
            <Badge variant="secondary" className="tabular-nums">
              score {formatScore(h.score)}
            </Badge>
            <span className="truncate text-muted-foreground" title={h.docTitle ?? undefined}>
              {h.docTitle ?? '未知文档'}
            </span>
            {h.page != null ? (
              <span className="text-muted-foreground">第 {h.page} 页</span>
            ) : null}
            {h.offset != null ? (
              <span className="text-muted-foreground">偏移 {h.offset}</span>
            ) : null}
            {h.documentId != null ? (
              <span className="font-mono text-[0.7rem] text-muted-foreground">
                doc#{h.documentId}
              </span>
            ) : null}
          </div>
          <p
            className={
              compact
                ? 'max-h-32 overflow-auto whitespace-pre-wrap break-words text-xs leading-relaxed'
                : 'max-h-56 overflow-auto whitespace-pre-wrap break-words text-sm leading-relaxed'
            }
          >
            {h.chunkText ?? '（片段内容为空）'}
          </p>
        </li>
      ))}
    </ol>
  );
}
