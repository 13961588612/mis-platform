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
import { selectableConnections, useActiveProjectId } from '../../hooks/useActiveProject';
import { iqdKeys } from '../../queries/iqd-keys';
import { useModelingStore } from '../../store/modeling-store';

/**
 * 项目切换下拉（问数各页页头统一用）。切换即写 store（跨页保持）。
 */
export function ProjectSwitcher({ className }: { className?: string }) {
  // 复用 useActiveProjectId：它在 store 为空时自动选中「可用项目」（优先 name=default，
  // 否则最小 id），并在当前选项已不存在时回落 —— 避免切换器初始显示空占位。
  const activeProjectId = useActiveProjectId();
  const setConnectionId = useModelingStore((s) => s.setConnectionId);

  const { data, isLoading } = useQuery({
    queryKey: iqdKeys.connections(),
    queryFn: listConnections,
    staleTime: 30_000,
  });
  // 仅列 enabled 项目（与运行时裁定口径一致：停用连接不参与问数，不再出现在切换器里）。
  const connections = useMemo(() => selectableConnections(data ?? []), [data]);

  if (connections.length === 0) {
    return null;
  }

  return (
    <Select
      value={activeProjectId != null ? String(activeProjectId) : ''}
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
