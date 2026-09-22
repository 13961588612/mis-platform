/**
 * ConnectionWizard.tsx — 连接向导（4 步）+ 多连接现状管理（v1.11 MR-S1；T07 增「编辑 / 停用 / 启用」）。
 *
 * <h2>四步（与 system-design §6.1 时序对齐）</h2>
 * <ol>
 *   <li><b>基本信息</b>：name / base_url / default_connector / timeout_seconds / language —— 同时展示
 *       **已有连接 + 各自 MCP 状态卡**（先看清现状再决定是否新建）；</li>
 *   <li><b>数据源参数</b>：auth_type / secret_ref / project_id。**凭证一律不回显**（沿用既有
 *       `IqdConfigPage` 范式：`type="password"`、空值 = 保留原值、后端 GET 恒回 `******`）；</li>
 *   <li><b>profile 绑定</b>：**仅占位**——`wren profile add` 由 DBA 在主机侧执行（multiconn §5），
 *       平台不代敲、不经手明文；此处只说明流程与「为何不能在此填密码」；</li>
 *   <li><b>连通测试</b>：进入即 `createConnection` 落库（幂等：已创建则跳过），随后
 *       `testConnection(id)` 自检 + MCP 启停/重启（**均带二次确认**）。</li>
 * </ol>
 *
 * <h2>T07 增量：按 id 的「编辑 / 停用 / 启用」（system-design §14）</h2>
 * 缺口：一期唯一写通道 `PUT /iqd/config` 是**「单条主连接 upsert」**，面对「已有连接 N 条」
 * 时无法精确指向某条 ⇒「停用 / 编辑**指定**连接」无处可做。本组件步骤 1 的
 * {@link McpStatusCard} 就是"per-connection 操作卡"，就地补齐（UI 落点裁决见 §14.7）。
 * <ul>
 *   <li><b>编辑</b>：以 `mode='edit'` 复用向导步骤 1/2 的**同一套字段控件**
 *       （{@link ConnectionFormFields}），提交边界由 `createConnection` 切到 {@link updateConnection}；
 *       `secret_ref` **恒预填为空 = 保留原值**（`connectionEditUtils.connectionToDraft`）；</li>
 *   <li><b>停用 / 启用</b>：只切 `enabled` 一个字段（{@link buildEnabledUpdate}）；
 *       **只改本行、不联动其它连接**（§14.5：放开多条 `enabled=true` 并存）；</li>
 *   <li><b>三者都二次确认</b>（{@link WizardShellConfirm}，与 MCP `stop` 同款 destructive 样式），
 *       文案唯一真值源是 {@link describeConnectionConfirm}（含**文案铁律**，见该函数注释）；</li>
 *   <li><b>写成功后整体失效 `iqdKeys.connections()`</b>：改名 / 启停会改变列表可见性与排序
 *       （主连接标记、id 序都可能变），单条替换不够（§14.7）。</li>
 * </ul>
 *
 * <h2>🔑 两个权限码并存，各管各的（**勿混用**）</h2>
 * <table>
 *   <tr><th>权限码</th><th>管哪些按钮</th><th>后端校验处</th></tr>
 *   <tr><td><b>`iqd:mcp:manage`</b></td><td>MCP 进程<b>启动 / 停止 / 重启</b></td>
 *       <td>BFF `IqdFacadeService:365/381/391/410` **程序化** `requirePermission(
 *       properties.getMcpManagerPermission())`（默认即该码，`IqdProperties:70`）；V89 种子化</td></tr>
 *   <tr><td><b>`iqd:modeling:edit`</b></td><td>连接<b>编辑</b> / <b>停用</b> / <b>启用</b>（连接配置写）</td>
 *       <td>mis-iqd `IqdModelingController` `@PreAuthorize("hasAuthority('iqd:modeling:edit')")`；
 *       V92 登记 `PUT /connections/{id}`（sys_api 92800 → 菜单 92632）</td></tr>
 * </table>
 * ⚠️ 两张卡上**同时**出现这两组按钮 ⇒ 极易"照抄上一行的码"而错配。错配的后果是
 * **前端放行、后端 40300**（用户在 UI 上看到按钮却永远失败），且**不报前端错**。
 * 新增按钮时请先确认它调用的端点在后端绑的是哪个码 —— 不要按"视觉相邻"抄。
 *
 * <h2>字段可见性铁律</h2>
 * MCP 卡**只能**用 `mcp_status` / `mcp_port` / `last_health_at` / `last_health_msg` ——
 * `mcp_host` / `agent_handle` 在 `IqdConnectionVO` 上带 `@JsonIgnore`，**前端永远拿不到**
 * （T02a 实证）。别照着后端 DTO 猜字段名，会静默 `undefined`。
 *
 * <h2>权限</h2>
 * <ul>
 *   <li>连接列表走 <b>`iqd:modeling:view`</b>（T02a 已把 `GET /connections` 定为 view ——
 *       页面准入码即 view，若要求 edit，view-only 用户「进得去页面却拿不到列表」）；</li>
 *   <li>新建连接 / MCP 启停重启走 <b>`iqd:mcp:manage`</b>（连接写操作沿用建模台 edit 语义、
 *       MCP 进程操作则用独立码）。**已核实**：6 个 MCP 端点并非注解式校验，而是在 BFF
 *       `IqdFacadeService:365/381/391/410` 程序化 `requirePermission(properties.getMcpManagerPermission())`，
 *       该值默认 `iqd:mcp:manage`（`IqdProperties:70`）；V89 已把该权限码种子化并绑定这 6 条路径。</li>
 *   <li><b>编辑 / 停用 / 启用</b>走 <b>`iqd:modeling:edit`</b>（与 `POST /connections` 同码 ——
 *       同属"建模台编辑连接配置"；§14.3 裁决；V92 绑定 `PUT /connections/{id}`）。</li>
 * </ul>
 * ⚠️ 前端闸门必须与后端**实际校验的码**一致，否则会「注册表放行 → 代码 40300」。
 */
