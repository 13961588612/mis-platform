/**
 * ConnectionWizard.tsx — 连接向导（4 步）+ 多连接 MCP 现状（v1.11 MR-S1）。
 *
 * <h2>四步（与 system-design §6.1 时序对齐）</h2>
 * <ol>
 *   <li><b>基本信息</b>：name / base_url / default_connector / timeout_seconds —— 同时展示
 *       **已有连接 + 各自 MCP 状态卡**（先看清现状再决定是否新建）；</li>
 *   <li><b>数据源参数</b>：auth_type / secret_ref / project_id。**凭证一律不回显**（沿用既有
 *       `IqdConfigPage` 范式：`type="password"`、空值 = 保留原值、后端 GET 恒回 `******`）；</li>
 *   <li><b>profile 绑定</b>：**仅占位**——`wren profile add` 由 DBA 在主机侧执行（multiconn §5），
 *       平台不代敲、不经手明文；此处只说明流程与「为何不能在此填密码」；</li>
 *   <li><b>连通测试</b>：进入即 `createConnection` 落库（幂等：已创建则跳过），随后
 *       `testConnection(id)` 自检 + MCP 启停/重启（**均带二次确认**）。</li>
 * </ol>
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
 * </ul>
 * ⚠️ 前端闸门必须与后端**实际校验的码**一致，否则会「注册表放行 → 代码 40300」。
 * 本组件只有 MCP 那一处闸门用 `mcp:manage`；若日后新增连接写操作按钮，注意区分两个码。
 */
import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Loader2, Play, RefreshCw, Square } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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
  listConnections,
  mcpManage,
  testConnection,
  type McpAction,
} from '../../api/iqd-modeling';
import { iqdKeys } from '../../queries/iqd-keys';
import type { Connection, ConnectionTestResult } from '../../types/modeling';
import { useModelingStore } from '../../store/modeling-store';
import { WizardShell, type WizardStep } from './WizardShell';

/** 4 步定义（key 加 `conn:` 前缀，避免与表发现向导共用 store 槽位时语义串台）。 */
const STEPS: WizardStep[] = [
  { key: 'conn:basic', title: '基本信息' },
  { key: 'conn:datasource', title: '数据源参数' },
  { key: 'conn:profile', title: 'profile 绑定' },
  { key: 'conn:test', title: '连通测试' },
];

/** connector 下拉候选（WrenAI 常用方言；具体可用集以 WrenAI 版本为准）。 */
const CONNECTOR_OPTIONS = ['postgres', 'mysql', 'clickhouse', 'duckdb', 'trino', 'mssql'];

/** 连接表单草稿（本地态：只在向导打开期间存活，关闭即弃）。 */
interface ConnectionDraft {
  name: string;
  baseUrl: string;
  defaultConnector: string;
  timeoutSeconds: number;
  language: string;
  authType: string;
  secretRef: string;
  projectId: string;
}

const EMPTY_DRAFT: ConnectionDraft = {
  name: '',
  baseUrl: '',
  defaultConnector: 'postgres',
  timeoutSeconds: 60,
  language: 'zh-CN',
  authType: 'none',
  secretRef: '',
  projectId: '',
};

/** MCP 操作的中文名（按钮/确认文案复用）。 */
const MCP_ACTION_LABEL: Record<McpAction, string> = {
  start: '启动',
  stop: '停止',
  restart: '重启',
};

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
 * @param connection    连接视图（只读 `mcp_status`/`mcp_port`/`last_health_*`）
 * @param canManage     是否有写权限（无则只读展示）
 * @param onAction      触发启停/重启（父组件负责二次确认 + 调 API）
 * @param busyAction    正在进行中的操作（用于按钮 loading/禁用）
 */
