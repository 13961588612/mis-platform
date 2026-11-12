/**
 * ProjectPanel.tsx —— 「项目配置」Tab（Tab②，2026-09-29 分层）。
 *
 * 项目 = wren context（一个语义工程）：name / 选择的数据库连接（profile）/ 默认 connector /
 * 语言 / 超时 / 是否允许写回 MDL，以及 **MCP 进程启停**（= 项目的运行态）。
 *
 * 与「数据库连接配置」的关系：project : profile = N : 1（项目只选 profile，不重复填库坐标）。
 * 「可视化工作台」只按 **项目** 切换。
 */
import { useCallback, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Pencil, Play, Plus, RefreshCw, Square, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  deleteConnection,
  listConnections,
  mcpManage,
  updateConnection,
} from '../../api/iqd-modeling';
import { buildEnabledUpdate } from '../wizard/connectionEditUtils';
import { iqdKeys } from '../../queries/iqd-keys';
import { useIqdModelingPermission } from '../shared/usePermission';
import type { Connection } from '../../types/modeling';

const EDIT_PERM = 'iqd:modeling:edit';
const MCP_PERM = 'iqd:mcp:manage';

export interface ProjectPanelProps {
  /** 打开新建项目向导弹窗（父组件持有 ConnectionWizard）。 */
  onOpenCreate: () => void;
  /** 打开编辑某项目（父组件持有 ConnectionWizard edit）。 */
  onOpenEdit: (connection: Connection) => void;
}

