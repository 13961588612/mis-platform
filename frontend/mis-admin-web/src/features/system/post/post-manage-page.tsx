import { useState } from 'react';
import { cn } from '@/lib/utils';
import { ListChecks, Tags } from 'lucide-react';
import { AdminListPage } from '@/features/system/admin-list-page';
import { SYSTEM_PAGE_DEFS } from '@/features/system/page-defs';
import { PostTypeManagePage } from './post-type-manage-page';
import { usePostTypeVersionStore } from './post-type-version-store';

type PostSubTab = 'posts' | 'types';

/** 岗位管理页子 Tab（岗位列表 / 岗位类型）；嵌入各子页 PageHeader actions 头部。 */
function PostSubTabs({ tab, onChange }: { tab: PostSubTab; onChange: (t: PostSubTab) => void }) {
  return (
    <div className="inline-flex rounded-md border bg-muted/40 p-0.5 text-sm">
      <button
        type="button"
        onClick={() => onChange('posts')}
        className={cn(
          'inline-flex items-center gap-1 rounded px-2.5 py-1 font-medium',
          tab === 'posts' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground',
        )}
      >
        <ListChecks className="h-3.5 w-3.5" />
        岗位列表
      </button>
      <button
        type="button"
        onClick={() => onChange('types')}
        className={cn(
          'inline-flex items-center gap-1 rounded px-2.5 py-1 font-medium',
          tab === 'types' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground',
        )}
      >
        <Tags className="h-3.5 w-3.5" />
        岗位类型
      </button>
    </div>
  );
}

/**
 * 岗位管理页（/system/post）：子 Tab 结构（岗位列表 / 岗位类型），不新建菜单。
 *
 * <p>岗位列表 = 既有 AdminListPage 引擎（保持现状）；岗位类型 = 类型管理子页。
 * 类型变更后 bump post-type-version-store → 以版本号作为 key 重挂载列表引擎，
 * 岗位列表与下拉（loadPostTypeOptions）同源刷新（P0-PT-03）。
 */
export function PostManagePage() {
  const [tab, setTab] = useState<PostSubTab>('posts');
  const postTypeVersion = usePostTypeVersionStore((s) => s.postTypeVersion);
  const subTabs = <PostSubTabs tab={tab} onChange={setTab} />;

  if (tab === 'types') {
    return <PostTypeManagePage headerExtra={subTabs} />;
  }
  return (
    <AdminListPage
      key={postTypeVersion}
      def={SYSTEM_PAGE_DEFS['/system/post']}
      headerExtra={subTabs}
    />
  );
}
