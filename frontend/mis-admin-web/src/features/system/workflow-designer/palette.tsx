/**
 * 左侧节点面板（P7）：HTML5 拖拽 + 搜索过滤。
 */
import { useMemo, useState } from 'react';
import { GitBranch, Play, Settings, Flag, Users, CheckSquare, Search, Mail } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { NODE_LABELS, type WfNodeKind } from './types';

const KINDS: WfNodeKind[] = ['START', 'APPROVAL', 'CC', 'CONDITIONAL', 'ROUTING', 'AUTOMATION', 'END'];

const ICONS: Record<WfNodeKind, typeof Play> = {
  START: Play,
  APPROVAL: CheckSquare,
  CC: Mail,
  CONDITIONAL: GitBranch,
  ROUTING: Users,
  AUTOMATION: Settings,
  END: Flag,
};

export function Palette() {
  const [query, setQuery] = useState('');
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return KINDS;
    return KINDS.filter((k) => NODE_LABELS[k].toLowerCase().includes(q) || k.toLowerCase().includes(q));
  }, [query]);

  return (
    <div className="flex h-full w-[200px] shrink-0 flex-col border-r bg-card">
      <div className="border-b p-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索节点"
            className="h-8 pl-7 text-sm"
          />
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-1.5 overflow-auto p-2">
        {filtered.map((kind) => {
          const Icon = ICONS[kind];
          return (
            <div
              key={kind}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData('application/wf-node-kind', kind);
                e.dataTransfer.effectAllowed = 'move';
              }}
              className="flex cursor-move items-center gap-2 rounded-md border border-dashed border-border/60 p-2.5 text-[13px] transition hover:border-primary hover:bg-accent/40"
            >
              <Icon className="h-4 w-4 text-muted-foreground" />
              <span>{NODE_LABELS[kind]}</span>
            </div>
          );
        })}
      </div>
      <div className="border-t p-2 text-[11px] text-muted-foreground">拖拽到画布创建节点</div>
    </div>
  );
}

export default Palette;
