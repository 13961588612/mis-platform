import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';

export interface BreadcrumbItem {
  label: string;
  to?: string;
}

interface PageHeaderProps {
  title: string;
  description?: string;
  breadcrumbs?: BreadcrumbItem[];
  actions?: ReactNode;
  className?: string;
}

/** 对齐门户：breadcrumb .75rem / page-title 1.25rem·600 / page-sub .8125rem */
export function PageHeader({
  title,
  description,
  breadcrumbs,
  actions,
  className,
}: PageHeaderProps) {
  return (
    <div className={cn('mb-3 flex flex-wrap items-end justify-between gap-3', className)}>
      <div className="min-w-0">
        {breadcrumbs && breadcrumbs.length > 0 ? (
          <nav
            className="mb-[0.375rem] flex flex-wrap items-center gap-[0.375rem] text-xs text-muted-foreground"
            aria-label="面包屑"
          >
            {breadcrumbs.map((item, i) => (
              <span key={`${item.label}-${i}`} className="inline-flex items-center gap-[0.375rem]">
                {i > 0 ? <span>/</span> : null}
                {item.to ? (
                  <Link to={item.to} className="hover:text-foreground">
                    {item.label}
                  </Link>
                ) : (
                  <span className={i === breadcrumbs.length - 1 ? 'font-medium text-foreground' : undefined}>
                    {item.label}
                  </span>
                )}
              </span>
            ))}
          </nav>
        ) : null}
        <h1 className="text-xl font-semibold leading-[1.4]">{title}</h1>
        {description ? (
          <p className="mt-[0.2rem] text-[0.8125rem] text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}