import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Pencil,
  Play,
  Power,
  PowerOff,
  RefreshCw,
  Square,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { usePermission } from '@/hooks/use-permission';
import { cn } from '@/lib/utils';
import {
  createConnection,
  errorCode,
  errorData,
  listConnections,
  mcpManage,
  testConnection,
  updateConnection,
  type McpAction,
} from '../../api/iqd-modeling';
import { iqdKeys } from '../../queries/iqd-keys';
import type { Connection, ConnectionTestResult, UpdateConnectionRequest } from '../../types/modeling';
import { useModelingStore } from '../../store/modeling-store';
import { WizardShell, type WizardStep } from './WizardShell';
import { ConnectionFormFields } from './ConnectionFormFields';
import {
  buildCreateRequest,
  buildEnabledUpdate,
  buildUpdateRequest,
  connectionToDraft,
  describeConnectionConfirm,
  describeConnectionUpdateError,
  EMPTY_DRAFT,
  type ConnectionDraft,
  type ConnectionFormMode,
  type PendingConfirm,
} from './connectionEditUtils';

/** 4 步定义（key 加 `conn:` 前缀，避免与表发现向导共用 store 槽位时语义串台）。 */
const STEPS: WizardStep[] = [
  { key: 'conn:basic', title: '基本信息' },
  { key: 'conn:datasource', title: '数据源参数' },
  { key: 'conn:profile', title: 'profile 绑定' },
  { key: 'conn:test', title: '连通测试' },
];

/**
 * 权限码（**唯一来源，勿硬编码字符串**）。
 *
 * <p>两个码并存、各管各的（见文件头「两个权限码并存」表）：
 * `IQD_MCP_MANAGE_PERMISSION` 管 MCP 启/停/重启；`IQD_CONNECTION_EDIT_PERMISSION` 管连接编辑/启停。
 * 抽成常量是为了让"错配"在改动时可见（直接读常量名即知它该管哪一组按钮）。
 */
const IQD_MCP_MANAGE_PERMISSION = 'iqd:mcp:manage';
const IQD_CONNECTION_EDIT_PERMISSION = 'iqd:modeling:edit';

/** 状态徽标配色（仅按 running/其它两态着色，避免后端新增状态时前端硬编码漏项）。 */
function mcpBadgeClass(status: string | null | undefined): string {
  if (status === 'running') {
    return 'border-emerald-500/40 text-emerald-600';
  }
  if (status === 'crashed' || status === 'unhealthy') {
    return 'border-destructive/40 text-destructive';
  }
  return 'border-border text-muted-foreground';
}