export function ProjectPanel({ onOpenCreate, onOpenEdit }: ProjectPanelProps) {
  const queryClient = useQueryClient();
  const { hasPermission } = useIqdModelingPermission();
  const canEdit = hasPermission(EDIT_PERM);
  const canMcp = hasPermission(MCP_PERM);

  const listQuery = useQuery({
    queryKey: iqdKeys.connections(),
    queryFn: listConnections,
    staleTime: 5_000,
  });
  const projects = useMemo(() => listQuery.data ?? [], [listQuery.data]);

  const [busyId, setBusyId] = useState<number | null>(null);
  const [busyAction, setBusyAction] = useState<'start' | 'stop' | 'restart' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Connection | null>(null);

  const refresh = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: iqdKeys.connections() });
  }, [queryClient]);

  const runMcp = async (id: number, action: 'start' | 'stop' | 'restart') => {
    setBusyId(id);
    setBusyAction(action);
    setError(null);
    try {
      await mcpManage(id, action);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : `MCP ${action} 失败`);
    } finally {
      setBusyId(null);
      setBusyAction(null);
    }
  };

  const runToggle = async (c: Connection) => {
    if (c.id == null) return;
    setBusyId(c.id);
    setError(null);
    try {
      await updateConnection(c.id, buildEnabledUpdate(c.enabled === false));
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : '启停失败');
    } finally {
      setBusyId(null);
    }
  };

  const runDelete = async (c: Connection) => {
    if (c.id == null) return;
    setError(null);
    try {
      // 先尽力停 MCP（保留目录），再删库
      try { await mcpManage(c.id, 'stop', true, false); } catch { /* best-effort */ }
      await deleteConnection(c.id);
      setConfirmDelete(null);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : '删除项目失败');
      setConfirmDelete(null);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-[13px] text-muted-foreground">
          项目 = wren context（语义工程）。每个项目绑定一个数据库连接；「可视化工作台」按项目切换。
        </p>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => void refresh()} disabled={listQuery.isLoading}>
            <RefreshCw className={listQuery.isLoading ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
            刷新
          </Button>
          {canEdit && (
            <Button size="sm" onClick={onOpenCreate}>
              <Plus className="h-4 w-4" />
              新建项目
            </Button>
          )}
        </div>
      </div>

      {/* 两个状态的区别常被误会，此处明确固定说明 */}
      <Alert>
        <AlertTitle className="text-[13px]">两个状态分别是什么？</AlertTitle>
        <AlertDescription className="text-[12px] leading-5">
          <strong>启用状态</strong>：该项目是否<strong>纳入问数范围</strong>（用户问数时是否可选到它）——
          对应「启用 / 停用」按钮，<strong>不影响 MCP 进程</strong>。<br />
          <strong>MCP 进程</strong>：该项目的 wren 语义引擎进程是否在跑——
          对应「启动 / 停止 MCP」按钮，<strong>停止后该项目暂时不可问数</strong>。
        </AlertDescription>
      </Alert>

      {error && (
        <Alert variant="destructive">
          <AlertTitle className="text-[13px]">操作失败</AlertTitle>
          <AlertDescription className="text-[12px]">{error}</AlertDescription>
        </Alert>
      )}

      <div className="overflow-hidden rounded-lg border bg-card">
        <table className="w-full text-[13px]">
          <thead className="bg-muted/40">
            <tr className="text-left">
              <th className="px-3 py-2 font-medium">项目名</th>
              <th className="px-3 py-2 font-medium">数据库连接</th>
              <th className="px-3 py-2 font-medium">
                启用状态
                <span className="ml-1 font-normal text-muted-foreground">(是否纳入问数)</span>
              </th>
              <th className="px-3 py-2 font-medium">
                MCP 进程
                <span className="ml-1 font-normal text-muted-foreground">(语义引擎进程)</span>
              </th>
              <th className="px-3 py-2 text-right font-medium">操作</th>
            </tr>
          </thead>
          <tbody>
            {projects.map((c) => (
              <tr key={c.id ?? c.name} className="border-t border-border/60">
                <td className="px-3 py-2">
                  <span className="font-medium">{c.name}</span>
                </td>
                <td className="px-3 py-2 text-muted-foreground">
                  {c.profile_name ?? <span className="text-destructive">未绑定连接</span>}
                </td>
                <td className="px-3 py-2">
                  {/* 启用状态 = 是否纳入问数（iqd_connection.enabled），与 MCP 进程无关 */}
                  {c.enabled === false ? (
                    <Badge variant="secondary" className="text-[11px]">已停用</Badge>
                  ) : (
                    <Badge variant="default" className="text-[11px]">已启用</Badge>
                  )}
                </td>
                <td className="px-3 py-2">
                  {/* MCP 进程 = wren serve mcp 进程状态 */}
                  <Badge
                    variant={c.mcp_status === 'running' ? 'default' : 'outline'}
                    className="text-[11px]"
                  >
                    {c.mcp_status === 'running' ? '运行中' : c.mcp_status === 'stopped' ? '已停止' : (c.mcp_status ?? '未知')}
                    {c.mcp_port ? ` :${c.mcp_port}` : ''}
                  </Badge>
                </td>
                <td className="px-3 py-2">
                  <div className="flex items-center justify-end gap-1">
                    {canMcp && c.id != null && (
                      c.mcp_status === 'running' ? (
                        <Button
                          size="sm" variant="ghost" className="h-7 px-2 text-[12px] text-destructive"
                          disabled={busyId === c.id}
                          onClick={() => void runMcp(c.id!, 'stop')}
                          title="停止该项目的 wren serve mcp 进程"
                        >
                          {busyId === c.id && busyAction === 'stop' ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Square className="h-3.5 w-3.5" />
                          )}
                          停止 MCP
                        </Button>
                      ) : (
                        <Button
                          size="sm" variant="ghost" className="h-7 px-2 text-[12px]"
                          disabled={busyId === c.id}
                          onClick={() => void runMcp(c.id!, 'start')}
                          title="启动该项目的 wren serve mcp 进程（需先发布 MDL）"
                        >
                          {busyId === c.id && busyAction === 'start' ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Play className="h-3.5 w-3.5" />
                          )}
                          启动 MCP
                        </Button>
                      )
                    )}
                    {canEdit && (
                      <Button
                        size="sm" variant="ghost" className="h-7 px-2 text-[12px]"
                        disabled={busyId === c.id}
                        onClick={() => void runToggle(c)}
                        title={c.enabled === false ? '纳入问数范围' : '移出问数范围（不影响 MCP 进程）'}
                      >
                        {c.enabled === false ? '启用' : '停用'}
                      </Button>
                    )}
                    {canEdit && (
                      <Button
                        size="sm" variant="ghost" className="h-7 px-2 text-[12px]"
                        onClick={() => onOpenEdit(c)}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                        编辑
                      </Button>
                    )}
                    {canEdit && (
                      <Button
                        size="sm" variant="ghost" className="h-7 px-2 text-[12px] text-destructive"
                        onClick={() => setConfirmDelete(c)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        删除
                      </Button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {!listQuery.isLoading && projects.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-8 text-center text-muted-foreground">
                  还没有项目。点「新建项目」创建语义工程，并选择它要用的数据库连接。
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Dialog open={confirmDelete != null} onOpenChange={(next) => { if (!next) setConfirmDelete(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-[14px]">确认删除项目？</DialogTitle>
            <DialogDescription className="text-[12px]">
              将停止并删除项目「{confirmDelete?.name}」及其语义模型数据，不可恢复。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setConfirmDelete(null)}>取消</Button>
            <Button variant="destructive" size="sm"
              onClick={() => confirmDelete && void runDelete(confirmDelete)}>确认删除</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default ProjectPanel;
