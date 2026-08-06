/**
 * MCP 工具浏览器（UI#8，§4.3 #37 列工具 / #41 discover / #42 手动调用）。
 *
 * <p>⚠️ **#42 `callMcpTool` 是本控制台权限最高的入口**：它能直接执行任意 MCP 工具，
 * 等同于把下游系统的写能力交给调用者。因此：
 *   - 入口包 `PermissionGate permission="agent:mcp:call"` 且 **不传 fallback** ——
 *     无权限时**完全不渲染**，不做置灰。置灰会暴露"这里有个高危能力"并诱发申请，
 *     而 `agent:mcp:call`（§5.3 92060）默认不授予任何角色；
 *   - 执行前走 `AgentConfirmDialog` 的**强确认**（必须逐字输入工具名）；
 *   - 参数必须是合法 JSON 对象，前端先解析，不把畸形串丢给下游。
 *
 * <p>「断开后生效时机」提示：MCP 工具清单是**连接时**从 Server 拉取并缓存的。
 * 断开连接不会立刻让已绑定该工具的 Agent 报错，而是在下一次调用时才失败；
 * 反之新增工具也要重新 discover 才可见。这个延迟不写在界面上，运营会误判为"操作没生效"。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Info, Loader2, PlayCircle, RefreshCw, Wrench } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { PermissionGate } from '@/components/auth/permission-gate';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { AgentConfirmDialog } from '../components/agent-confirm-dialog';
import { callMcpTool, discoverMcpTools, listMcpTools } from '../api/agent-ops-api';
import { agentErrorMessage } from '../types';
import type { McpServer, McpTool } from '../types';

/** JSON 参数解析结果。 */
interface ParsedArgs {
  ok: boolean;
  value: Record<string, unknown>;
  message: string;
}

/** 参数必须是 JSON **对象**：数组 / 标量都不符合 MCP 的 `arguments` 契约。 */
function parseArguments(raw: string): ParsedArgs {
  const text = raw.trim();
  if (text === '') return { ok: true, value: {}, message: '' };
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ok: false, value: {}, message: '参数必须是 JSON 对象，例如 {"key": "value"}' };
    }
    return { ok: true, value: parsed as Record<string, unknown>, message: '' };
  } catch (e) {
    return { ok: false, value: {}, message: e instanceof Error ? e.message : 'JSON 解析失败' };
  }
}

export interface AgentMcpToolsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 目标 Server；null 时不渲染内容。 */
  server: McpServer | null;
  /** discover 成功后回调，供外层刷新 tool_count。 */
  onDiscovered?: () => void;
}