/**
 * MCP 状态卡（本文件内共享：步骤 1 的现状列表 + 步骤 4 的新连接）。
 *
 * <p>T07 起同时承载两组操作，**闸门各用一个权限码**：
 * <ul>
 *   <li>启 / 停 / 重启 → `iqd:mcp:manage`（`canManageMcp`）；</li>
 *   <li>编辑 / 停用 / 启用 → `iqd:modeling:edit`（`canEditConnection`）。</li>
 * </ul>
 *
 * @param connection        连接视图（只读 `mcp_status`/`mcp_port`/`last_health_*`/`enabled`）
 * @param canManageMcp      是否可管理 MCP 进程（`iqd:mcp:manage`；无则隐藏该组按钮）
 * @param canEditConnection 是否可编辑连接配置 / 启停（`iqd:modeling:edit`；无则隐藏该组按钮）
 * @param onAction          触发 MCP 启停/重启（父组件负责二次确认 + 调 API）
 * @param onEdit            打开编辑表单（父组件负责二次确认 + 调 API）
 * @param onToggleEnabled   切换 `enabled`（父组件负责二次确认 + 调 API）
 * @param busyAction        正在进行中的 MCP 操作（用于按钮 loading/禁用）
 * @param busyConnection    连接写操作（编辑/启停）进行中（禁用该组按钮防重复提交）
 */
function McpStatusCard({
  connection,
  canManageMcp,
  canEditConnection,
  onAction,
  onEdit,
  onToggleEnabled,
  busyAction,
  busyConnection,
}: {
  connection: Connection;
  canManageMcp: boolean;
  canEditConnection: boolean;
  onAction: (action: McpAction) => void;
  onEdit: () => void;
  onToggleEnabled: (nextEnabled: boolean) => void;
  busyAction: McpAction | null;
  busyConnection: boolean;
}) {
  const status = connection.mcp_status ?? null;
  // 可用性开关（§14.5：可多条同时为 true；此处只做展示，不做任何"唯一性"暗示）
  const enabled = connection.enabled !== false;
  const busy = busyAction !== null || busyConnection;
  return (
    <div className="rounded border border-border/60 p-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-[13px] font-medium">{connection.name}</span>
          <Badge
            variant="outline"
            className={cn(
              'text-[11px]',
              enabled ? 'border-primary/40 text-primary' : 'border-border text-muted-foreground',
            )}
          >
            {enabled ? '已启用' : '已停用'}
          </Badge>
          <Badge variant="outline" className={cn('text-[11px]', mcpBadgeClass(status))}>
            MCP {status ?? '未知'}
          </Badge>
          {connection.mcp_port != null && (
            <span className="text-[12px] text-muted-foreground">端口 {connection.mcp_port}</span>
          )}
          {connection.status && (
            <Badge variant="outline" className="text-[11px]">
              连接 {connection.status}
            </Badge>
          )}
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-1">
          {/* —— 连接配置写（iqd:modeling:edit）：编辑 / 停用 / 启用 —— */}
          {canEditConnection && (
            <>
              <Button
                size="sm"
                variant="outline"
                className="h-7 px-2 text-[12px]"
                disabled={busy}
                onClick={onEdit}
              >
                <Pencil className="h-3.5 w-3.5" />
                编辑
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-7 px-2 text-[12px]"
                disabled={busy}
                onClick={() => onToggleEnabled(!enabled)}
              >
                {enabled ? (
                  <PowerOff className="h-3.5 w-3.5" />
                ) : (
                  <Power className="h-3.5 w-3.5" />
                )}
                {enabled ? '停用' : '启用'}
              </Button>
            </>
          )}
          {/* —— MCP 进程操作（iqd:mcp:manage，**与上面的 edit 码不同**）：启 / 停 / 重启 —— */}
          {canManageMcp && (
            <>
              <Button
                size="sm"
                variant="outline"
                className="h-7 px-2 text-[12px]"
                disabled={busy || status === 'running'}
                onClick={() => onAction('start')}
              >
                {busyAction === 'start' ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Play className="h-3.5 w-3.5" />
                )}
                启动
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-7 px-2 text-[12px]"
                disabled={busy || status === 'stopped' || status == null}
                onClick={() => onAction('stop')}
              >
                {busyAction === 'stop' ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Square className="h-3.5 w-3.5" />
                )}
                停止
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-7 px-2 text-[12px]"
                disabled={busy}
                onClick={() => onAction('restart')}
              >
                {busyAction === 'restart' ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5" />
                )}
                重启
              </Button>
            </>
          )}
        </div>
      </div>
      <div className="mt-1 text-[12px] text-muted-foreground">
        {connection.last_health_at
          ? `最近自检 ${new Date(connection.last_health_at).toLocaleString()}`
          : '尚未自检'}
        {connection.last_health_msg ? ` · ${connection.last_health_msg}` : ''}
      </div>
    </div>
  );
}

