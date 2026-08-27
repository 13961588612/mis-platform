/**
 * MCP 工具授权面板（MCP 管理页「工具授权」Tab）。
 *
 * <p>方案 B′ 的交互核心：管理员按「MCP 每个工具」给「角色」配置调用权限。
 * 数据来自 BFF 聚合端点 {@code GET /agent-ops/mcp/tools?server={name}}，
 * 一次请求拿齐 live 工具 × discovered 状态 × 已授权角色。
 *
 * <h2>交互模型（批量授权）</h2>
 * 上表勾选<b>已 discover</b> 的工具（未 discover 的禁勾选，需先「发现」），
 * 底部角色多选（复用 {@link AgentRolePicker}，目标 App 恒为 {@code system}），
 * 「保存授权」把同一组角色批量 PUT 到每个勾选工具 —— 并发限流 3，
 * 单工具失败不中断其余（逐个收集报错）。
 *
 * <h2>已下线工具（T05 僵尸码清理，本次纳入）</h2>
 * 曾 discover 但 live 清单已无的工具由 BFF 归入 {@code offline_skills} 单独成卡，
 * 带「清理」按钮（二次确认）：BFF 三步处置（ai-platform 注销 Skill → 删 sys_menu
 * → 回收 sys_role_menu）。<b>不做自动删</b>，必须人工点按。
 *
 * <h2>60s 生效窗口</h2>
 * 授权变更后 ≤60s 生效（权限缓存），页面明示「约 1 分钟内生效」，不做定向失效。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Clock, RefreshCw, Trash2, Wrench } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { PermissionGate } from '@/components/auth/permission-gate';
import { usePermission } from '@/hooks/use-permission';
import { AgentRolePicker } from '../components/agent-role-picker';
import { AgentConfirmDialog } from '../components/agent-confirm-dialog';
import {
  cleanupOfflineMcpSkill,
  discoverMcpTools,
  listGrantableRoles,
  listMcpServers,
  listMcpToolPermissions,
  saveSkillGrants,
} from '../api/agent-ops-api';
import { agentErrorMessage } from '../types';
import type {
  AgentRoleOption,
  McpOfflineSkill,
  McpServer,
  McpToolPermission,
  McpToolPermissions,
} from '../types';

const selectClass =
  'h-9 w-full rounded-md border border-input bg-card px-[0.7rem] text-sm text-foreground shadow-none';

/** 批量保存的并发上限（3–5 取 3，避免一次性压垮 BFF/IAM 的读改写链路）。 */
const SAVE_CONCURRENCY = 3;

/** 角色 chips 最多展示数量，超出折叠为 +N。 */
const MAX_ROLE_CHIPS = 4;

/**
 * 并发限流执行器：固定 worker 数消费队列，单任务失败不中断队列。
 */
async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  const queue = [...items];
  const workerCount = Math.max(1, Math.min(limit, queue.length));
  const workers = Array.from({ length: workerCount }, async () => {
    for (;;) {
      const item = queue.shift();
      if (item === undefined) return;
      await fn(item);
    }
  });
  await Promise.all(workers);
}