function McpStatusCard({
  connection,
  canManage,
  onAction,
  busyAction,
}: {
  connection: Connection;
  canManage: boolean;
  onAction: (action: McpAction) => void;
  busyAction: McpAction | null;
}) {
  const status = connection.mcp_status ?? null;
  return (
    <div className="rounded border border-border/60 p-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-[13px] font-medium">{connection.name}</span>
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
        {canManage && (
          <div className="flex shrink-0 items-center gap-1">
            <Button
              size="sm"
              variant="outline"
              className="h-7 px-2 text-[12px]"
              disabled={busyAction !== null || status === 'running'}
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
              disabled={busyAction !== null || status === 'stopped' || status == null}
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
              disabled={busyAction !== null}
              onClick={() => onAction('restart')}
            >
              {busyAction === 'restart' ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              重启
            </Button>
          </div>
        )}
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
 * 连接向导：4 步新建 + 多连接 MCP 现状管理。
 */
export function ConnectionWizard({ open, onOpenChange, onConnectionReady }: ConnectionWizardProps) {
  const queryClient = useQueryClient();
  const { hasPermission } = usePermission();
  // 已核实：6 个 MCP 端点由 IqdFacadeService 程序化校验 `properties.getMcpManagerPermission()`
  // （默认 iqd:mcp:manage，非注解式），故闸门必须用同一码 —— 用 edit 会出现
  // 「前端放行、后端 requirePermission 抛 40300」的错配。V89 已种子化该权限码。
  const canManage = hasPermission('iqd:mcp:manage');

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
  const [pendingAction, setPendingAction] = useState<{ action: McpAction; id: number } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const currentStep =
    wizardStep && STEPS.some((step) => step.key === wizardStep) ? wizardStep : STEPS[0].key;
  const stepIndex = STEPS.findIndex((step) => step.key === currentStep);
  const dirty = useMemo(
    () => createdId == null && (draft.name.trim() !== '' || draft.baseUrl.trim() !== ''),
    [createdId, draft.name, draft.baseUrl],
  );

  /** 连接清单（与建模台主页共用 queryKey → 新建后失效一次即全站同步）。 */
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
      const created = await createConnection({
        name: draft.name.trim(),
        base_url: draft.baseUrl.trim() || null,
        default_connector: draft.defaultConnector,
        timeout_seconds: draft.timeoutSeconds,
        language: draft.language,
        auth_type: draft.authType,
        secret_ref: draft.secretRef.trim() || null,
        project_id: draft.projectId.trim() || null,
        enabled: true,
      });
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

  return (
    <>
      <WizardShell
        open={open}
        onOpenChange={onOpenChange}
        title="连接向导"
        description="新建问数连接，并查看各连接的 WrenAI MCP 进程状态。"
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
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label className="text-[13px]">连接名称 *</Label>
                <Input
                  value={draft.name}
                  onChange={(e) => setDraft((prev) => ({ ...prev, name: e.target.value }))}
                  placeholder="如：销售库"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-[13px]">WrenAI 地址</Label>
                <Input
                  value={draft.baseUrl}
                  onChange={(e) => setDraft((prev) => ({ ...prev, baseUrl: e.target.value }))}
                  placeholder="http://127.0.0.1:3000"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-[13px]">默认 connector</Label>
                <Select
                  value={draft.defaultConnector}
                  onValueChange={(value) => setDraft((prev) => ({ ...prev, defaultConnector: value }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CONNECTOR_OPTIONS.map((option) => (
                      <SelectItem key={option} value={option}>
                        {option}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-[13px]">超时（秒）</Label>
                <Input
                  type="number"
                  value={draft.timeoutSeconds}
                  onChange={(e) =>
                    setDraft((prev) => ({ ...prev, timeoutSeconds: Number(e.target.value) || 60 }))
                  }
                />
              </div>
            </div>

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
                    canManage={canManage && connection.id != null}
                    busyAction={busyAction}
                    onAction={(action) => {
                      if (connection.id != null) {
                        setPendingAction({ action, id: connection.id });
                      }
                    }}
                  />
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ---------------- 步骤 2：数据源参数（凭证不回显） ---------------- */}
        {currentStep === 'conn:datasource' && (
          <div className="space-y-4">
            <Alert>
              <AlertTitle className="text-[13px]">凭证提交规则</AlertTitle>
              <AlertDescription className="text-[12px]">
                平台库只保存 <strong>profile 名 / 连接标识</strong>，<strong>不保存业务库明文凭证</strong>。
                此处留空表示「保留原值」；查询接口恒返回 <code>******</code>，不会回显。
              </AlertDescription>
            </Alert>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label className="text-[13px]">认证方式</Label>
                <Select
                  value={draft.authType}
                  onValueChange={(value) => setDraft((prev) => ({ ...prev, authType: value }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">none（profile 注入）</SelectItem>
                    <SelectItem value="basic">basic</SelectItem>
                    <SelectItem value="token">token</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-[13px]">凭证引用（secret_ref）</Label>
                <Input
                  type="password"
                  autoComplete="new-password"
                  value={draft.secretRef}
                  onChange={(e) => setDraft((prev) => ({ ...prev, secretRef: e.target.value }))}
                  placeholder="留空 = 保留原值"
                />
              </div>
              <div className="space-y-1 sm:col-span-2">
                <Label className="text-[13px]">WrenAI project_id</Label>
                <Input
                  value={draft.projectId}
                  onChange={(e) => setDraft((prev) => ({ ...prev, projectId: e.target.value }))}
                  placeholder="可选；留空则由 WrenAI 侧解析"
                />
              </div>
            </div>
          </div>
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
                      canManage={canManage}
                      busyAction={busyAction}
                      onAction={(action) => setPendingAction({ action, id: createdId })}
                    />
                  ) : null;
                })()}

                {actionError && (
                  <Alert variant="destructive">
                    <AlertTriangle className="h-4 w-4" />
                    <AlertTitle className="text-[13px]">MCP 操作失败</AlertTitle>
                    <AlertDescription className="text-[12px]">{actionError}</AlertDescription>
                  </Alert>
                )}
              </div>
            )}
          </div>
        )}
      </WizardShell>

      {/* ---------------- MCP 操作二次确认 ---------------- */}
      <WizardShellConfirm
        pending={pendingAction}
        onCancel={() => setPendingAction(null)}
        onConfirm={(pending) => {
          setPendingAction(null);
          void runMcpAction(pending.action, pending.id);
        }}
      />
    </>
  );
}

/**
 * MCP 操作二次确认（独立小组件，避免把确认逻辑塞进 WizardShell 的 dirty 守卫——
 * 那是「离开确认」，语义不同，混用会让两处文案互相干扰）。用 Dialog 以复用其
 * Esc/遮罩/焦点陷阱与层级管理（自绘 fixed overlay 会在嵌套 Dialog 下叠错层）。
 */
function WizardShellConfirm({
  pending,
  onCancel,
  onConfirm,
}: {
  pending: { action: McpAction; id: number } | null;
  onCancel: () => void;
  onConfirm: (pending: { action: McpAction; id: number }) => void;
}) {
  const label = pending ? MCP_ACTION_LABEL[pending.action] : '';
  const risky = pending != null && pending.action !== 'start';
  return (
    <Dialog open={pending != null} onOpenChange={(next) => (next ? undefined : onCancel())}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-[14px]">确认{label} MCP 进程？</DialogTitle>
          <DialogDescription className="text-[12px]">
            {risky
              ? `${label}会中断该连接上正在进行的问数/MCP 会话（project 目录默认保留）。`
              : '将拉起本连接的 WrenAI MCP 进程（就绪需数秒）。'}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onCancel}>
            取消
          </Button>
          <Button
            variant={risky ? 'destructive' : 'default'}
            size="sm"
            onClick={() => pending && onConfirm(pending)}
          >
            确认{label}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default ConnectionWizard;
