/**
 * ConnectionManageDialog.tsx — 问数连接管理弹窗（列表 / 停 MCP / 停用 / 删除）。
 *
 * <p>解决「废连接缺 MDL 却 desired=running → self-healing 刷屏」时需要快速止血并物理删除。
 * 删除顺序：MCP stop(retainDir=false) → DELETE /connections/{id}（库内级联子表）。
 */
import { useCallback, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import {
  deleteConnection,
  listConnections,
  mcpManage,
  updateConnection,
} from '../../api/iqd-modeling';
import { buildEnabledUpdate } from './connectionEditUtils';
import { iqdKeys } from '../../queries/iqd-keys';
import { useIqdModelingPermission } from '../shared/usePermission';
import type { Connection } from '../../types/modeling';

const EDIT_PERM = 'iqd:modeling:edit';
const MCP_PERM = 'iqd:mcp:manage';

export interface ConnectionManageDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ConnectionManageDialog({ open, onOpenChange }: ConnectionManageDialogProps) {
  const queryClient = useQueryClient();
  const { hasPermission } = useIqdModelingPermission();
  const canEdit = hasPermission(EDIT_PERM);
  const canMcp = hasPermission(MCP_PERM);

  const connectionsQuery = useQuery({
    queryKey: iqdKeys.connections(),
    queryFn: listConnections,
    enabled: open,
    staleTime: 5_000,
  });
  const connections = connectionsQuery.data ?? [];

  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Connection | null>(null);

  const refresh = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: iqdKeys.connections() });
  }, [queryClient]);

  const stopMcp = async (id: number) => {
    setBusyId(id);
    setError(null);
    try {
      await mcpManage(id, 'stop', true, false);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : '停止 MCP 失败');
    } finally {
      setBusyId(null);
    }
  };

  const toggleEnabled = async (connection: Connection, next: boolean) => {
    if (connection.id == null) return;
    setBusyId(connection.id);
    setError(null);
    try {
      await updateConnection(connection.id, buildEnabledUpdate(next));
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : '更新启用状态失败');
    } finally {
      setBusyId(null);
    }
  };

  const doDelete = async () => {
    const target = confirmDelete;
    if (target?.id == null) return;
    const id = target.id;
    setBusyId(id);
    setError(null);
    try {
      // 先停 MCP 并尽量不保留 project 目录；失败仍继续删库（废连接常见 MCP 已崩）
      if (canMcp) {
        try {
          await mcpManage(id, 'stop', true, false);
        } catch {
          /* best-effort */
        }
      }
      await deleteConnection(id);
      setConfirmDelete(null);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : '删除连接失败');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="flex max-h-[85vh] w-full max-w-2xl flex-col gap-0 overflow-hidden p-0">
          <DialogHeader className="mx-0 mt-0 rounded-none border-b border-border/60 bg-[hsl(var(--dialog-header-bg))] px-4 py-3 pr-10">
            <DialogTitle className="text-[14px]">连接管理</DialogTitle>
            <DialogDescription className="text-[12px]">
              停止 MCP、停用或物理删除问数连接。删除会级联清理该连接下的 catalog / 范围 / 知识等，不可恢复。
            </DialogDescription>
          </DialogHeader>

          <div className="min-h-0 flex-1 space-y-2 overflow-auto px-4 py-3">
            {connectionsQuery.isLoading && (
              <p className="py-6 text-center text-[12px] text-muted-foreground">加载中…</p>
            )}
            {!connectionsQuery.isLoading && connections.length === 0 && (
              <p className="py-6 text-center text-[12px] text-muted-foreground">暂无连接</p>
            )}
            {connections.map((c) => {
              const id = c.id;
              const busy = id != null && busyId === id;
              const enabled = c.enabled !== false;
              return (
                <div
                  key={id ?? c.name}
                  className="flex flex-wrap items-center justify-between gap-2 rounded border border-border/60 p-2"
                >
                  <div className="min-w-0 space-y-0.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-[13px] font-medium">{c.name}</span>
                      <Badge variant="outline" className="font-mono text-[10px]">
                        id={id ?? '—'}
                      </Badge>
                      <Badge
                        variant="outline"
                        className={cn(
                          'text-[10px]',
                          enabled ? 'text-primary' : 'text-muted-foreground',
                        )}
                      >
                        {enabled ? '已启用' : '已停用'}
                      </Badge>
                      <Badge variant="outline" className="text-[10px]">
                        MCP {c.mcp_status ?? '未知'}
                      </Badge>
                    </div>
                    <p className="truncate font-mono text-[11px] text-muted-foreground">
                      {c.base_url || '—'}
                      {c.mcp_port != null ? ` · port ${c.mcp_port}` : ''}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-1">
                    {canMcp && id != null && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-[12px]"
                        disabled={busy || c.mcp_status === 'stopped'}
                        onClick={() => void stopMcp(id)}
                      >
                        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                        停 MCP
                      </Button>
                    )}
                    {canEdit && id != null && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-[12px]"
                        disabled={busy}
                        onClick={() => void toggleEnabled(c, !enabled)}
                      >
                        {enabled ? '停用' : '启用'}
                      </Button>
                    )}
                    {canEdit && id != null && (
                      <Button
                        size="sm"
                        variant="destructive"
                        className="h-7 text-[12px]"
                        disabled={busy}
                        onClick={() => setConfirmDelete(c)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        删除
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
            {error ? (
              <p className="rounded border border-destructive/30 bg-destructive/5 px-2 py-1.5 text-[12px] text-destructive">
                {error}
              </p>
            ) : null}
            {!canEdit && (
              <p className="text-[11px] text-muted-foreground">
                无 {EDIT_PERM} 权限时无法停用/删除；停 MCP 需 {MCP_PERM}。
              </p>
            )}
          </div>

          <DialogFooter className="mx-0 mb-0 rounded-none border-t border-border/60 px-4 py-3">
            <Button size="sm" variant="outline" onClick={() => onOpenChange(false)}>
              关闭
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={connectionsQuery.isFetching}
              onClick={() => void refresh()}
            >
              刷新
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={confirmDelete != null}
        onOpenChange={(next) => {
          if (!next) setConfirmDelete(null);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>确认删除连接？</DialogTitle>
            <DialogDescription className="text-[12px]">
              将删除「{confirmDelete?.name}」(id={confirmDelete?.id})，并级联清理其 catalog /
              范围 / ACL / 知识 / 样本 / 布局等。Wren 机 project 目录会尽量随停 MCP 清理。此操作不可恢复。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              size="sm"
              variant="outline"
              disabled={busyId != null}
              onClick={() => setConfirmDelete(null)}
            >
              取消
            </Button>
            <Button
              size="sm"
              variant="destructive"
              disabled={busyId != null}
              onClick={() => void doDelete()}
            >
              {busyId != null ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              确认删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
