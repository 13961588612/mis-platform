/**
 * 技能池左侧分类树：数据来自 ai_skill_category，不以 Skill.category 字符串拼树。
 */
import type { ReactNode } from 'react';
import { Folder, FolderOpen, Inbox, Pencil, Plus, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import type { SkillCatNode } from './skill-category-tree';

export const SKILL_CAT_ALL = '';
export const SKILL_CAT_UNCAT = '__uncat__';

export type SkillCatSel = typeof SKILL_CAT_ALL | typeof SKILL_CAT_UNCAT | string;

function TreeBtn({
  active,
  onClick,
  label,
  icon,
  count,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  icon: ReactNode;
  count?: number;
}) {
  return (
    <button
      type="button"
      className={cn(
        'flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-sm',
        active ? 'bg-primary/10 text-primary' : 'hover:bg-muted',
      )}
      onClick={onClick}
    >
      {icon}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {count != null ? (
        <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{count}</span>
      ) : null}
    </button>
  );
}

function CatLevel({
  nodes,
  depth,
  selected,
  counts,
  onSelect,
  onEdit,
  onDelete,
  onAddChild,
}: {
  nodes: SkillCatNode[];
  depth: number;
  selected: SkillCatSel;
  counts: Record<number, number>;
  onSelect: (s: SkillCatSel) => void;
  onEdit: (node: SkillCatNode) => void;
  onDelete: (node: SkillCatNode) => void;
  onAddChild: (parent: SkillCatNode) => void;
}) {
  return (
    <>
      {nodes.map((n) => {
        const key = String(n.id);
        const active = selected === key;
        return (
          <div key={n.id}>
            <div className="group flex items-center gap-0.5">
              <button
                type="button"
                className={cn(
                  'flex min-w-0 flex-1 items-center gap-1.5 rounded-md py-1.5 pr-1 text-left text-sm',
                  active ? 'bg-primary/10 text-primary' : 'hover:bg-muted',
                )}
                style={{ paddingLeft: 8 + depth * 12 }}
                onClick={() => onSelect(key)}
              >
                {active ? (
                  <FolderOpen className="h-4 w-4 shrink-0" />
                ) : (
                  <Folder className="h-4 w-4 shrink-0 text-muted-foreground" />
                )}
                <span className="min-w-0 flex-1 truncate">{n.name}</span>
                <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                  {counts[n.id] ?? 0}
                </span>
              </button>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="h-7 w-7 shrink-0 opacity-0 group-hover:opacity-100"
                onClick={() => onAddChild(n)}
                aria-label={`在 ${n.name} 下新建子分类`}
              >
                <Plus className="h-3.5 w-3.5" />
              </Button>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="h-7 w-7 shrink-0 opacity-0 group-hover:opacity-100"
                onClick={() => onEdit(n)}
                aria-label={`重命名分类 ${n.name}`}
              >
                <Pencil className="h-3.5 w-3.5" />
              </Button>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="h-7 w-7 shrink-0 text-destructive opacity-0 group-hover:opacity-100"
                onClick={() => onDelete(n)}
                aria-label={`删除分类 ${n.name}`}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
            {n.children.length ? (
              <CatLevel
                nodes={n.children}
                depth={depth + 1}
                selected={selected}
                counts={counts}
                onSelect={onSelect}
                onEdit={onEdit}
                onDelete={onDelete}
                onAddChild={onAddChild}
              />
            ) : null}
          </div>
        );
      })}
    </>
  );
}

export function AgentSkillCategoryTree({
  tree,
  counts,
  uncategorizedCount,
  totalCount,
  selected,
  onSelect,
  onEdit,
  onDelete,
  onAddChild,
}: {
  tree: SkillCatNode[];
  counts: Record<number, number>;
  uncategorizedCount: number;
  totalCount: number;
  selected: SkillCatSel;
  onSelect: (s: SkillCatSel) => void;
  onEdit: (node: SkillCatNode) => void;
  onDelete: (node: SkillCatNode) => void;
  onAddChild: (parent: SkillCatNode) => void;
}) {
  return (
    <div className="space-y-0.5">
      <TreeBtn
        active={selected === SKILL_CAT_ALL}
        onClick={() => onSelect(SKILL_CAT_ALL)}
        label="全部技能"
        icon={<Folder className="h-4 w-4" />}
        count={totalCount}
      />
      <TreeBtn
        active={selected === SKILL_CAT_UNCAT}
        onClick={() => onSelect(SKILL_CAT_UNCAT)}
        label="未分类"
        icon={<Inbox className="h-4 w-4" />}
        count={uncategorizedCount}
      />
      <CatLevel
        nodes={tree}
        depth={0}
        selected={selected}
        counts={counts}
        onSelect={onSelect}
        onEdit={onEdit}
        onDelete={onDelete}
        onAddChild={onAddChild}
      />
    </div>
  );
}
