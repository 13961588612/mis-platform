import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';

export interface ReportSubmitUserBodyProps {
  summary: string;
  detail: string;
  className?: string;
}

/** 模板报告用户气泡：首行人类摘要，原文默认折叠。 */
export function ReportSubmitUserBody({
  summary,
  detail,
  className,
}: ReportSubmitUserBodyProps) {
  const [open, setOpen] = useState(false);

  return (
    <div className={cn('space-y-1', className)}>
      <p className="whitespace-pre-wrap break-words font-medium text-primary-foreground">
        {summary}
      </p>
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger
          type="button"
          className="flex items-center gap-0.5 text-[11px] text-primary-foreground/75 hover:text-primary-foreground"
        >
          {open ? (
            <ChevronDown className="h-3 w-3 shrink-0" />
          ) : (
            <ChevronRight className="h-3 w-3 shrink-0" />
          )}
          <span>{open ? '收起原文' : '展开原文'}</span>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <p className="mt-1 whitespace-pre-wrap break-words text-[11px] leading-relaxed text-primary-foreground/80">
            {detail}
          </p>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
