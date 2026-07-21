import { useAuthStore } from '@/stores/auth-store';
import {
  ListPageSkeleton,
  StatusBadge,
  buildDemoRows,
} from '@/components/common/list-page-skeleton';

export function PlaceholderPage({ title, description }: { title: string; description?: string }) {
  const app = useAuthStore((s) => s.app);
  const prefix = title.replace(/\s+/g, '');
  const rows = buildDemoRows(prefix);

  return (
    <ListPageSkeleton
      title={title}
      description={description ?? '列表骨架：筛选 / 状态 Tab / 表头吸顶 / 分页 / 新建抽屉'}
      breadcrumbs={[
        { label: '门户', to: '/portal' },
        { label: app?.name ?? '系统管理' },
        { label: title },
      ]}
      statusTabs={[
        { key: 'all', label: '全部' },
        { key: 'enabled', label: '启用' },
        { key: 'disabled', label: '禁用' },
        { key: 'locked', label: '锁定' },
      ]}
      columns={[
        { key: 'id', title: '记录编号', render: (r) => r.id as string },
        { key: 'name', title: '名称', render: (r) => r.name as string },
        { key: 'org', title: '所属组织', render: (r) => r.org as string },
        {
          key: 'status',
          title: '状态',
          render: (r) => (
            <StatusBadge
              text={r.statusText as string}
              tone={r.tone as 'success' | 'warning' | 'destructive' | 'info'}
            />
          ),
        },
        { key: 'updatedAt', title: '更新时间', render: (r) => r.updatedAt as string },
        {
          key: 'actions',
          title: '操作',
          className: 'w-28',
          render: (r, { openView }) => (
            <button
              type="button"
              className="text-sm text-primary hover:underline"
              onClick={() => openView(r)}
            >
              详情
            </button>
          ),
        },
      ]}
      rows={rows}
      rowKey={(r) => r.id as string}
      emptyHint="暂无数据"
    />
  );
}
