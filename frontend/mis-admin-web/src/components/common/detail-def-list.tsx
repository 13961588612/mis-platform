import { Fragment, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface DefItem {
  /** 属性名（靠右对齐） */
  label: string;
  /** 属性值（靠左对齐）；null / '' / undefined 渲染为 — */
  value: ReactNode;
  /** 去重 key；缺省用 label */
  key?: string;
}

export interface DetailDefListProps {
  items: DefItem[];
  className?: string;
}

/**
 * 详情定义列表（DetailDefList）
 * ───────────────────────────────────────────────
 * 用途：对象详情页右侧「基础信息」等成对属性展示。
 *
 * 对齐规范（产品要求）：
 *  - 属性名靠右、属性值靠左；
 *  - 默认（>=sm）一行两对（属性名+值），窄屏（<sm）退回一行一对；
 *  - 标签列 auto 宽度 + 右对齐，保证同一列的属名右边缘上下严格对齐。
 *
 * 实现：单个 <dl> 网格，每个 DefItem 贡献一个 <dt>（属性名）+ 一个 <dd>（值）。
 * 桌面 `grid-cols-[auto_1fr_auto_1fr]` → 视觉上两对/行；
 * 移动 `grid-cols-[auto_1fr]` → 一对/行。
 */
function renderValue(value: ReactNode) {
  if (Array.isArray(value) && value.every((v) => typeof v === 'string' || typeof v === 'number')) {
    if (value.length === 0) return <span className="text-muted-foreground">—</span>;
    return (
      <span className="flex flex-wrap items-center gap-1">
        {value.map((v, i) => (
          <span
            key={i}
            className="inline-flex items-center rounded-md border border-border bg-muted/40 px-1.5 py-0.5 text-[0.75rem] text-muted-foreground"
          >
            {String(v)}
          </span>
        ))}
      </span>
    );
  }
  if (value == null || value === '') return <span className="text-muted-foreground">—</span>;
  return <>{value}</>;
}

export function DetailDefList({ items, className }: DetailDefListProps) {
  return (
    <dl
      className={cn(
        'grid grid-cols-[auto_1fr] gap-x-4 gap-y-2.5 sm:grid-cols-[auto_1fr_auto_1fr] sm:gap-x-8',
        className,
      )}
    >
      {items.map((it) => (
        <Fragment key={it.key ?? it.label}>
          <dt className="whitespace-nowrap pr-1 text-right text-xs text-muted-foreground">{it.label}</dt>
          <dd className="min-w-0 break-all text-left text-sm">{renderValue(it.value)}</dd>
        </Fragment>
      ))}
    </dl>
  );
}