export function AgentMcpPermissionPanel() {
  const { hasPermission } = usePermission();
  const canManage = hasPermission('agent:mcp:manage');

  // ---- server 选择 ----
  const [servers, setServers] = useState<McpServer[]>([]);
  const [serverName, setServerName] = useState('');
  const [serversLoading, setServersLoading] = useState(false);

  // ---- 授权数据 ----
  const [perms, setPerms] = useState<McpToolPermissions | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ---- 批量授权编辑态 ----
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [roleIds, setRoleIds] = useState<number[]>([]);
  const [roleOptions, setRoleOptions] = useState<AgentRoleOption[]>([]);
  const [saving, setSaving] = useState(false);

  // ---- 行内动作 ----
  const [discovering, setDiscovering] = useState(false);
  const [cleanTarget, setCleanTarget] = useState<McpOfflineSkill | null>(null);
  const [cleaning, setCleaning] = useState(false);

  // ---- 加载 server 下拉与角色选项（各一次） ----
  useEffect(() => {
    let cancelled = false;
    async function load(): Promise<void> {
      setServersLoading(true);
      try {
        const [list, roles] = await Promise.all([listMcpServers(), listGrantableRoles('system')]);
        if (cancelled) return;
        setServers(list);
        setRoleOptions(roles);
        setServerName((prev) => (prev && list.some((s) => s.name === prev) ? prev : (list[0]?.name ?? '')));
      } catch (e) {
        if (!cancelled) toast.error(agentErrorMessage(e, '加载 MCP 服务器失败'));
      } finally {
        if (!cancelled) setServersLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const loadPermissions = useCallback(async (server: string) => {
    if (!server) {
      setPerms(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await listMcpToolPermissions(server);
      setPerms(data);
      // 重新拉取后清空勾选：上轮的角色选择基于旧清单，保留会误导
      setChecked(new Set());
      setRoleIds([]);
    } catch (e) {
      setPerms(null);
      setError(agentErrorMessage(e, '获取 MCP 工具授权失败'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadPermissions(serverName);
  }, [serverName, loadPermissions]);

  // ---- 单选时预填该工具当前角色 ----
  useEffect(() => {
    if (checked.size !== 1 || !perms) return;
    const only = perms.tools.find((t) => t.skill_id === [...checked][0]);
    if (only) setRoleIds(only.role_ids ?? []);
  }, [checked, perms]);

  const checkedTools = useMemo(() => {
    if (!perms) return [];
    return perms.tools.filter((t) => checked.has(t.skill_id) && t.discovered);
  }, [perms, checked]);

  const roleNameOf = useMemo(() => {
    const map = new Map<number, string>();
    roleOptions.forEach((r) => map.set(r.id, r.name));
    return (id: number): string => map.get(id) ?? `#${id}`;
  }, [roleOptions]);

  function toggleChecked(tool: McpToolPermission): void {
    if (!tool.discovered || !canManage) return;
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(tool.skill_id)) next.delete(tool.skill_id);
      else next.add(tool.skill_id);
      return next;
    });
  }

  function toggleAllDiscovered(): void {
    if (!perms || !canManage) return;
    const discoverable = perms.tools.filter((t) => t.discovered).map((t) => t.skill_id);
    setChecked((prev) => {
      const allChecked = discoverable.length > 0 && discoverable.every((id) => prev.has(id));
      if (allChecked) {
        const next = new Set(prev);
        discoverable.forEach((id) => next.delete(id));
        return next;
      }
      const next = new Set(prev);
      discoverable.forEach((id) => next.add(id));
      return next;
    });
  }

  const allDiscoveredChecked =
    perms !== null &&
    perms.tools.some((t) => t.discovered) &&
    perms.tools.filter((t) => t.discovered).every((t) => checked.has(t.skill_id));

  // ---- 保存（批量，并发 3） ----
  async function onSave(): Promise<void> {
    const targets = checkedTools;
    if (targets.length === 0) {
      toast.error('请先勾选至少一个已发现的工具');
      return;
    }
    setSaving(true);
    const failures: string[] = [];
    await runWithConcurrency(targets, SAVE_CONCURRENCY, async (tool) => {
      try {
        await saveSkillGrants(tool.skill_id, {
          skill_id: tool.skill_id,
          permission_code: tool.permission_code,
          target_app_code: 'system',
          role_ids: roleIds,
        });
      } catch (e) {
        failures.push(`${tool.name}: ${agentErrorMessage(e, '保存失败')}`);
      }
    });
    setSaving(false);

    if (failures.length > 0) {
      toast.error(`保存完成，${failures.length}/${targets.length} 个工具失败：${failures.join('；')}`);
    } else {
      toast.success(`已为 ${targets.length} 个工具保存授权，约 1 分钟内生效`);
    }
    await loadPermissions(serverName);
  }

  // ---- 一键 discover（server 级，发现该 server 全部工具） ----
  async function onDiscover(): Promise<void> {
    if (!serverName) return;
    setDiscovering(true);
    try {
      const result = await discoverMcpTools(serverName);
      toast.success(`Server「${serverName}」发现 ${result.discovered} 个工具，已刷新授权清单`);
      await loadPermissions(serverName);
    } catch (e) {
      toast.error(agentErrorMessage(e, '发现 MCP 工具失败'));
    } finally {
      setDiscovering(false);
    }
  }

  // ---- 清理已下线工具（破坏性，二次确认） ----
  async function onCleanup(): Promise<void> {
    if (!cleanTarget) return;
    setCleaning(true);
    try {
      const result = await cleanupOfflineMcpSkill(cleanTarget.skill_id);
      const rolesText = result.roles_updated.length > 0 ? `，回收 ${result.roles_updated.length} 个角色关联` : '';
      toast.success(`已清理 ${cleanTarget.skill_id}${rolesText}`);
      setCleanTarget(null);
      await loadPermissions(serverName);
    } catch (e) {
      toast.error(agentErrorMessage(e, '清理下线工具失败'));
    } finally {
      setCleaning(false);
    }
  }

  const discoverableCount = perms?.tools.filter((t) => !t.discovered).length ?? 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden">
      {/* server 选择 + 刷新 + 发现 */}
      <div className="flex shrink-0 flex-wrap items-end gap-2 rounded-lg border bg-card p-3">
        <div className="w-64">
          <label className="mb-[0.4rem] block text-xs text-muted-foreground">MCP Server</label>
          <select
            className={selectClass}
            value={serverName}
            disabled={serversLoading || servers.length === 0}
            onChange={(e) => setServerName(e.target.value)}
          >
            {servers.length === 0 ? (
              <option value="">暂无 Server</option>
            ) : (
              servers.map((s) => (
                <option key={s.name} value={s.name}>
                  {s.name}
                </option>
              ))
            )}
          </select>
        </div>
        <Button size="sm" variant="outline" onClick={() => void loadPermissions(serverName)} disabled={!serverName || loading}>
          <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
          刷新
        </Button>
        <PermissionGate permission="agent:mcp:manage">
          <Button size="sm" variant="outline" onClick={() => void onDiscover()} disabled={!serverName || discovering}>
            <Wrench className={cn('h-4 w-4', discovering && 'animate-spin')} />
            发现全部工具
          </Button>
        </PermissionGate>
        <span className="ml-auto pb-1.5 text-xs text-muted-foreground">
          {perms ? `共 ${perms.tools.length} 个工具${discoverableCount > 0 ? `，${discoverableCount} 个未发现` : ''}` : ''}
        </span>
      </div>

      {/* 60s 生效窗口提示（方案 B′ 决策 ①：接受窗口，不做定向失效） */}
      <div className="flex shrink-0 gap-2 rounded-md border border-info/30 bg-info/5 p-3 text-xs text-muted-foreground">
        <Clock className="mt-[0.1rem] h-3.5 w-3.5 shrink-0 text-info" />
        <p className="leading-relaxed">
          授权变更后<span className="font-medium text-foreground">约 1 分钟内生效</span>
          （权限缓存最长 60 秒）。保存后请稍候再验证，无需手动刷新缓存。
        </p>
      </div>

      {/* 工具表格：独占剩余高度，内部滚动 */}
      <div className="relative min-h-0 flex-1 overflow-auto rounded-lg border bg-table-surface">
        {loading ? (
          <div className="flex h-full items-center justify-center py-16 text-sm text-muted-foreground">
            加载工具清单…
          </div>
        ) : error ? (
          <div className="flex h-full items-center justify-center gap-3 px-6">
            <AlertTriangle className="h-5 w-5 shrink-0 text-destructive" />
            <p className="break-all text-sm text-muted-foreground">{error}</p>
            <Button size="sm" variant="outline" onClick={() => void loadPermissions(serverName)}>
              重试
            </Button>
          </div>
        ) : !perms || perms.tools.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 py-16">
            <p className="text-sm text-foreground">该 Server 暂无可用工具</p>
            <p className="text-xs text-muted-foreground">可先「连接」Server 再「发现全部工具」。</p>
          </div>
        ) : (
          <table className="border-separate border-spacing-0 bg-table-surface text-left text-sm">
            <thead className="sticky top-0 z-10 border-b-2 border-foreground/20 bg-table-header text-muted-foreground">
              <tr>
                <th className="w-12 px-3 py-2">
                  <input
                    type="checkbox"
                    aria-label="全选已发现工具"
                    className="h-3.5 w-3.5 cursor-pointer accent-primary"
                    checked={allDiscoveredChecked}
                    disabled={!canManage || perms.tools.every((t) => !t.discovered)}
                    onChange={toggleAllDiscovered}
                  />
                </th>
                <th className="px-3 py-2 font-bold">工具</th>
                <th className="min-w-[16rem] px-3 py-2 font-bold">权限码</th>
                <th className="w-24 px-3 py-2 font-bold">状态</th>
                <th className="min-w-[10rem] px-3 py-2 font-bold">已授权角色</th>
                <th className="w-24 px-3 py-2 text-right font-bold">操作</th>
              </tr>
            </thead>
            <tbody>
              {perms.tools.map((tool) => {
                const isChecked = checked.has(tool.skill_id);
                return (
                  <tr
                    key={tool.skill_id}
                    className={cn(
                      'border-b border-border/50 bg-table-row last:border-0 even:bg-table-stripe',
                      !tool.discovered && 'opacity-70',
                    )}
                  >
                    <td className="px-3 py-2 align-top">
                      <input
                        type="checkbox"
                        aria-label={`勾选 ${tool.name}`}
                        className="h-3.5 w-3.5 cursor-pointer accent-primary disabled:cursor-not-allowed"
                        checked={isChecked}
                        disabled={!tool.discovered || !canManage}
                        onChange={() => toggleChecked(tool)}
                      />
                    </td>
                    <td className="px-3 py-2 align-top">
                      <div className="font-medium" title={tool.name}>
                        {tool.name}
                      </div>
                      {tool.description ? (
                        <div className="mt-0.5 line-clamp-2 max-w-md text-xs text-muted-foreground">
                          {tool.description}
                        </div>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 align-top">
                      <span className="break-all font-mono text-xs text-muted-foreground">
                        {tool.permission_code}
                      </span>
                    </td>
                    <td className="px-3 py-2 align-top text-xs">
                      {tool.discovered ? (
                        <span className="text-success">已发现</span>
                      ) : (
                        <span className="text-muted-foreground">未发现</span>
                      )}
                    </td>
                    <td className="px-3 py-2 align-top">
                      {tool.role_ids.length === 0 ? (
                        <span className="text-xs text-muted-foreground">-</span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {tool.role_ids.slice(0, MAX_ROLE_CHIPS).map((id) => (
                            <span
                              key={id}
                              className="inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary"
                              title={roleNameOf(id)}
                            >
                              {roleNameOf(id)}
                            </span>
                          ))}
                          {tool.role_ids.length > MAX_ROLE_CHIPS ? (
                            <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                              +{tool.role_ids.length - MAX_ROLE_CHIPS}
                            </span>
                          ) : null}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right align-top">
                      {!tool.discovered ? (
                        <PermissionGate permission="agent:mcp:manage">
                          <button
                            type="button"
                            className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[0.8125rem] text-primary hover:bg-primary/10 disabled:opacity-50"
                            disabled={discovering}
                            onClick={() => void onDiscover()}
                            title="发现该 Server 的全部工具（server 级操作）"
                          >
                            <Wrench className="h-3 w-3" />
                            发现
                          </button>
                        </PermissionGate>
                      ) : (
                        <span className="text-xs text-muted-foreground">-</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* 批量授权编辑：底部固定高度上限，不与工具表抢 flex 空间 */}
      <div className="shrink-0 rounded-lg border bg-card p-3">
        <div className="mb-2 flex items-center justify-between gap-3">
          <p className="text-sm font-medium">
            批量授权
            {checkedTools.length > 0 ? (
              <span className="ml-1 text-muted-foreground">（已选 {checkedTools.length} 个工具）</span>
            ) : null}
          </p>
          <span className="text-xs text-muted-foreground">
            未发现的工具需先「发现」再勾选；单选工具时自动载入其当前授权角色。
          </span>
        </div>
        <div className="grid min-h-0 grid-cols-1 gap-3 lg:grid-cols-[1fr_auto]">
          <AgentRolePicker
            appCode="system"
            lockApp
            onAppCodeChange={() => {
              /* MCP 工具执行码恒挂 system App（V21 口径），不允许切换 */
            }}
            selectedRoleIds={roleIds}
            onSelectedRoleIdsChange={setRoleIds}
            disabled={!canManage || saving}
          />
          <div className="flex flex-col justify-end gap-2">
            <PermissionGate permission="agent:mcp:manage">
              <Button size="sm" disabled={checkedTools.length === 0 || saving} onClick={() => void onSave()}>
                {saving ? '保存中…' : '保存授权'}
              </Button>
            </PermissionGate>
          </div>
        </div>
      </div>

      {/* 已下线工具（僵尸码清理，破坏性需确认） */}
      {perms && perms.offline_skills.length > 0 ? (
        <div className="max-h-40 shrink-0 overflow-auto rounded-lg border border-warning/40 bg-warning/5">
          <div className="flex items-center gap-2 border-b border-warning/20 px-3 py-2">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-warning" />
            <p className="text-sm font-medium text-foreground">已下线工具（{perms.offline_skills.length}）</p>
            <p className="text-xs text-muted-foreground">
              曾发现但 Server 清单已移除，残留 Skill 与授权码，可人工清理
            </p>
          </div>
          <ul className="divide-y divide-border/50">
            {perms.offline_skills.map((skill) => (
              <li key={skill.skill_id} className="flex flex-wrap items-center gap-3 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-mono text-sm">{skill.skill_id}</span>
                    <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                      {skill.role_ids.length > 0 ? `${skill.role_ids.length} 个角色持有` : '无角色持有'}
                    </span>
                  </div>
                  <div className="mt-0.5 break-all font-mono text-xs text-muted-foreground">
                    {skill.permission_code}
                  </div>
                </div>
                <PermissionGate permission="agent:mcp:manage">
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-destructive hover:bg-destructive/10"
                    disabled={cleaning}
                    onClick={() => setCleanTarget(skill)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    清理
                  </Button>
                </PermissionGate>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <AgentConfirmDialog
        open={cleanTarget !== null}
        onOpenChange={(open) => {
          if (!open) setCleanTarget(null);
        }}
        danger
        title="确认清理已下线工具"
        confirmText="清理"
        confirmKeyword={cleanTarget?.skill_id ?? ''}
        description={
          <>
            <p>
              即将清理 <span className="font-mono">{cleanTarget?.skill_id}</span>：
            </p>
            <ul className="list-disc pl-5">
              <li>从 ai-platform 注销残留 Skill；</li>
              <li>删除该执行码对应的权限菜单；</li>
              <li>
                {cleanTarget && cleanTarget.role_ids.length > 0 ? (
                  <>回收 {cleanTarget.role_ids.length} 个角色的菜单关联。</>
                ) : (
                  <>当前无角色持有该码，仅清理 Skill 与菜单。</>
                )}
              </li>
            </ul>
            <p className="text-xs text-muted-foreground">此操作不可撤销；如需重新使用请重新发现该工具。</p>
          </>
        }
        onConfirm={onCleanup}
      />
    </div>
  );
}
