import { Columns2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

/** 页头操作按钮统一高度：与「新增」默认按钮对齐（h-9） */
export const HEADER_ACTION_BTN_CLASS = 'h-9 min-h-9 shrink-0 [&_svg]:size-4 [&_svg]:shrink-0';

/** 表格内浮层「重置列宽」定位（相对 relative 容器） */
export const RESET_COL_WIDTH_OVERLAY_CLASS = 'absolute right-3 top-3 z-20';

export function ResetColWidthButton({
  onClick,
  className,
}: {
  onClick: () => void;
  className?: string;
}) {
  return (
    <Button type="button" variant="outline" className={cn(HEADER_ACTION_BTN_CLASS, className)} onClick={onClick}>
      <Columns2 className="h-4 w-4" />
      重置列宽
    </Button>
  );
}
