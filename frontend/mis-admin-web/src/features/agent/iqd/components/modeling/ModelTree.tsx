/**
 * ModelTree.tsx — 左栏模型树（v1.11 MR-S3，T02b-3）。
 *
 * <h2>数据来源（Q5 单源，🔴 关键）</h2>
 * 复用 {@link useCatalogNodes} 的 **catalog 缓存**（TanStack Query）。⚠️ 必须传**数字**
 * connId：queryKey 里是数字，传 store 里的字符串会得到**另一个 cache entry** ——
 * 结果是白拉两次、且树与画布**两处不同步**（画布刷新了树没刷新）。父组件已把
 * `string → number` 的转换收在 `iqd-modeling-page` 的 `toConnectionId()` 里。
 *
 * <h2>结构</h2>
 * 按 kind 分组：**模型 / 物理表（未建模）/ 指标（Cube）/ 关系**；组内按名称排序；
 * 顶部搜索框按 `display_name` / `item_key` 过滤。点节点 → `store.setSelectedItemKey`
 * （右栏 PropertyPanel 据此渲染，**不再发请求**）。
 *
 * <h2>导入入口</h2>
 * 顶部「表发现导入」按钮 → 回调父组件打开 `TableImportWizard`（本组件不自持向导状态，
 * 保持单一职责：树只负责展示与选择）。
 */
import { useMemo, useState } from 'react';
import { Database, GitBranch, Layers, Search, Table2, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { IqdCatalogItem } from '@/lib/api/iqd';
import { useCatalogNodes } from '../../hooks/useCatalogNodes';
import { useModelingStore } from '../../store/modeling-store';

/** 分组定义（顺序即展示顺序）。 */
const GROUPS: Array<{
  kind: string;
  title: string;
  icon: typeof Database;
  /** 该组是否只收「未建模的物理表」（与模型组互斥，避免同一张表出现两次）。 */
  unmodeledTablesOnly?: boolean;
}> = [
  { kind: 'model', title: '模型', icon: Layers },
  { kind: 'table', title: '物理表（未建模）', icon: Table2, unmodeledTablesOnly: true },
  { kind: 'cube', title: '指标（Cube）', icon: Database },
  { kind: 'relationship', title: '关系', icon: GitBranch },
];

/** `ModelTree` Props。 */
export interface ModelTreeProps {
  /** **数字**连接 id（见模块头「🔴 关键」）。 */
  connectionId: number | null;
  /** 「表发现导入」入口回调（父组件打开 TableImportWizard）。 */
  onOpenImport: () => void;
}

/** 左栏模型树。 */
export function ModelTree({ connectionId, onOpenImport }: ModelTreeProps) {
  const [keyword, setKeyword] = useState('');
  const { catalog, isLoading, error } = useCatalogNodes(connectionId);
  const selectedItemKey = useModelingStore((state) => state.selectedItemKey);
  const setSelected = useModelingStore((state) => state.setSelected);

  const grouped = useMemo(() => {
    const needle = keyword.trim().toLowerCase();
    const modeledTables = new Set(
      catalog
        .filter((item) => item.kind === 'model')
        .map((item) => (item.display_name ?? item.item_key).toLowerCase()),
    );

    return GROUPS.map((group) => {
      const items = catalog.filter((item) => {
        if (item.kind !== group.kind) {
          return false;
        }
        if (group.unmodeledTablesOnly) {
          const name = (item.display_name ?? item.item_key).toLowerCase();
          if (modeledTables.has(name)) {
            return false;
          }
        }
        if (needle === '') {
          return true;
        }
        return (
          (item.display_name ?? '').toLowerCase().includes(needle) ||
          item.item_key.toLowerCase().includes(needle)
        );
      });
      items.sort((a, b) =>
        (a.display_name ?? a.item_key).localeCompare(b.display_name ?? b.item_key),
      );
      return { ...group, items };
    });
  }, [catalog, keyword]);

  const totalShown = grouped.reduce((sum, group) => sum + group.items.length, 0);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* 工具区：搜索 + 导入入口 */}
      <div className="space-y-2 px-2 py-2">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            placeholder="搜索表 / 模型 / 指标…"
            className="h-8 pl-7 text-[13px]"
          />
        </div>
        <Button size="sm" variant="outline" className="w-full" onClick={onOpenImport}>
          <Upload className="h-4 w-4" />
          表发现导入
        </Button>
      </div>

      {/* 树体：单层滚动 */}
      <div className="min-h-0 flex-1 overflow-auto px-1 pb-2">
        {isLoading && <p className="px-2 py-1 text-[12px] text-muted-foreground">加载中…</p>}
        {!isLoading && error && (
          <p className="px-2 py-1 text-[12px] text-destructive">加载失败：{error}</p>
        )}
        {!isLoading && !error && totalShown === 0 && (
          <p className="px-2 py-1 text-[12px] text-muted-foreground">
            {catalog.length === 0 ? '该连接暂无模型，先用「表发现导入」。' : '无匹配项。'}
          </p>
        )}

        {grouped.map((group) => {
          if (group.items.length === 0) {
            return null;
          }
          const Icon = group.icon;
          return (
            <div key={group.kind} className="mb-1">
              <div className="flex items-center gap-1 px-2 py-1 text-[12px] font-medium text-muted-foreground">
                <Icon className="h-3.5 w-3.5" />
                {group.title}
                <span className="text-[11px]">({group.items.length})</span>
              </div>
              {group.items.map((item) => (
                <TreeLeaf
                  key={item.item_key}
                  item={item}
                  active={selectedItemKey === item.item_key}
                  onSelect={() => setSelected(item.item_key)}
                />
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** 叶子节点（模型/表/指标/关系通用）。 */
function TreeLeaf({
  item,
  active,
  onSelect,
}: {
  item: IqdCatalogItem;
  active: boolean;
  onSelect: () => void;
}) {
  const label = item.display_name ?? item.item_key;
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-[13px]',
        active ? 'bg-primary/10 text-primary' : 'hover:bg-accent/60',
      )}
      title={item.item_key}
    >
      <span className="truncate">{label}</span>
      {item.in_scope && (
        <Badge variant="outline" className="ml-auto h-4 shrink-0 px-1 text-[10px]">
          问数内
        </Badge>
      )}
      {item.source === 'modeling' && (
        <Badge variant="secondary" className="h-4 shrink-0 px-1 text-[10px]">
          建模台
        </Badge>
      )}
    </button>
  );
}

export default ModelTree;
