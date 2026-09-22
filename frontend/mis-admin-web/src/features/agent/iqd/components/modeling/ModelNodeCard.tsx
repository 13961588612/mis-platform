/**
 * ModelNodeCard.tsx — 画布节点卡（model / table 两态），v1.11 MR-S2。
 *
 * <h2>两种形态</h2>
 * <ul>
 *   <li><b>model</b>（`kind='model'`）：白底实线卡——已建模的语义模型，头部带「指标(N)」角标
 *       （Cube 不单独成节点，避免节点爆炸）；</li>
 *   <li><b>table</b>（`kind='table'`）：**浅灰虚线边框**——尚未建模的物理表，提示用户
 *       「这张表还只是个表，没被建模」。</li>
 * </ul>
 *
 * <h2>字段列表</h2>
 * 默认**只显示前 8 列**（A-15：200 节点下每卡全展开会让画布不可读），底部「显示全部 N 列」
 * 可展开。展开态是**卡片本地 state**（瞬时视图态、不跨页复用），故不进 zustand。
 *
 * <h2>列徽标</h2>
 * `PK`（`is_primary_key`）/ `计算列`（有 `expression`，T03 计算列）/ `脱敏`
 * （`mask_rule` 非空或 `sensitive_level ∈ {low, high}`）。最多并列 3 个，超出折叠为 `+N`。
 *
 * <p>样式遵守项目既有约定：圆角 4px（`rounded`）、标签 13px、主色 `#4f46e5`（`text-primary`
 * 由主题变量提供，勿硬编码）。
 */
import { memo, useState } from 'react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import type { IqdCatalogItem } from '@/lib/api/iqd';
import type { CatalogNodeData } from '../../hooks/useCatalogNodes';

/** 折叠时展示的字段数（A-15）。 */
const COLLAPSED_COLUMN_LIMIT = 8;

/** 列徽标上限（超出以 `+N` 折叠）。 */
const MAX_COLUMN_BADGES = 3;

/** 列徽标定义：命中即渲染（顺序 = 展示优先级）。 */
function columnBadges(column: IqdCatalogItem): string[] {
  const badges: string[] = [];
  if (column.is_primary_key) {
    badges.push('PK');
  }
  if (column.expression) {
    badges.push('计算列');
  }
  const sensitive = (column.sensitive_level ?? 'none') !== 'none' || Boolean(column.mask_rule);
  if (sensitive) {
    badges.push('脱敏');
  }
  return badges;
}

/** 节点卡组件（`nodeTypes` 注册为 `iqdModel` / `iqdTable`）。 */
function ModelNodeCardInner({ data, selected }: NodeProps<Node<CatalogNodeData>>) {
  const [expanded, setExpanded] = useState(false);
  const isTable = data.kind === 'table';
  const columns = data.columns ?? [];
  const visible = expanded ? columns : columns.slice(0, COLLAPSED_COLUMN_LIMIT);
  const hiddenCount = Math.max(0, columns.length - visible.length);

  return (
    <div
      className={cn(
        'rounded border bg-card shadow-card transition-shadow',
        // table（未建模物理表）：浅灰虚线边框
        isTable ? 'border-dashed border-muted-foreground/40 bg-muted/30' : 'border-border',
        selected && 'ring-2 ring-primary/50',
      )}
    >
      {/* 进出连线锚点（关系边用 smoothstep，一侧即可；双侧避免方向反转时错位） */}
      <Handle type="target" position={Position.Left} className="!h-2 !w-2 !bg-primary/60" />
      <Handle type="source" position={Position.Right} className="!h-2 !w-2 !bg-primary/60" />

      {/* 头部：表名 + 角标 */}
      <div className="flex items-center justify-between gap-2 border-b border-border/60 px-2.5 py-1.5">
        <span className="truncate text-[13px] font-medium" title={data.displayName}>
          {data.displayName}
        </span>
        <div className="flex shrink-0 items-center gap-1">
          {data.measureNames && data.measureNames.length > 0 && (
            <Badge
              variant="secondary"
              className="h-4 px-1 text-[10px]"
              title={`指标：${data.measureNames.join('、')}`}
            >
              指标 {data.measureNames.length}
            </Badge>
          )}
          {isTable && (
            <Badge variant="outline" className="h-4 px-1 text-[10px] text-muted-foreground">
              未建模
            </Badge>
          )}
          {data.inScope && (
            <Badge variant="outline" className="h-4 px-1 text-[10px]">
              问数内
            </Badge>
          )}
        </div>
      </div>

      {/* 字段列表 */}
      <div className="px-1 py-1">
        {visible.length === 0 && (
          <div className="px-1.5 py-1 text-[12px] text-muted-foreground">（无字段）</div>
        )}
        {visible.map((column) => {
          const badges = columnBadges(column);
          const shown = badges.slice(0, MAX_COLUMN_BADGES);
          const extra = badges.length - shown.length;
          return (
            <div
              key={column.item_key}
              className="flex items-center justify-between gap-2 rounded px-1.5 py-[3px] text-[13px] hover:bg-accent/60"
            >
              <span className="truncate" title={column.display_name ?? column.item_key}>
                {column.display_name ?? column.item_key}
              </span>
              <span className="flex shrink-0 items-center gap-1">
                {column.data_type && (
                  <span className="text-[11px] text-muted-foreground">{column.data_type}</span>
                )}
                {shown.map((badge) => (
                  <Badge
                    key={badge}
                    variant={badge === 'PK' ? 'default' : 'outline'}
                    className="h-4 px-1 text-[10px]"
                  >
                    {badge}
                  </Badge>
                ))}
                {extra > 0 && (
                  <span className="text-[10px] text-muted-foreground">+{extra}</span>
                )}
              </span>
            </div>
          );
        })}
      </div>

      {/* 折叠控制 */}
      {hiddenCount > 0 && (
        <button
          type="button"
          onClick={(event) => {
            // 阻止冒泡：否则 ReactFlow 会把它当成节点点击（选中/拖拽）
            event.stopPropagation();
            setExpanded(true);
          }}
          className="w-full border-t border-border/60 px-2 py-1 text-[12px] text-muted-foreground hover:bg-accent/60"
        >
          显示全部 {columns.length} 列（还有 {hiddenCount} 列）
        </button>
      )}
      {expanded && columns.length > COLLAPSED_COLUMN_LIMIT && (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            setExpanded(false);
          }}
          className="w-full border-t border-border/60 px-2 py-1 text-[12px] text-muted-foreground hover:bg-accent/60"
        >
          收起
        </button>
      )}
    </div>
  );
}

export const ModelNodeCard = memo(ModelNodeCardInner);
export default ModelNodeCard;
