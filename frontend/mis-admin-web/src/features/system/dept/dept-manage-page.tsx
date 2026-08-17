import { useState } from 'react';
import { cn } from '@/lib/utils';
import { ListChecks, Tags } from 'lucide-react';
import { DeptTreePage } from './dept-tree-page';
import { DeptTypeManagePage } from './dept-type-manage-page';
import { useDeptTypeVersionStore } from './dept-type-version-store';

type DeptSubTab = 'tree' | 'types';

/** 部门管理页子 Tab（部门树 / 部门类型）；嵌入各子页 PageHeader actions 头部。 */
function DeptSubTabs({ tab, onChange }: { tab: DeptSubTab; onChange: (t: DeptSubTab) => void }) {
  return (
    <div className="inline-flex rounded-md border bg-muted/40 p-0.5 text-sm">
      <button
        type="button"
        onClick={() => onChange('tree')}
        className={cn(
          'inline-flex items-center gap-1 rounded px-2.5 py-1 font-medium',
          tab === 'tree' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground',
        )}
      >
        <ListChecks className="h-3.5 w-3.5" />
        部门树
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
        部门类型
      </button>
    </div>
  );
}

/**
 * 部门管理页（/system/dept）：子 Tab 结构（部门树 / 部门类型），不新建菜单。
 *
 * <p>部门树 = 既有 DeptTreePage 引擎（保持现状）；部门类型 = 类型管理子页。
 * 类型变更后 bump dept-type-version-store → 以版本号作为 key 重挂载部门树引擎，
 * 部门树 loader 与类型下拉（DeptTypeTreeSelect）同源刷新（P0-PT-03）。
 */
export function DeptManagePage() {
  const [tab, setTab] = useState<DeptSubTab>('tree');
  const deptTypeVersion = useDeptTypeVersionStore((s) => s.deptTypeVersion);
  const subTabs = <DeptSubTabs tab={tab} onChange={setTab} />;

  if (tab === 'types') {
    return <DeptTypeManagePage headerExtra={subTabs} />;
  }
  return (
    <DeptTreePage
      key={deptTypeVersion}
      headerExtra={subTabs}
    />
  );
}
