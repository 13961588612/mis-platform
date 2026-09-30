/**
 * ProjectSwitcher.tsx —— 问数域「当前项目」统一切换器（2026-09-30）。
 *
 * <p>问数各页（可视化工作台 / 语义模型 / 范围与权限 / 知识与规则 / 试问）都以「项目」
 * （= wren context）为上下文。本组件把「当前项目」收敛到**一处 UI + 一个 store 槽位**
 * （{@link useModelingStore}.connectionId），切一处全问数域跟随、且跨页保持。
 *
 * <p>读取当前项目 id 请用 {@link useActiveProjectId}（hooks/useActiveProject.ts）。
 */
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FolderCog } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { listConnections } from '../../api/iqd-modeling';
import { iqdKeys } from '../../queries/iqd-keys';
import { useModelingStore } from '../../store/modeling-store';

/**
 * 项目切换下拉（问数各页页头统一用）。切换即写 store（跨页保持）。
 */
export function ProjectSwitcher({ className }: { className?: string }) {
  const connectionId = useModelingStore((s) => s.connectionId);
  const setConnectionId = useModelingStore((s) => s.setConnectionId);

  const { data, isLoading } = useQuery({
    queryKey: iqdKeys.connections(),
    queryFn: listConnections,
    staleTime: 30_000,
  });
  const connections = useMemo(() => (data ?? []).filter((c) => c.id != null), [data]);

  if (connections.length === 0) {
    return null;
  }

  return (
    <Select
      value={connectionId ?? ''}
      onValueChange={(v) => setConnectionId(v)}
      disabled={isLoading}
    >
      <SelectTrigger className={className ?? 'h-8 w-[19rem] pr-8'}>
        <FolderCog className="mr-1.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <SelectValue placeholder="选择项目" />
      </SelectTrigger>
      <SelectContent>
        {connections.map((c) => (
          <SelectItem key={c.id} value={String(c.id)}>
            <span className="flex items-center gap-2">
              {c.name}
              {c.profile_name ? (
                <span className="text-muted-foreground">· {c.profile_name}</span>
              ) : null}
              {c.mcp_status === 'running' ? (
                <Badge variant="default" className="text-[10px]">MCP 运行中</Badge>
              ) : null}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export default ProjectSwitcher;
