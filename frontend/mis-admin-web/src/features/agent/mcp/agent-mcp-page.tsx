/**
 * MCP 管理页（UI#8，菜单 92039 / `agent:mcp:list`）。
 *
 * <p>覆盖 §4.3 的 #34 列表、#35 健康探测、#38 新增 Server、#39 连接、#40 断开、
 * #41 discover；#37 工具清单与 #42 手动调用在 {@link AgentMcpToolsDialog} 内。
 *
 * <p>**T04 收口：`MCPServerConfig` wire 只有八字段**
 * `{name, transport, endpoint, args, env, timeout, auto_connect, description}` ——
 * 前端臆造的 `state / tool_count / enabled / updated_at` 全部删除：
 *   - 「登记状态」列删除：连接态以 **#35 实时探测**为准（本页打开时的探活结果）；
 *   - 「工具数」「更新时间」列删除；
 *   - 「已禁用」副标题 → `auto_connect`（「自动连接 / 手动连接」）；
 *   - 连接 / 断开按钮改按探测结果决策：探测正常 → 可断开，否则 → 可连接。
 *
 * <p>#35 失败**不阻断**列表：探活是旁路信息，让它把整页拖进 error 态属于因小失大，
 * 失败时探测列统一显示「未探测」。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  Info,
  Link2,
  Plus,
  RefreshCw,
  ServerCog,
  Unlink,
  Wrench,
  Zap,
} from 'lucide-react';
import { toast } from 'sonner';
import { z } from 'zod';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PermissionGate } from '@/components/auth/permission-gate';
import { SubmitButton } from '@/components/common/submit-button';
import { StatCard } from '@/components/common/stat-card';
import { SortIndicator } from '@/components/common/sort-indicator';
import { useClientSort } from '@/components/common/use-client-sort';
import { useColumnWidths, type ResizableColumn } from '@/components/common/use-column-widths';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { AgentPageShell } from '../components/agent-page-shell';
import { AgentConfirmDialog } from '../components/agent-confirm-dialog';
import { AgentMcpToolsDialog } from './agent-mcp-tools-dialog';
import { AgentMcpPermissionPanel } from './agent-mcp-permission-panel';
import {
  connectMcpServer,
  createMcpServer,
  disconnectMcpServer,
  discoverMcpTools,
  getMcpServersHealth,
  listMcpServers,
  type McpServerPayload,
} from '../api/agent-ops-api';
import { agentErrorMessage } from '../types';
import type { McpServer } from '../types';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

const selectClass =
  'h-9 w-full rounded-md border border-input bg-card px-[0.7rem] text-sm text-foreground shadow-none';

const fieldLabel = 'mb-[0.4rem] block text-sm font-medium text-foreground';

/** 探测结果筛选值（#35 health map 派生，非 wire 字段）。 */
type ProbeFilter = 'healthy' | 'unhealthy' | 'unknown' | 'all';

const MCP_COLS: ResizableColumn[] = [
  { key: 'name', label: 'Server 名称' },
  { key: 'transport', label: '传输' },
  { key: 'endpoint', label: 'Endpoint' },
  { key: 'health', label: '实时探测' },
  { key: 'auto_connect', label: '连接策略' },
  { key: '__ops__', label: '操作', locked: true },
];

const TRANSPORT_LABEL: Record<McpServer['transport'], string> = {
  stdio: 'stdio（本地进程）',
  sse: 'SSE',
  http: 'HTTP',
};

// ------------------------------------------------------------------ #38 新增表单

/**
 * 新增 Server 表单 schema。
 *
 * <p>`name` 会被拼进所有后续端点的 URL 段（`/mcp/servers/{name}/connect` 等），
 * 因此字符集收紧到 `[a-zA-Z0-9._-]`：含 `/` 会把路径切歧义，含空格 / 中文则
 * 编码后在日志与审计里不可读。
 *
 * <p>`endpoint` **必填**：ai-platform `RegisterServerRequest.endpoint: str` 必填
 * （stdio 也必填），此前「stdio 可空」的假设来自臆造的 wire，T04 已收口。
 */
const serverFormSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Server 名称必填')
    .max(64, '名称不超过 64 字符')
    .regex(/^[a-zA-Z0-9._-]+$/, '仅允许字母、数字、点、下划线与连字符'),
  transport: z.enum(['stdio', 'sse', 'http']),
  endpoint: z.string().trim().min(1, 'Endpoint 必填').max(500, 'Endpoint 不超过 500 字符'),
});

type ServerFormValues = z.infer<typeof serverFormSchema>;

const EMPTY_SERVER_FORM: ServerFormValues = {
  name: '',
  transport: 'stdio',
  endpoint: '',
};

