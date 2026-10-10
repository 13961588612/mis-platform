import { Folder, FolderOpen } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { WfCategoryItem } from '@/lib/api/wf-category';

export interface WfCategoryTreeProps {
  /** 嵌套分类树（来自 `fetchWfCategoryTree`）。 */
  tree: WfCategoryItem[];
  /** 当前选中节点 id（字符串，对齐 `WfCategoryVO.id`）；null 表示「全部」。 */
  selectedId: string | null;
  /** 选中节点（含点击「全部」置空）。 */
  onSelect: (id: string | null) => void;
  loading?: boolean;
}

/**
 * 流程分类树（分类管理 Tab 左侧栏）。
 *
 * <p>复用表单定义分类树的「缩进 + 选中高亮」范式：根节点「全部分类」用于清空过滤，
 * 其余节点按 `children` 递归渲染并随层级缩进。点击节点通知父组件过滤右侧列表/编辑。
 */
export function WfCategoryTree({ tree, selectedId, onSelect, loading }: WfCategoryTreeProps) {
  return (
    <div className="space-y-0.5">
      <button
        type="button"
        onClick={() => onSelect(null)}
        className={cn(
          'mb-1 flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-sm',
          selectedId === null
            ? 'bg-primary/10 font-medium text-primary'
            : 'text-foreground hover:bg-accent',
        )}
      >
        <Folder className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="truncate">全部分类</span>
      </button>

      {loading && tree.length === 0 ? (
        <p className="px-2 py-2 text-sm text-muted-foreground">加载中…</p>
      ) : tree.length === 0 ? (
        <p className="px-2 py-2 text-sm text-muted-foreground">暂无分类</p>
      ) : (
        <TreeLevel nodes={tree} depth={0} selectedId={selectedId} onSelect={onSelect} />
      )}
    </div>
  );
}

interface TreeLevelProps {
  nodes: WfCategoryItem[];
  depth: number;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}

function TreeLevel({ nodes, depth, selectedId, onSelect }: TreeLevelProps) {
  return (
    <>
      {nodes.map((node) => {
        const active = selectedId === node.id;
        return (
          <div key={node.id}>
            <button
              type="button"
              onClick={() => onSelect(node.id)}
              style={{ paddingLeft: 8 + depth * 14 }}
              className={cn(
                'flex w-full items-center gap-1.5 rounded-md py-1.5 pr-2 text-left text-sm transition-colors',
                active ? 'bg-primary/10 font-medium text-primary' : 'text-foreground hover:bg-accent',
              )}
            >
              {active ? (
                <FolderOpen className="h-4 w-4 shrink-0 text-primary" />
              ) : (
                <Folder className="h-4 w-4 shrink-0 text-muted-foreground" />
              )}
              <span className="truncate">{node.name}</span>
              <span className="ml-auto shrink-0 font-mono text-[11px] text-muted-foreground">{node.code}</span>
            </button>
            {node.children?.length ? (
              <TreeLevel nodes={node.children} depth={depth + 1} selectedId={selectedId} onSelect={onSelect} />
            ) : null}
          </div>
        );
      })}
    </>
  );
}
