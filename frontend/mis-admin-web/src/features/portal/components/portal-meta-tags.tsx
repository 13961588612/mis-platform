import { cn } from '@/lib/utils';

interface PortalMetaTagsProps {
  appName: string;
  bizTypeName: string;
  className?: string;
}

/** 门户首页三板块行内元信息标签：`平台 / 关联应用` + `业务类型`。取值复用 usePortalLookups 三态。 */
export function PortalMetaTags({ appName, bizTypeName, className }: PortalMetaTagsProps) {
  const chip =
    'inline-block max-w-[8rem] truncate rounded bg-muted px-1.5 py-0.5 text-[10px] leading-4 text-muted-foreground';
  return (
    <span className={cn('inline-flex shrink-0 items-center gap-1', className)}>
      <span data-meta="app" title="平台 / 关联应用" className={chip}>
        {appName}
      </span>
      <span data-meta="biz-type" title="业务类型" className={chip}>
        {bizTypeName}
      </span>
    </span>
  );
}

export default PortalMetaTags;