/** `ConnectionWizard` Props。 */
export interface ConnectionWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 创建/选中连接后回调（父组件据此把画布切到该连接）。 */
  onConnectionReady?: (connectionId: number) => void;
}

/**
 * 连接向导：4 步新建 + 多连接现状管理（含按 id 的编辑 / 停用 / 启用）。
 */
export function ConnectionWizard({ open, onOpenChange, onConnectionReady }: ConnectionWizardProps) {
  const queryClient = useQueryClient();
  const { hasPermission } = usePermission();

  // ⚠️ 两个码并存、各管各的（见文件头表）：MCP 进程操作用 mcp:manage；连接配置写用 modeling:edit。
  // 已核实：6 个 MCP 端点由 IqdFacadeService 程序化校验 `properties.getMcpManagerPermission()`
  // （默认 iqd:mcp:manage，非注解式），故该组闸门必须用同一码 —— 用 edit 会出现
  // 「前端放行、后端 requirePermission 抛 40300」的错配。V89 已种子化该权限码。
  const canManageMcp = hasPermission(IQD_MCP_MANAGE_PERMISSION);
  // 连接配置写（PUT /connections/{id}，V92 登记）：后端是注解式 @PreAuthorize，
  // 与 POST /connections 同码 —— 这里**必须**用 modeling:edit，抄上一行的 mcp:manage 即错配。
  const canEditConnection = hasPermission(IQD_CONNECTION_EDIT_PERMISSION);

  const wizardStep = useModelingStore((state) => state.wizardStep);
  const pushWizardStep = useModelingStore((state) => state.pushWizardStep);
  const popWizardStep = useModelingStore((state) => state.popWizardStep);

  const [draft, setDraft] = useState<ConnectionDraft>(EMPTY_DRAFT);
  const [createdId, setCreatedId] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<ConnectionTestResult | null>(null);
  const [busyAction, setBusyAction] = useState<McpAction | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // ---- T07：编辑 / 停用 / 启用 的本地产出
  /** 表单模式：`create` = 新建向导；`edit` = 就地编辑既有连接（§14.7 要求显式保留 mode）。 */
  const [mode, setMode] = useState<ConnectionFormMode>('create');
  /** 被编辑的连接快照（非 null 且 mode='edit' 时编辑弹窗打开）。 */
  const [editingConnection, setEditingConnection] = useState<Connection | null>(null);
  const [editDraft, setEditDraft] = useState<ConnectionDraft>(EMPTY_DRAFT);
  const [editError, setEditError] = useState<string | null>(null);
  /** 连接写操作（编辑保存 / 启停）进行中。 */
  const [savingConnection, setSavingConnection] = useState(false);
  /** 待二次确认的操作（MCP / 启停 / 编辑三类共用一个确认弹窗）。 */
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm | null>(null);

  const currentStep =
    wizardStep && STEPS.some((step) => step.key === wizardStep) ? wizardStep : STEPS[0].key;
  const stepIndex = STEPS.findIndex((step) => step.key === currentStep);
  const dirty = useMemo(
    () => createdId == null && (draft.name.trim() !== '' || draft.baseUrl.trim() !== ''),
    [createdId, draft.name, draft.baseUrl],
  );

  /** 连接清单（与建模台主页共用 queryKey → 新建/编辑后失效一次即全站同步）。 */
  const connectionsQuery = useQuery({
    queryKey: iqdKeys.connections(),
    queryFn: listConnections,
    enabled: open,
    staleTime: 10_000,
  });
  const connections = useMemo(() => connectionsQuery.data ?? [], [connectionsQuery.data]);

  // 打开向导 → 重置到第一步（store 的 wizardStep 是全局槽位，必须显式初始化）
  useEffect(() => {
    if (open) {
      setDraft(EMPTY_DRAFT);
      setCreatedId(null);
      setCreateError(null);
      setTestResult(null);
      setActionError(null);
      pushWizardStep(STEPS[0].key);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const invalidateConnections = () => {
    void queryClient.invalidateQueries({ queryKey: iqdKeys.connections() });
  };

  /** 落库（步骤 3 → 4 的边界；幂等：已创建则跳过）。 */
  const ensureCreated = async (): Promise<number | null> => {
    if (createdId != null) {
      return createdId;
    }
    setCreating(true);
    setCreateError(null);
    try {
      const created = await createConnection(buildCreateRequest(draft));
      const id = created.id ?? null;
      setCreatedId(id);
      invalidateConnections();
      if (id != null) {
        onConnectionReady?.(id);
      }
      return id;
    } catch (err) {
      // 40900 同名冲突 / 42200 参数：把业务码与消息一起呈现（不要只显示 message）
      const code = errorCode(err);
      const message = err instanceof Error ? err.message : String(err);
      setCreateError(code != null ? `[${code}] ${message}` : message);
      return null;
    } finally {
      setCreating(false);
    }
  };

  const runTest = async (id: number) => {
    setTesting(true);
    setTestResult(null);
    try {
      setTestResult(await testConnection(id));
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : String(err));
    } finally {
      setTesting(false);
    }
  };

  const runMcpAction = async (action: McpAction, id: number) => {
    setBusyAction(action);
    setActionError(null);
    try {
      await mcpManage(id, action);
      invalidateConnections();
    } catch (err) {
      const code = errorCode(err);
      const message = err instanceof Error ? err.message : String(err);
      // 40300 大概率是「注册表未登记」（见 api 层注释）——给出可诊断的提示
      setActionError(code != null ? `[${code}] ${message}` : message);
    } finally {
      setBusyAction(null);
    }
  };

  /**
   * 连接配置写（编辑 / 启停）统一出口（`PUT /iqd/connections/{id}`，T07）。
   *
   * <p>成功后**整体失效 `iqdKeys.connections()`** —— 不改单条：改名会改变列表排序与主连接标记
   * （`name='default'` 口径，§14.5.1），启停会改变可见性，单条替换**不足以**表达这些变化。
   *
   * @param id       目标连接 id
   * @param body     局部更新体（仅含改动字段；见 `connectionEditUtils`）
   * @param setError 失败文案落到哪（编辑弹窗内 `editError` / 卡片区 `actionError`）
   * @returns 是否成功
   */
  const runConnectionUpdate = async (
    id: number,
    body: UpdateConnectionRequest,
    setError: (message: string) => void,
  ): Promise<boolean> => {
    setSavingConnection(true);
    setActionError(null);
    setEditError(null);
    try {
      await updateConnection(id, body);
      invalidateConnections();
      return true;
    } catch (err) {
      // 业务错误走 HTTP 200 + body.code（BFF 透传 code + data）⇒ 必须读 data 才能给出
      // 40900 的冲突名 / 42200 的"连接不存在"这类**可诊断**文案（只读 message 会变成通用故障）。
      setError(
        describeConnectionUpdateError(
          errorCode(err),
          errorData(err),
          err instanceof Error ? err.message : String(err),
        ),
      );
      return false;
    } finally {
      setSavingConnection(false);
    }
  };

  /** 切换 `enabled`（二次确认之后调用）。只改本行，不联动其它连接（§14.5）。 */
  const runToggleEnabled = async (connection: Connection, nextEnabled: boolean) => {
    if (connection.id == null) {
      setActionError('该连接缺少 id，无法按 id 更新');
      return;
    }
    await runConnectionUpdate(connection.id, buildEnabledUpdate(nextEnabled), setActionError);
  };

  /** 打开编辑表单（edit 模式）——预填现值，`secret_ref` 恒留空 = 保留原值。 */
  const startEdit = (connection: Connection) => {
    setEditingConnection(connection);
    setEditDraft(connectionToDraft(connection));
    setEditError(null);
    setMode('edit');
  };

  /** 关闭编辑表单（丢弃草稿）。 */
  const closeEdit = () => {
    setMode('create');
    setEditingConnection(null);
    setEditDraft(EMPTY_DRAFT);
    setEditError(null);
  };

  /** 保存编辑（二次确认之后调用）。 */
  const runEditSave = async () => {
    const target = editingConnection;
    if (target?.id == null) {
      setEditError('该连接缺少 id，无法按 id 更新');
      return;
    }
    const body = buildUpdateRequest(editDraft, target);
    if (Object.keys(body).length === 0) {
      // 空载荷 = 无改动：后端会被当成"什么都不改"（成功但毫无意义），不如就地提示
      setEditError('没有检测到任何改动，无需保存。');
      return;
    }
    const ok = await runConnectionUpdate(target.id, body, setEditError);
    if (ok) {
      closeEdit();
    }
  };

  /** 下一步：进入第 4 步前先把连接落库，落库失败则**留在第 3 步**。 */
  const handleNext = async () => {
    if (currentStep === STEPS[2].key) {
      const id = await ensureCreated();
      if (id == null) {
        return; // 不前进：错误已展示在原步
      }
      pushWizardStep(STEPS[3].key);
      void runTest(id);
      return;
    }
    const next = STEPS[stepIndex + 1];
    if (next) {
      pushWizardStep(next.key);
    }
  };

  const editOpen = mode === 'edit' && editingConnection != null;

  return (
    <>
      <WizardShell
        open={open}
        onOpenChange={onOpenChange}
        title="连接向导"
        description="新建问数连接，并查看各连接的 WrenAI MCP 进程状态（可编辑 / 停用 / 启用）。"
        steps={STEPS}
        currentKey={currentStep}
        onBack={() => popWizardStep()}
        onNext={() => void handleNext()}
        dirty={dirty}
        busy={creating}
        finish={stepIndex === STEPS.length - 1}
        nextLabel={currentStep === STEPS[2].key ? '创建并测试' : undefined}
        nextDisabled={stepIndex === 0 && draft.name.trim() === ''}
      >
        {/* ---------------- 步骤 1：基本信息 + 已有连接现状 ---------------- */}
        {currentStep === 'conn:basic' && (
          <div className="space-y-4">
            <ConnectionFormFields
              section="basic"
              mode="create"
              draft={draft}
              onDraftChange={(patch) => setDraft((prev) => ({ ...prev, ...patch }))}
            />

            {actionError && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                {/* 标题刻意中性：actionError 同时承载 MCP 操作失败与连接编辑/启停失败两类 */}
                <AlertTitle className="text-[13px]">操作失败</AlertTitle>
                <AlertDescription className="text-[12px]">{actionError}</AlertDescription>
              </Alert>
            )}

            <div className="space-y-2">
              <p className="text-[13px] font-medium">已有连接（{connections.length}）</p>
              {connectionsQuery.isLoading && (
                <p className="text-[12px] text-muted-foreground">加载中…</p>
              )}
              {!connectionsQuery.isLoading && connections.length === 0 && (
                <p className="text-[12px] text-muted-foreground">
                  还没有连接。填好上方信息后按「下一步」，最后一步会创建并自检。
                </p>
              )}
              <div className="space-y-2">
                {connections.map((connection) => (
                  <McpStatusCard
                    key={connection.id ?? connection.name}
                    connection={connection}
                    canManageMcp={canManageMcp && connection.id != null}
                    canEditConnection={canEditConnection && connection.id != null}
                    busyAction={busyAction}
                    busyConnection={savingConnection}
                    onAction={(action) => {
                      if (connection.id != null) {
                        setPendingConfirm({ kind: 'mcp', action, id: connection.id });
                      }
                    }}
                    onEdit={() => startEdit(connection)}
                    onToggleEnabled={(nextEnabled) =>
                      setPendingConfirm({ kind: 'toggle', connection, nextEnabled })
                    }
                  />
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ---------------- 步骤 2：数据源参数（凭证不回显） ---------------- */}
        {currentStep === 'conn:datasource' && (
          <ConnectionFormFields
            section="datasource"
            mode="create"
            draft={draft}
            onDraftChange={(patch) => setDraft((prev) => ({ ...prev, ...patch }))}
          />
        )}

        {/* ---------------- 步骤 3：profile 绑定（占位说明） ---------------- */}
        {currentStep === 'conn:profile' && (
          <div className="space-y-3">
            <Alert>
              <AlertTitle className="text-[13px]">profile 绑定由 DBA 在主机侧执行</AlertTitle>
              <AlertDescription className="text-[12px]">
                本步骤<strong>不收集任何凭证</strong>。真正的 profile 注册（
                <code>wren profile add</code> + <code>wren context set-profile</code>）由 DBA 按
                multiconn §5 流程在 WrenAI 主机上人工执行，凭证经 <code>${'{ENV}'}</code> 占位在
                进程启动期注入 —— 平台既不代敲，也不经手明文（边界红线）。
              </AlertDescription>
            </Alert>
            <ol className="list-decimal space-y-1 pl-5 text-[12px] text-muted-foreground">
              <li>在 WrenAI 主机执行 <code>wren profile add</code> 注册业务库连接（凭证只落主机）。</li>
              <li>执行 <code>wren context set-profile</code> 绑定到本连接的 project 目录。</li>
              <li>回到本向导点「创建并测试」：平台创建连接 → 自检 → 拉起 MCP 进程。</li>
            </ol>
            <p className="text-[12px] text-muted-foreground">
              完成后即可在建模台用「表发现」按连接读取 schema/表/列（凭证全程 server-side）。
            </p>
          </div>
        )}

        {/* ---------------- 步骤 4：连通测试 + MCP ---------------- */}
        {currentStep === 'conn:test' && (
          <div className="space-y-4">
            {creating && (
              <p className="flex items-center gap-2 text-[13px] text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                正在创建连接…
              </p>
            )}
            {createdId == null && !creating && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle className="text-[13px]">连接尚未创建</AlertTitle>
                <AlertDescription className="text-[12px]">
                  请回到上一步重试；错误信息：{createError ?? '未知'}
                </AlertDescription>
              </Alert>
            )}

            {createdId != null && (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <p className="text-[13px] font-medium">连通性自检</p>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 px-2 text-[12px]"
                    disabled={testing}
                    onClick={() => void runTest(createdId)}
                  >
                    {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                    重新测试
                  </Button>
                </div>
                {testResult && (
                  <div className="flex items-center gap-2 rounded border border-border/60 p-2 text-[13px]">
                    {testResult.ok ? (
                      <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                    ) : (
                      <AlertTriangle className="h-4 w-4 text-destructive" />
                    )}
                    <span>{testResult.ok ? '连接正常' : '连接不可用'}</span>
                    {testResult.latency_ms != null && (
                      <span className="text-muted-foreground">{testResult.latency_ms} ms</span>
                    )}
                    {testResult.message && (
                      <span className="text-muted-foreground">{testResult.message}</span>
                    )}
                  </div>
                )}

                {/* MCP 状态卡（新连接） */}
                {(() => {
                  const created = connections.find((item) => item.id === createdId);
                  return created ? (
                    <McpStatusCard
                      connection={created}
                      canManageMcp={canManageMcp}
                      canEditConnection={canEditConnection}
                      busyAction={busyAction}
                      busyConnection={savingConnection}
                      onAction={(action) => setPendingConfirm({ kind: 'mcp', action, id: createdId })}
                      onEdit={() => startEdit(created)}
                      onToggleEnabled={(nextEnabled) =>
                        setPendingConfirm({ kind: 'toggle', connection: created, nextEnabled })
                      }
                    />
                  ) : null;
                })()}

                {actionError && (
                  <Alert variant="destructive">
                    <AlertTriangle className="h-4 w-4" />
                    {/* 标题中性：同一步的 actionError 也承载连接编辑/启停失败 */}
                    <AlertTitle className="text-[13px]">操作失败</AlertTitle>
                    <AlertDescription className="text-[12px]">{actionError}</AlertDescription>
                  </Alert>
                )}
              </div>
            )}
          </div>
        )}
      </WizardShell>

      {/* ---------------- 编辑连接（edit 模式：复用向导步骤 1/2 的字段控件） ---------------- */}
      <Dialog
        open={editOpen}
        onOpenChange={(next) => {
          if (!next) {
            closeEdit();
          }
        }}
      >
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="text-[14px]">
              编辑连接「{editingConnection?.name ?? ''}」
            </DialogTitle>
            <DialogDescription className="text-[12px]">
              按 id 精确更新该连接。<strong>局部更新</strong>：只提交被修改的字段，
              留空 = 保留原值（凭证留空即保留当前凭证）。保存前会二次确认。
            </DialogDescription>
          </DialogHeader>

          <div className="max-h-[60vh] space-y-4 overflow-auto py-1">
            <ConnectionFormFields
              section="basic"
              mode="edit"
              draft={editDraft}
              disabled={savingConnection}
              onDraftChange={(patch) => setEditDraft((prev) => ({ ...prev, ...patch }))}
            />
            <ConnectionFormFields
              section="datasource"
              mode="edit"
              draft={editDraft}
              disabled={savingConnection}
              onDraftChange={(patch) => setEditDraft((prev) => ({ ...prev, ...patch }))}
            />
          </div>

          {editError && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle className="text-[13px]">保存失败</AlertTitle>
              <AlertDescription className="text-[12px]">{editError}</AlertDescription>
            </Alert>
          )}

          <DialogFooter>
            <Button variant="outline" size="sm" onClick={closeEdit} disabled={savingConnection}>
              取消
            </Button>
            <Button
              size="sm"
              disabled={savingConnection || editDraft.name.trim() === ''}
              onClick={() => {
                if (editingConnection) {
                  setPendingConfirm({ kind: 'edit', connection: editingConnection });
                }
              }}
            >
              {savingConnection && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              保存修改
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---------------- 二次确认（MCP 启停 / 连接启停 / 保存编辑 三类共用） ---------------- */}
      <WizardShellConfirm
        pending={pendingConfirm}
        onCancel={() => setPendingConfirm(null)}
        onConfirm={(pending) => {
          setPendingConfirm(null);
          if (pending.kind === 'mcp') {
            void runMcpAction(pending.action, pending.id);
            return;
          }
          if (pending.kind === 'toggle') {
            void runToggleEnabled(pending.connection, pending.nextEnabled);
            return;
          }
          void runEditSave();
        }}
      />
    </>
  );
}

/**
 * 二次确认弹窗（三类操作共用：MCP 启停 / 连接启停 / 保存编辑）。
 *
 * <p>独立小组件，避免把确认逻辑塞进 WizardShell 的 dirty 守卫 —— 那是「离开确认」，
 * 语义不同，混用会让两处文案互相干扰。用 Dialog 以复用其 Esc/遮罩/焦点陷阱与层级管理
 * （自绘 fixed overlay 会在嵌套 Dialog 下叠错层）。
 *
 * <p>**文案不由本组件决定**：全部来自 `connectionEditUtils.describeConnectionConfirm`
 * （纯函数、有单测钉住「启用不写"自动停用其它连接"」这条铁律）。本组件只负责渲染 +
 * 按 `destructive` 选样式（与 MCP `stop` 同款）。
 */
function WizardShellConfirm({
  pending,
  onCancel,
  onConfirm,
}: {
  pending: PendingConfirm | null;
  onCancel: () => void;
  onConfirm: (pending: PendingConfirm) => void;
}) {
  const copy = pending ? describeConnectionConfirm(pending) : null;
  return (
    <Dialog open={pending != null} onOpenChange={(next) => (next ? undefined : onCancel())}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-[14px]">{copy?.title ?? ''}</DialogTitle>
          <DialogDescription className="text-[12px]">{copy?.description ?? ''}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onCancel}>
            取消
          </Button>
          <Button
            variant={copy?.destructive ? 'destructive' : 'default'}
            size="sm"
            onClick={() => pending && onConfirm(pending)}
          >
            {copy?.confirmLabel ?? '确认'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default ConnectionWizard;
