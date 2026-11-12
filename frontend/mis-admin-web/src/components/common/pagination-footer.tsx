import { Button } from '@/components/ui/button';

/**
 * 列表页分页条：左侧「共 N 条 · 第 p/total 页」，右侧上/下一页。
 *
 * <p>原先在 inbox-page / task-list-page / my-sent-page / my-processed-page
 * 等 7 处各写一份完全相同的内联 div，统一到此处。
 */
export function PaginationFooter({
  total,
  page,
  totalPages,
  onPageChange,
  itemLabel = '条',
}: {
  total: number;
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  /** 计数单位文案，默认「条」。 */
  itemLabel?: string;
}) {
  return (
    <div className="flex items-center justify-between text-sm text-muted-foreground">
      <span>
        共<b className="text-foreground">{total}</b>
        {itemLabel} · 第 {page}/{totalPages} 页
      </span>
      <div className="flex gap-2">
        <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
          上一页
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
        >
          下一页
        </Button>
      </div>
    </div>
  );
}