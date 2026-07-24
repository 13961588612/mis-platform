import * as React from 'react';
import { cn } from '@/lib/utils';

// 骨架屏：AI 请求中占位，非流式用 Skeleton，流式累积也用它占位。
function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('animate-pulse rounded-md bg-muted/70', className)} {...props} />;
}

export { Skeleton };