export function AgentMcpToolsDialog({
  open,
  onOpenChange,
  server,
  onDiscovered,
}: AgentMcpToolsDialogProps) {
  const [tools, setTools] = useState<McpTool[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [discovering, setDiscovering] = useState(false);

  const [activeTool, setActiveTool] = useState<McpTool | null>(null);
  const [argsText, setArgsText] = useState('{}');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [callResult, setCallResult] = useState<string>('');

  const serverName = server?.name ?? '';

  const load = useCallback(async () => {
    if (!serverName) return;
    setLoading(true);
    setError(null);
    try {
      setTools(await listMcpTools(serverName));
    } catch (e) {
      setTools([]);
      setError(agentErrorMessage(e, '获取 MCP 工具列表失败'));
    } finally {
      setLoading(false);
    }
  }, [serverName]);

  useEffect(() => {
    if (!open) return;
    setActiveTool(null);
    setArgsText('{}');
    setCallResult('');
    void load();
  }, [open, load]);

  async function onDiscover(): Promise<void> {
    if (!serverName) return;
    setDiscovering(true);
    try {
      const found = await discoverMcpTools(serverName);
      setTools(found);
      setError(null);
      toast.success(`已发现 ${found.length} 个工具`);
      onDiscovered?.();
    } catch (e) {
      toast.error(agentErrorMessage(e, '发现 MCP 工具失败'));
    } finally {
      setDiscovering(false);
    }
  }

  const parsedArgs = useMemo(() => parseArguments(argsText), [argsText]);

  async function runCall(): Promise<void> {
    if (!serverName || !activeTool || !parsedArgs.ok) return;
    try {
      const result = await callMcpTool(serverName, {
        tool: activeTool.name,
        arguments: parsedArgs.value,
      });
      setCallResult(JSON.stringify(result, null, 2));
      setConfirmOpen(false);
      toast.success(`工具 ${activeTool.name} 调用完成`);
    } catch (e) {
      toast.error(agentErrorMessage(e, '调用 MCP 工具失败'));
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="flex max-h-[85vh] w-[min(56rem,92vw)] max-w-none flex-col">
          <DialogHeader>
            <DialogTitle className="flex flex-wrap items-center gap-2">
              <Wrench className="h-4 w-4" />
              工具列表
              <span className="font-mono text-sm font-normal text-muted-foreground">
                {serverName}
              </span>
            </DialogTitle>
          </DialogHeader>

          <div className="flex flex-wrap items-center gap-2 pb-2">
            <Button size="sm" variant="outline" onClick={() => void load()} disabled={loading}>
              <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
              刷新
            </Button>
            <PermissionGate permission="agent:mcp:manage">
              <Button size="sm" variant="outline" onClick={() => void onDiscover()} disabled={discovering}>
                <RefreshCw className={cn('h-4 w-4', discovering && 'animate-spin')} />
                重新发现（#41）
              </Button>
            </PermissionGate>
            <span className="ml-auto text-xs text-muted-foreground">共 {tools.length} 个工具</span>
          </div>

          {/* 断开后生效时机 —— 不写在界面上运营会误判为"操作没生效" */}
          <div className="mb-2 flex gap-2 rounded-md border border-info/30 bg-info/5 p-3 text-xs text-muted-foreground">
            <Info className="mt-[0.1rem] h-3.5 w-3.5 shrink-0 text-info" />
            <p className="leading-relaxed">
              工具清单在<span className="font-medium text-foreground">连接时</span>
              拉取并缓存。断开连接不会立即让已在使用该工具的 Agent 报错，
              而是在其下一次调用时才失败；同理，Server 侧新增的工具需重新「发现」后才会出现在这里。
            </p>
          </div>

          <div className="min-h-0 flex-1 overflow-auto rounded-lg border">
            {loading ? (
              <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                加载中…
              </div>
            ) : error ? (
              <div className="flex flex-col items-center gap-3 py-12 text-center">
                <p className="max-w-lg break-words text-xs text-destructive">{error}</p>
                <Button size="sm" variant="outline" onClick={() => void load()}>
                  重试
                </Button>
              </div>
            ) : tools.length === 0 ? (
              <p className="py-12 text-center text-sm text-muted-foreground">
                该 Server 暂无工具。若已连接，请点「重新发现」。
              </p>
            ) : (
              <table className="w-full table-fixed border-separate border-spacing-0 text-left text-sm">
                <thead className="bg-table-header text-muted-foreground">
                  <tr>
                    <th className="w-[14rem] px-3 py-2 font-bold">工具名</th>
                    <th className="px-3 py-2 font-bold">描述</th>
                    <th className="w-[9rem] px-3 py-2 font-bold">入参</th>
                    <th className="w-[7rem] px-3 py-2 text-right font-bold">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {tools.map((tool) => {
                    const paramCount = Object.keys(
                      (tool.input_schema?.properties as Record<string, unknown> | undefined) ?? {},
                    ).length;
                    return (
                      <tr
                        key={tool.name}
                        className="border-b border-border/50 last:border-0 even:bg-table-stripe"
                      >
                        <td className="break-all px-3 py-2 font-mono text-xs">{tool.name}</td>
                        <td className="px-3 py-2 text-xs text-muted-foreground">
                          {tool.description ?? '-'}
                        </td>
                        <td className="px-3 py-2 text-xs text-muted-foreground">
                          {tool.input_schema ? `${paramCount} 个字段` : '未声明'}
                        </td>
                        <td className="px-3 py-2 text-right">
                          {/* 无 fallback：无 agent:mcp:call 的用户完全看不到此入口 */}
                          <PermissionGate permission="agent:mcp:call">
                            <button
                              type="button"
                              className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[0.8125rem] text-destructive hover:bg-destructive/10"
                              onClick={() => {
                                setActiveTool(tool);
                                setArgsText('{}');
                                setCallResult('');
                              }}
                            >
                              <PlayCircle className="h-3 w-3" />
                              手动调用
                            </button>
                          </PermissionGate>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          {/* 调用面板同样整体隐藏在权限门后 */}
          <PermissionGate permission="agent:mcp:call">
            {activeTool ? (
              <div className="mt-3 space-y-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-destructive">高危：手动调用工具</span>
                  <span className="font-mono text-xs">{activeTool.name}</span>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="ml-auto"
                    onClick={() => setActiveTool(null)}
                  >
                    收起
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  该调用会<span className="font-medium text-destructive">真实执行</span>
                  下游动作且不可撤销，不经过任何 Agent 的安全策略。仅用于排障，请确认参数无误。
                </p>
                <Textarea
                  rows={5}
                  className="font-mono text-xs"
                  value={argsText}
                  onChange={(e) => setArgsText(e.target.value)}
                />
                {!parsedArgs.ok ? (
                  <p className="text-xs text-destructive">参数无效：{parsedArgs.message}</p>
                ) : null}
                <div className="flex justify-end">
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={!parsedArgs.ok}
                    onClick={() => setConfirmOpen(true)}
                  >
                    <PlayCircle className="h-4 w-4" />
                    执行调用
                  </Button>
                </div>
                {callResult ? (
                  <pre className="max-h-48 overflow-auto rounded-md border bg-card p-2 font-mono text-xs">
                    {callResult}
                  </pre>
                ) : null}
              </div>
            ) : null}
          </PermissionGate>
        </DialogContent>
      </Dialog>

      <AgentConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        danger
        title="确认手动调用 MCP 工具"
        confirmText="执行"
        confirmKeyword={activeTool?.name}
        description={
          <>
            <p>
              即将在 Server <span className="font-mono">{serverName}</span> 上执行工具
              <span className="font-mono"> {activeTool?.name}</span>。
            </p>
            <p>该操作会真实作用于下游系统，不经过 Agent 的安全策略，且无法回滚。</p>
          </>
        }
        onConfirm={runCall}
      />
    </>
  );
}