interface McpServerFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}

/**
 * #38 新增 MCP Server。
 *
 * <p>没有编辑态：§4.3 未提供 `PUT /mcp/servers/{name}`，改配置只能删旧建新。
 * 这里不做"看起来能编辑其实提交被忽略"的假输入框。
 */
function McpServerFormDialog({ open, onOpenChange, onSaved }: McpServerFormDialogProps) {
  const [form, setForm] = useState<ServerFormValues>(EMPTY_SERVER_FORM);
  const [errors, setErrors] = useState<Partial<Record<keyof ServerFormValues, string>>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm(EMPTY_SERVER_FORM);
    setErrors({});
    setSaving(false);
  }, [open]);

  function patch(key: keyof ServerFormValues, value: string): void {
    setForm((f) => ({ ...f, [key]: value } as ServerFormValues));
    setErrors((e) => (e[key] ? { ...e, [key]: undefined } : e));
  }

  async function onSubmit(): Promise<void> {
    const parsed = serverFormSchema.safeParse(form);
    if (!parsed.success) {
      const next: Partial<Record<keyof ServerFormValues, string>> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0];
        if (typeof key === 'string' && !(key in next)) {
          next[key as keyof ServerFormValues] = issue.message;
        }
      }
      setErrors(next);
      return;
    }

    const values = parsed.data;
    const payload: McpServerPayload = {
      name: values.name,
      transport: values.transport,
      endpoint: values.endpoint,
    };

    setSaving(true);
    try {
      await createMcpServer(payload);
      toast.success(`Server「${values.name}」已创建，请手动连接`);
      onOpenChange(false);
      onSaved();
    } catch (e) {
      toast.error(agentErrorMessage(e, '新增 MCP 服务器失败'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>新增 MCP Server</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <label className={fieldLabel} htmlFor="mcp-name">
              Server 名称 *
            </label>
            <Input
              id="mcp-name"
              value={form.name}
              autoComplete="off"
              placeholder="filesystem"
              onChange={(e) => patch('name', e.target.value)}
            />
            <p className="mt-[0.35rem] text-xs text-muted-foreground">
              作为所有 MCP 接口的路径标识，创建后不可修改。
            </p>
            {errors.name ? <p className="mt-1 text-xs text-destructive">{errors.name}</p> : null}
          </div>

          <div>
            <label className={fieldLabel} htmlFor="mcp-transport">
              传输方式 *
            </label>
            <select
              id="mcp-transport"
              className={selectClass}
              value={form.transport}
              onChange={(e) => patch('transport', e.target.value)}
            >
              <option value="stdio">stdio（本地进程）</option>
              <option value="sse">SSE</option>
              <option value="http">HTTP</option>
            </select>
          </div>

          <div>
            <label className={fieldLabel} htmlFor="mcp-endpoint">
              Endpoint *
            </label>
            <Input
              id="mcp-endpoint"
              value={form.endpoint}
              autoComplete="off"
              placeholder="https://mcp.example.com/sse"
              onChange={(e) => patch('endpoint', e.target.value)}
            />
            <p className="mt-[0.35rem] text-xs text-muted-foreground">
              所有传输方式（含 stdio）都必须填写；stdio 填本地拉起命令或留空由后端默认。
            </p>
            {errors.endpoint ? (
              <p className="mt-1 text-xs text-destructive">{errors.endpoint}</p>
            ) : null}
          </div>

          <p className="rounded-md border bg-muted/40 p-2.5 text-xs text-muted-foreground">
            创建后 Server 处于未连接状态，不会自动拉取工具。请在列表中执行「连接」，
            再执行「发现工具」把工具清单同步进来。
          </p>
        </div>

        <DialogFooter>
          <SubmitButton loading={saving} onClick={() => void onSubmit()}>
            创建
          </SubmitButton>
          <Button variant="outline" disabled={saving} onClick={() => onOpenChange(false)}>
            取消
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ------------------------------------------------------------------ 主页面

export function AgentMcpPage() {
  const [servers, setServers] = useState<McpServer[]>([]);
  const [health, setHealth] = useState<Record<string, boolean>>({});
  const [healthLoaded, setHealthLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [probing, setProbing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [keyword, setKeyword] = useState('');
  const [probeFilter, setProbeFilter] = useState<ProbeFilter>('all');

  const [formOpen, setFormOpen] = useState(false);
  const [toolsTarget, setToolsTarget] = useState<McpServer | null>(null);
  const [toolsOpen, setToolsOpen] = useState(false);
  /** 正在执行行内操作（连接 / 发现）的 Server 名，用于禁用该行按钮防重复提交。 */
  const [busy, setBusy] = useState<string | null>(null);
  const [pending, setPending] = useState<McpServer | null>(null);

  const { widthOf, startResize, hasCustom, reset, tableStyle } = useColumnWidths(
    MCP_COLS,
    'mis-agent-mcp-table-widths',
  );

  /** #34 列表 + #35 探活；探活失败只降级探测列，不影响列表。 */
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [list, probe] = await Promise.allSettled([listMcpServers(), getMcpServersHealth()]);
      if (list.status === 'rejected') throw list.reason;
      setServers(list.value);
      if (probe.status === 'fulfilled') {
        setHealth(probe.value);
        setHealthLoaded(true);
      } else {
        setHealth({});
        setHealthLoaded(false);
      }
    } catch (e) {
      setError(agentErrorMessage(e, '获取 MCP 服务器列表失败'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /** #35 单独重探活：链路抖动时不需要把整张表重新拉一遍。 */
  async function refreshHealth(): Promise<void> {
    setProbing(true);
    try {
      setHealth(await getMcpServersHealth());
      setHealthLoaded(true);
      toast.success('健康探测已刷新');
    } catch (e) {
      setHealthLoaded(false);
      toast.error(agentErrorMessage(e, '健康探测失败'));
    } finally {
      setProbing(false);
    }
  }

  /** #39 连接。可逆且幂等，不做二次确认。 */
  async function runConnect(server: McpServer): Promise<void> {
    if (busy) return;
    setBusy(server.name);
    try {
      await connectMcpServer(server.name);
      toast.success(`Server「${server.name}」已连接`);
      await load();
    } catch (e) {
      toast.error(agentErrorMessage(e, '连接 MCP 服务器失败'));
    } finally {
      setBusy(null);
    }
  }

  /** #41 发现工具。写操作但无破坏性，直接执行并回显数量。 */
  async function runDiscover(server: McpServer): Promise<void> {
    if (busy) return;
    setBusy(server.name);
    try {
      const tools = await discoverMcpTools(server.name);
      toast.success(`Server「${server.name}」发现 ${tools.length} 个工具`);
      await load();
    } catch (e) {
      toast.error(agentErrorMessage(e, '发现 MCP 工具失败'));
    } finally {
      setBusy(null);
    }
  }

  /** #40 断开。会影响正在使用该 Server 的 Agent，走确认弹窗。 */
  async function runDisconnect(): Promise<void> {
    if (!pending) return;
    try {
      await disconnectMcpServer(pending.name);
      toast.success(`Server「${pending.name}」已断开`);
      setPending(null);
      await load();
    } catch (e) {
      toast.error(agentErrorMessage(e, '断开 MCP 服务器失败'));
    }
  }

  function openTools(server: McpServer): void {
    setToolsTarget(server);
    setToolsOpen(true);
  }

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    return servers.filter((s) => {
      const probe = health[s.name];
      if (probeFilter === 'healthy' && probe !== true) return false;
      if (probeFilter === 'unhealthy' && probe !== false) return false;
      if (probeFilter === 'unknown' && probe !== undefined) return false;
      if (!kw) return true;
      return s.name.toLowerCase().includes(kw) || (s.endpoint ?? '').toLowerCase().includes(kw);
    });
  }, [servers, keyword, probeFilter, health]);

  /** 探测列排序：正常(2) > 异常(1) > 未探测(0)，让异常项集中可见。 */
  const getSortValue = useCallback(
    (row: McpServer, key: string) => {
      if (key === 'health') {
        const probe = health[row.name];
        if (probe === true) return 2;
        if (probe === false) return 1;
        return 0;
      }
      return row[key as keyof McpServer] as unknown;
    },
    [health],
  );
  const { sorted, sortKey, sortDir, toggleSort } = useClientSort(filtered, getSortValue);

  const healthyCount = servers.filter((s) => health[s.name] === true).length;
  const unhealthyCount = servers.filter((s) => health[s.name] === false).length;
  const autoConnectCount = servers.filter((s) => s.auto_connect).length;

  const headerActions = (
    <>
      <Button size="sm" variant="outline" onClick={() => void load()} disabled={loading}>
        <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
        刷新
      </Button>
      <Button size="sm" variant="outline" onClick={() => void refreshHealth()} disabled={probing}>
        <Activity className={cn('h-4 w-4', probing && 'animate-pulse')} />
        健康探测
      </Button>
      <PermissionGate permission="agent:mcp:manage">
        <Button size="sm" onClick={() => setFormOpen(true)}>
          <Plus className="h-4 w-4" />
          新增 Server
        </Button>
      </PermissionGate>
    </>
  );

  return (
    <AgentPageShell
      title="MCP 管理"
      description="外部工具服务的连接与调用。"
      permission="agent:mcp:list"
      actions={headerActions}
      loading={loading && servers.length === 0}
      error={error}
      onRetry={() => void load()}
      empty={!loading && !error && servers.length === 0}
      emptyText="尚未接入任何 MCP Server"
      emptyHint="点击右上角「新增 Server」登记第一个外部工具服务，创建后需手动连接并发现工具。"
    >
      <Tabs defaultValue="servers" className="flex min-h-0 flex-1 flex-col">
        <TabsList className="w-fit">
          <TabsTrigger value="servers">Server 管理</TabsTrigger>
          <TabsTrigger value="permissions">工具授权</TabsTrigger>
        </TabsList>

        <TabsContent value="servers" className="flex min-h-0 flex-1 flex-col">
          <div className="flex min-h-0 flex-1 flex-col gap-3">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <StatCard label="Server 总数" value={servers.length} icon={ServerCog} />
              <StatCard
                label="探测正常"
                value={healthLoaded ? healthyCount : '-'}
                icon={Activity}
              />
              <StatCard
                label="探测异常"
                value={healthLoaded ? unhealthyCount : '-'}
                icon={Zap}
              />
              <StatCard label="自动连接" value={autoConnectCount} icon={Link2} />
            </div>

            <div className="flex gap-2 rounded-md border border-info/30 bg-info/5 p-3 text-xs text-muted-foreground">
              <Info className="mt-[0.1rem] h-3.5 w-3.5 shrink-0 text-info" />
              <p className="leading-relaxed">
                「实时探测」是本次打开页面时的探活结果：探测异常说明链路已断，
                此时 Agent 调用会超时而非快速失败，建议先「断开」再「连接」以刷新链路；
                「自动连接」表示该 Server 在注册表中配置为随系统启动自动拉起。
              </p>
            </div>

            <div className="flex flex-wrap items-end gap-2 rounded-lg border bg-card p-3">
              <div className="min-w-[14rem] flex-1">
                <label className="mb-[0.4rem] block text-xs text-muted-foreground">关键字</label>
                <Input
                  placeholder="搜索 Server 名称 / Endpoint"
                  value={keyword}
                  onChange={(e) => setKeyword(e.target.value)}
                />
              </div>
              <div className="w-44">
                <label className="mb-[0.4rem] block text-xs text-muted-foreground">探测结果</label>
                <select
                  className={selectClass}
                  value={probeFilter}
                  onChange={(e) => setProbeFilter(e.target.value as ProbeFilter)}
                >
                  <option value="all">全部结果</option>
                  <option value="healthy">探测正常</option>
                  <option value="unhealthy">探测异常</option>
                  <option value="unknown">未探测</option>
                </select>
              </div>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setKeyword('');
                  setProbeFilter('all');
                }}
              >
                重置
              </Button>
              <span className="ml-auto pb-1.5 text-xs text-muted-foreground">
                共 {filtered.length} / {servers.length} 条
              </span>
            </div>

            <div className="relative min-h-0 flex-1 overflow-auto rounded-lg border bg-table-surface">
              {hasCustom ? (
                <button
                  type="button"
                  onClick={reset}
                  className="absolute right-3 top-3 z-20 rounded-md bg-card px-2 py-0.5 text-xs text-muted-foreground shadow-sm hover:text-foreground"
                >
                  重置列宽
                </button>
              ) : null}
              <table
                className="border-separate border-spacing-0 bg-table-surface text-left text-sm"
                style={tableStyle}
              >
                <thead className="border-b-2 border-foreground/20 bg-table-header text-muted-foreground">
                  <tr>
                    {MCP_COLS.map((c, ci) => {
                      const active = sortKey === c.key;
                      return (
                        <th
                          key={c.key}
                          style={{ width: widthOf(c.key) }}
                          aria-sort={active ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
                          className={cn(
                            'relative overflow-hidden whitespace-nowrap px-0 py-0 font-bold',
                            ci > 0 && 'border-l border-border/60',
                            c.locked && 'text-right',
                          )}
                        >
                          {c.locked ? (
                            <span className="block px-3 py-2">{c.label}</span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => toggleSort(c.key)}
                              className={cn(
                                'flex w-full items-center gap-1 px-3 py-2 pr-5 text-left font-bold',
                                active
                                  ? 'text-foreground'
                                  : 'text-muted-foreground hover:text-foreground',
                              )}
                            >
                              {c.label}
                              <SortIndicator state={active ? sortDir : 'none'} />
                            </button>
                          )}
                          {!c.locked ? (
                            <span
                              role="separator"
                              aria-label={`调整${c.label}列宽`}
                              onMouseDown={(e) => startResize(e, c.key)}
                              className="absolute right-0 top-0 z-10 h-full w-1.5 cursor-col-resize touch-none select-none hover:bg-primary/30"
                            />
                          ) : null}
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {sorted.length === 0 ? (
                    <tr>
                      <td
                        colSpan={MCP_COLS.length}
                        className="px-3 py-10 text-center text-muted-foreground"
                      >
                        没有匹配当前筛选条件的 Server
                      </td>
                    </tr>
                  ) : (
                    sorted.map((server) => {
                      const probe = health[server.name];
                      const rowBusy = busy === server.name;
                      return (
                        <tr
                          key={server.name}
                          className="border-b border-border/50 bg-table-row last:border-0 even:bg-table-stripe hover:bg-table-hover"
                        >
                          <td className="px-3 py-2">
                            <div className="truncate font-medium" title={server.name}>
                              {server.name}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {server.auto_connect ? (
                                <span className="text-success">自动连接</span>
                              ) : (
                                <span className="text-muted-foreground">手动连接</span>
                              )}
                            </div>
                          </td>
                          <td className="truncate px-3 py-2 text-xs text-muted-foreground">
                            {TRANSPORT_LABEL[server.transport] ?? server.transport}
                          </td>
                          <td
                            className="truncate px-3 py-2 font-mono text-xs text-muted-foreground"
                            title={server.endpoint}
                          >
                            {server.endpoint || '-'}
                          </td>
                          <td className="px-3 py-2 text-xs">
                            {probe === true ? (
                              <span className="text-success">探测正常</span>
                            ) : probe === false ? (
                              <span className="text-destructive">探测异常</span>
                            ) : (
                              <span className="text-muted-foreground">未探测</span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-xs text-muted-foreground">
                            {server.auto_connect ? '自动连接' : '手动连接'}
                          </td>
                          <td className="px-3 py-2">
                            <div className="flex flex-wrap items-center justify-end gap-1">
                              <button
                                type="button"
                                className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[0.8125rem] text-primary hover:bg-primary/10"
                                onClick={() => openTools(server)}
                              >
                                <Wrench className="h-3 w-3" />
                                工具
                              </button>
                              <PermissionGate permission="agent:mcp:manage">
                                <button
                                  type="button"
                                  disabled={rowBusy}
                                  className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[0.8125rem] text-primary hover:bg-primary/10 disabled:opacity-50"
                                  onClick={() => void runDiscover(server)}
                                >
                                  <RefreshCw className={cn('h-3 w-3', rowBusy && 'animate-spin')} />
                                  发现工具
                                </button>
                              </PermissionGate>
                              <PermissionGate permission="agent:mcp:manage">
                                {probe === true ? (
                                  <button
                                    type="button"
                                    disabled={rowBusy}
                                    className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[0.8125rem] text-warning hover:bg-warning/10 disabled:opacity-50"
                                    onClick={() => setPending(server)}
                                  >
                                    <Unlink className="h-3 w-3" />
                                    断开
                                  </button>
                                ) : (
                                  <button
                                    type="button"
                                    disabled={rowBusy}
                                    className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[0.8125rem] text-success hover:bg-success/10 disabled:opacity-50"
                                    onClick={() => void runConnect(server)}
                                  >
                                    <Link2 className="h-3 w-3" />
                                    连接
                                  </button>
                                )}
                              </PermissionGate>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="permissions" className="flex min-h-0 flex-1 flex-col">
          <AgentMcpPermissionPanel />
        </TabsContent>
      </Tabs>

      <McpServerFormDialog open={formOpen} onOpenChange={setFormOpen} onSaved={() => void load()} />

      <AgentMcpToolsDialog
        open={toolsOpen}
        onOpenChange={setToolsOpen}
        server={toolsTarget}
        onDiscovered={() => void load()}
      />

      <AgentConfirmDialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open) setPending(null);
        }}
        danger
        title="确认断开 MCP Server"
        confirmText="断开"
        description={
          <>
            <p>
              即将断开 Server <span className="font-mono">{pending?.name}</span>。
            </p>
            <p>
              断开是异步生效的：正在使用该 Server 工具的 Agent 不会立即报错，
              而是在下一次调用时才失败；已在执行中的调用不会被中断。
            </p>
            <p>断开后可随时重新「连接」，工具清单需重新「发现」才会刷新。</p>
          </>
        }
        onConfirm={runDisconnect}
      />
    </AgentPageShell>
  );
}
