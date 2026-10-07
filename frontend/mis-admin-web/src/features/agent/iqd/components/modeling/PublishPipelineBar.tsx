/**
 * PublishPipelineBar.tsx — 建模台发布流水线条（v1.11 MR-S5；T03d = T03 收口）。
 *
 * <h2>四段流水线（每段的真值来自哪个字段 —— 这是本组件唯一不能猜的部分）</h2>
 * <table border="1">
 *   <caption>段 ⇄ 真值来源</caption>
 *   <tr><th>段</th><th>真值来源</th><th>取值</th></tr>
 *   <tr><td>① 编辑落库</td><td>`GET /iqd/catalog/sync-status` → `edit_status` + `current_edit_revision` / `built_edit_revision`</td>
 *       <td>EDITED_UNSYNCED / SYNCING / SYNCED / SYNC_FAILED / STALE_DRIFT</td></tr>
 *   <tr><td>② MDL build</td><td>同上 → `build_status` + `build_error`</td><td>pending / running / success / failed</td></tr>
 *   <tr><td>③ memory index</td><td>同上 → `index_status` + `index_error`</td><td>running / success / failed</td></tr>
 *   <tr><td>④ MCP 就绪</td><td>**不在 sync-status 里** → `GET /iqd/mcp/status?connectionId=` 的 `mcp_status`（也见 `Connection.mcp_status`）</td>
 *       <td>running / starting / stopped / crashed / unhealthy</td></tr>
 * </table>
 * ①–③ 走既有 {@link useSyncStatus}（{@link IQD_SYNC_POLL_INTERVAL_MS} = 15s，**不另起轮询**）；
 * ④ 用 MCP 专用端点按同一常量轮询
 * —— 这是本组件引入的**唯一**新轮询，理由是 MCP 进程态根本不在 sync-status 的返回里
 * （`IqdCatalogSyncStatus` 无该字段，见 `types/modeling.ts`）。
 *
 * <h2>⚠️ 权限码：**不是** `iqd:modeling:publish`（本次核实的重点）</h2>
 * `usePermission.ts` 的表格把「触发构建 / 强制重建 / 重新索引 / 模型校验」记为
 * `iqd:modeling:publish`，但**后端实际绑定的是另外四个码**（逐条来自迁移文件）：
 * <pre>
 *   POST /iqd/enhance/sync                            → iqd:enhance:sync    (V81:60)
 *   POST /iqd/catalog/reconcile                       → iqd:catalog:edit    (V81:64)
 *   GET  /iqd/catalog/sync-status                     → iqd:catalog:edit    (V81:63)  ← 连读状态都要它
 *   POST /iqd/self-heal/{force-rebuild|re-index|validate} → iqd:selfheal:exec (V84:58-60)
 *   GET/POST /iqd/mcp/**                              → iqd:mcp:manage      (V89:105-110)
 * </pre>
 * 若按 `iqd:modeling:publish` 置灰，持有 `publish` 却没有 `selfheal` 的角色会
 * 「按钮可点、点了 40300」；反之亦然。故本组件**逐动作使用后端同一个码**
 * （项目既有规矩：前端 gate 与后端校验必须同码，见 `ConnectionWizard` 用
 * `iqd:mcp:manage` 的先例）。`iqd:modeling:publish` 目前是「UI 语义码」，未被后端绑定。
 *
 * <h2>fail-closed：漂移时整条置橙且**阻断重建**</h2>
 * `edit_status === 'STALE_DRIFT'` 或 `stale_drift === true` → 整条橙色 + 除「重新导入」
 * 外**所有**发布/重建动作禁用（理由：基线已不可信，此时重建等于把漂移固化）。
 * `STALE_DRIFT` 的详情面板属 T04（本组件只给出口）。
 *
 * <h2>与画布的分工（不重复造 UI）</h2>
 * 布局的 `saving / saveError / conflict(40900)` 归**画布**（它用的是自己那份
 * `useModelLayout` 实例，见 `ModelCanvas`）。本条**不**再渲染一遍布局冲突 UI；
 * 它只负责**构建流水线** + 「未保存草稿」拦截（`store.dirtyDrafts`）。
 * （`useModelLayout` 的瞬时态是**实例内**的，跨组件读不到 —— 若 T04 要让顶栏也显示
 * 布局冲突，需把该 hook 提到页面或把状态收进 store；本批刻意不动已验证的画布。）
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Database, Hammer, Loader2, Play, RefreshCw, RotateCcw, ShieldCheck } from 'lucide-react';
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
import {
  reconcileIqdCatalog,
  selfHealForceRebuild,
  selfHealReindex,
  selfHealValidate,
  syncIqdEnhancements,
} from '@/lib/api/iqd';
// ⚠️ `IqdCatalogSyncStatus` 在本仓有**两个**定义：`@/lib/api/iqd` 的是**窄版**（无
// `build_error` / `index_error` / `action`），`types/modeling.ts` 的是**超集**且其文档明确
// 「T02 起以本类型为准」。`useSyncStatus` 的返回值是窄版 → 读错误摘要必须用超集类型
// （窄版赋给超集是允许的：多出来的都是可选属性）。
import type { IqdCatalogSyncStatus as ModelingSyncStatus } from '../../types/modeling';
import { errorCode, getMcpStatus, mcpManage } from '../../api/iqd-modeling';
import { IQD_SYNC_POLL_INTERVAL_MS, useSyncStatus } from '../shared/useSyncStatus';
import { useIqdModelingPermission } from '../shared/usePermission';
import { iqdKeys } from '../../queries/iqd-keys';
import { useModelingStore } from '../../store/modeling-store';

/**
 * 发布动作权限码（**权威 = 后端 sys_api 绑定**，见模块头表格；勿改成 `iqd:modeling:publish`）。
 */
export const PIPELINE_PERMISSIONS = {
  /** `POST /iqd/enhance/sync`（= 立即发布：context build + memory index + 回填）。 */
  publish: 'iqd:enhance:sync',
  /** `POST /iqd/catalog/reconcile`（漂移收敛的唯一出口）。 */
  reconcile: 'iqd:catalog:edit',
  /** `POST /iqd/self-heal/{force-rebuild|re-index|validate}`。 */
  selfHeal: 'iqd:selfheal:exec',
  /** `GET/POST /iqd/mcp/**`。 */
  mcp: 'iqd:mcp:manage',
} as const;

/** 单段状态（与 UI 的颜色/图标一一对应）。 */
export type StageState = 'ok' | 'active' | 'waiting' | 'failed' | 'idle' | 'blocked';

/** 流水线动作（按钮 → 端点）。 */
export type PipelineAction = 'publish' | 'rebuild' | 'reindex' | 'validate' | 'reconcile' | 'mcp_restart';

/** 一段流水线。 */
export interface PipelineStage {
  key: 'edit' | 'build' | 'index' | 'mcp';
  title: string;
  state: StageState;
  /** 段内小字（版本号 / 状态原文 / 错误摘要）。 */
  detail: string;
  /** 该段的失败重试动作（无 → 不显示重试）。 */
  retry?: PipelineAction;
  /** 该段的错误原文（有则进横幅）。 */
  error?: string | null;
}

/** {@link resolvePipeline} 结果。 */
export interface PipelineView {
  stages: PipelineStage[];
  /** 外部漂移：整条置橙 + 阻断除对账外的动作（fail-closed）。 */
  drift: boolean;
  /** 有段失败（横幅告警）。 */
  anyFailed: boolean;
  /** 有动作真正进行中（SYNCING / build·index running / MCP starting）。
   * ⚠️ 「待同步 / 待构建」是 waiting，不算 busy——否则会禁用「立即发布」等按钮形成死锁。 */
  busy: boolean;
}

/** 归一字符串枚举（大小写/空白容错）。 */
function norm(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

/** 成功类词（后端不同动作返回的措辞不完全一致，宽松接受）。 */
const SUCCESS_WORDS = new Set(['success', 'succeeded', 'ok', 'completed', 'done', 'ready', 'synced']);
/** 进行类词。 */
const RUNNING_WORDS = new Set(['running', 'pending', 'indexing', 'syncing', 'in_progress', 'starting']);
/** 失败类词。 */
const FAILED_WORDS = new Set(['failed', 'error', 'crashed', 'unhealthy', 'stopped']);
/** 跳过类词（reindex 等动作不跑 build，写 skipped，不当作失败）。 */
const SKIPPED_WORDS = new Set(['skipped', 'skip', 'n/a', 'na']);

/** 取状态的「三值」归类（ok / active / failed / idle）。 */
export function classifyStatus(raw: string | null | undefined): 'ok' | 'active' | 'failed' | 'idle' {
  const value = norm(raw);
  if (value === '') {
    return 'idle';
  }
  if (SKIPPED_WORDS.has(value)) {
    return 'idle';
  }
  if (SUCCESS_WORDS.has(value)) {
    return 'ok';
  }
  if (RUNNING_WORDS.has(value)) {
    return 'active';
  }
  if (FAILED_WORDS.has(value)) {
    return 'failed';
  }
  return 'idle';
}

/**
 * 编辑态 → 段状态（编辑落库是**离散枚举**，不能走 {@link classifyStatus} 的词表）。
 *
 * <p>{@code SYNC_FAILED}：mis-iqd 在「revision 已对齐 + 最近作业 build=failed」时派生。
 * 此时**编辑已落平台库**，失败的是下游 Wren build —— 若把编辑段落成 failed 并提供
 * 「重试编辑落库」→ 实际走 {@code enhance/sync(scope=materials)}，会反复报「编辑落库失败」
 * 且修不好模型。故 SYNC_FAILED 时编辑段落 ok，只让「MDL 构建」段承担失败与重试。
 */
function editStageState(status: ModelingSyncStatus | null): StageState {
  if (status == null) {
    return 'idle';
  }
  switch (status.edit_status) {
    case 'SYNCED':
      return 'ok';
    case 'EDITED_UNSYNCED':
      // 已落库、待发布 —— 不是「进行中」，勿转圈、勿占 busy
      return 'waiting';
    case 'SYNCING':
      return 'active';
    case 'SYNC_FAILED':
      return 'ok';
    case 'STALE_DRIFT':
      return 'blocked';
    default:
      return 'idle';
  }
}

/**
 * MCP 就绪度 → 段状态。
 *
 * <p>⚠️ **不能复用 {@link classifyStatus}**：`running` 在 MCP 语境里是「就绪」（进程在跑），
 * 在 build/index 语境里却是「进行中」。同一个词两种含义，复用会让 **MCP 就绪时显示「进行中」**
 * ——整条流水线看起来永远没跑完（本批单测抓出的 bug，见 `PublishPipelineBar.test.ts`）。
 */
export function mcpStageState(mcpStatus: string | null | undefined): StageState {
  const value = norm(mcpStatus);
  if (value === '') {
    return 'idle';
  }
  if (value === 'running' || value === 'ready' || value === 'healthy') {
    return 'ok';
  }
  if (value === 'starting' || value === 'pending') {
    return 'active';
  }
  if (FAILED_WORDS.has(value)) {
    return 'failed';
  }
  return 'idle';
}

/**
 * 编排四段流水线（**纯函数**，便于单测钉住状态机映射）。
 *
 * @param status    `useSyncStatus` 的 sync-status（null = 尚未加载/无连接）；用**超集**类型
 *                  以便读 `build_error` / `index_error`（见文件头 import 处的说明）
 * @param mcpStatus `GET /iqd/mcp/status` 的 `mcp_status`
 */
export function resolvePipeline(
  status: ModelingSyncStatus | null,
  mcpStatus: string | null | undefined,
): PipelineView {
  const editState = editStageState(status);
  const drift = status?.edit_status === 'STALE_DRIFT' || status?.stale_drift === true;

  const current = status?.current_edit_revision ?? 0;
  const built = status?.built_edit_revision ?? 0;
  const behind = built < current;

  const buildClass = classifyStatus(status?.build_status);
  // 「版本落后」= 待构建（waiting），不是 running；真正 running/pending 才是 active
  const buildState: StageState =
    buildClass === 'failed'
      ? 'failed'
      : buildClass === 'active'
        ? 'active'
        : behind
          ? 'waiting'
          : buildClass === 'ok'
            ? 'ok'
            : 'idle';

  const indexClass = classifyStatus(status?.index_status);
  const indexState: StageState = indexClass === 'idle' ? 'idle' : indexClass;

  const mcpState = mcpStageState(mcpStatus);

  const stages: PipelineStage[] = [
    {
      key: 'edit',
      title: '编辑落库',
      state: editState,
      detail:
        editState === 'waiting'
          ? '待发布'
          : `版本 ${current}${built ? ` / 已构建 ${built}` : ''}`,
      // 编辑段失败的重试 = 重新触发一次发布（幂等：同一 revision 的重复触发由后端合并窗口吸收）
      ...(editState === 'failed' ? { retry: 'publish' as PipelineAction } : {}),
      error: editState === 'failed' ? status?.build_error ?? null : null,
    },
    {
      key: 'build',
      title: 'MDL 构建',
      state: buildState,
      detail:
        buildClass === 'active'
          ? '进行中'
          : behind && buildClass !== 'failed'
            ? '待构建'
            : status?.build_status ?? '未构建',
      ...(buildState === 'failed' ? { retry: 'rebuild' as PipelineAction } : {}),
      error: buildState === 'failed' ? status?.build_error ?? null : null,
    },
    {
      key: 'index',
      title: '记忆索引',
      state: indexState,
      detail: indexClass === 'idle' ? '未索引' : indexClass === 'active' ? '进行中' : status?.index_status ?? '',
      ...(indexState === 'failed' ? { retry: 'reindex' as PipelineAction } : {}),
      error: indexState === 'failed' ? status?.index_error ?? null : null,
    },
    {
      key: 'mcp',
      title: 'MCP 就绪',
      state: mcpState,
      detail: mcpStatus ?? '未知',
      ...(mcpState === 'failed' ? { retry: 'mcp_restart' as PipelineAction } : {}),
    },
  ];

  return {
    stages,
    drift,
    anyFailed: stages.some((stage) => stage.state === 'failed'),
    // 仅真正进行中才 busy；waiting（待同步/待构建）必须放行「立即发布」等按钮
    busy: stages.some((stage) => stage.state === 'active'),
  };
}

/** 段状态 → Badge variant。 */
function stateVariant(state: StageState): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (state) {
    case 'ok':
      return 'default';
    case 'active':
    case 'waiting':
      return 'secondary';
    case 'failed':
    case 'blocked':
      return 'destructive';
    default:
      return 'outline';
  }
}

/** 段状态 → 图标（ok 见勾、bad 见叹号、active 见转圈、waiting 见静止点）。 */
function StageIcon({ state }: { state: StageState }) {
  if (state === 'active') {
    return <Loader2 className="h-3.5 w-3.5 animate-spin" />;
  }
  if (state === 'waiting') {
    return <span className="inline-block h-2 w-2 rounded-full bg-amber-500" title="待处理" />;
  }
  if (state === 'failed' || state === 'blocked') {
    return <AlertTriangle className="h-3.5 w-3.5" />;
  }
  if (state === 'ok') {
    return <ShieldCheck className="h-3.5 w-3.5" />;
  }
  return <span className="inline-block h-2 w-2 rounded-full bg-muted-foreground/40" />;
}

/** 按钮动作 → 人话（用于错误与确认文案）。 */
function actionLabel(action: PipelineAction): string {
  switch (action) {
    case 'publish':
      return '立即发布';
    case 'rebuild':
      return '重试构建';
    case 'reindex':
      return '重新索引';
    case 'validate':
      return '模型校验';
    case 'reconcile':
      return '重新导入';
    case 'mcp_restart':
      return '重启 MCP';
    default:
      return action;
  }
}

/** `PublishPipelineBar` Props。 */
export interface PublishPipelineBarProps {
  connectionId: number | null;
}

/** 发布流水线条。 */
export function PublishPipelineBar({ connectionId }: PublishPipelineBarProps) {
  const { hasPermission } = useIqdModelingPermission();
  const sync = useSyncStatus(connectionId);
  /**
   * 未保存草稿：取 `dirtyDrafts`（Map 引用稳定）再 memo 出 key 列表。
   *
   * <p>**不能**直接把 `selectDirtyItemKeys(state)` 传给 `useModelingStore`：该 selector 每次
   * 返回**新数组**，`Object.is` 判定永远不等 → `useSyncExternalStore` 会持续重渲染
   * （React 会告警 "getSnapshot should be cached"）。若要复用那个 selector，需配
   * `useShallow`（`zustand/react/shallow`）。
   */
  const dirtyDrafts = useModelingStore((state) => state.dirtyDrafts);
  const dirtyItemKeys = useMemo(() => Array.from(dirtyDrafts.keys()), [dirtyDrafts]);

  const [running, setRunning] = useState<PipelineAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmRebuild, setConfirmRebuild] = useState(false);
  const [confirmDirty, setConfirmDirty] = useState<PipelineAction | null>(null);

  /** ④ MCP 就绪：sync-status 里没有该字段 → 专用端点（本组件唯一新增的轮询）。 */
  const mcpQuery = useQuery({
    queryKey: iqdKeys.mcpStatus(connectionId),
    queryFn: () => getMcpStatus(connectionId as number),
    enabled: connectionId != null,
    refetchInterval: IQD_SYNC_POLL_INTERVAL_MS,
    refetchOnWindowFocus: false,
    retry: false, // 40300（无 iqd:mcp:manage）不重试、不刷屏
  });
  const mcpStatus = useMemo(() => {
    const value = mcpQuery.data?.mcp_status ?? mcpQuery.data?.status;
    return typeof value === 'string' ? value : null;
  }, [mcpQuery.data]);

  const view = useMemo(() => resolvePipeline(sync.status, mcpStatus), [sync.status, mcpStatus]);

  /** 逐动作的权限（与后端绑定的码一致，见模块头）。 */
  const allowed: Record<PipelineAction, boolean> = {
    publish: hasPermission(PIPELINE_PERMISSIONS.publish),
    rebuild: hasPermission(PIPELINE_PERMISSIONS.selfHeal),
    reindex: hasPermission(PIPELINE_PERMISSIONS.selfHeal),
    validate: hasPermission(PIPELINE_PERMISSIONS.selfHeal),
    reconcile: hasPermission(PIPELINE_PERMISSIONS.reconcile),
    mcp_restart: hasPermission(PIPELINE_PERMISSIONS.mcp),
  };

  const busy = running !== null || view.busy;

  /** 漂移 fail-closed：只放行「重新导入」。 */
  const blockedByDrift = (action: PipelineAction): boolean => view.drift && action !== 'reconcile';

  const disabledReason = (action: PipelineAction): string => {
    if (connectionId == null) {
      return '请先选择连接';
    }
    if (!allowed[action]) {
      return `无权限（${action === 'mcp_restart' ? PIPELINE_PERMISSIONS.mcp : action === 'reconcile' ? PIPELINE_PERMISSIONS.reconcile : action === 'publish' ? PIPELINE_PERMISSIONS.publish : PIPELINE_PERMISSIONS.selfHeal}）`;
    }
    if (blockedByDrift(action)) {
      return '检测到外部漂移，请先「重新导入」收敛（fail-closed）';
    }
    if (busy) {
      return '有流水线动作进行中';
    }
    return '';
  };

  const run = useCallback(
    async (action: PipelineAction) => {
      if (connectionId == null) {
        return;
      }
      setRunning(action);
      setError(null);
      setNotice(null);
      try {
        if (action === 'publish') {
          // 建模台发布 = 按 catalog 派生 MDL（scope=model）；materials 只下发样本对/知识
          await syncIqdEnhancements(connectionId, false, 'model');
        } else if (action === 'rebuild') {
          await selfHealForceRebuild(connectionId);
        } else if (action === 'reindex') {
          await selfHealReindex(connectionId);
        } else if (action === 'validate') {
          const result = await selfHealValidate(connectionId);
          // Wren 成功库存行（Valid — N models…）可能被旧后端误塞进 warnings，剥掉再判
          const inventoryRe = /^\s*valid\b/i;
          const inventory =
            (result.summary ?? '').trim() ||
            (result.warnings ?? []).map((w) => w.trim()).find((w) => inventoryRe.test(w)) ||
            '';
          const warnings = (result.warnings ?? [])
            .map((w) => w.trim())
            .filter((w) => w && !inventoryRe.test(w));
          if (result.build_status === 'failed') {
            setError(
              `模型校验未通过：${result.build_error || warnings.join('；') || '未知错误'}`,
            );
          } else if (warnings.length > 0) {
            setNotice(`模型校验有 ${warnings.length} 条警告：${warnings.join('；')}`);
          } else {
            setNotice(
              inventory
                ? `模型校验通过：${inventory}`
                : '模型校验通过',
            );
          }
        } else if (action === 'reconcile') {
          await reconcileIqdCatalog(connectionId);
        } else {
          await mcpManage(connectionId, 'restart');
          await mcpQuery.refetch();
        }
        sync.refresh();
      } catch (err) {
        const code = errorCode(err);
        const message = err instanceof Error ? err.message : String(err);
        setError(`${actionLabel(action)}失败：${code != null ? `[${code}] ` : ''}${message}`);
      } finally {
        setRunning(null);
      }
    },
    [connectionId, sync, mcpQuery],
  );

  /** 统一入口：脏草稿拦截 → 高危二次确认 → 执行。 */
  const request = useCallback(
    (action: PipelineAction) => {
      if (connectionId == null || disabledReason(action) !== '') {
        return;
      }
      if (action === 'rebuild') {
        setConfirmRebuild(true);
        return;
      }
      if (dirtyItemKeys.length > 0 && (action === 'publish' || action === 'reindex')) {
        setConfirmDirty(action);
        return;
      }
      void run(action);
    },
    [connectionId, disabledReason, dirtyItemKeys.length, run],
  );

  // 连接切换即清空瞬时态（A-14：不把 A 连接的错误带到 B）
  useEffect(() => {
    setError(null);
    setNotice(null);
    setRunning(null);
  }, [connectionId]);

  const mcpBlocked = mcpQuery.error != null && errorCode(mcpQuery.error) === 40300;

  return (
    <div className="flex flex-col gap-1.5 border-b border-border/60 bg-card px-3 py-2 text-[12px]">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <span className="font-medium text-muted-foreground">发布流水线</span>

        {view.stages.map((stage, index) => (
          <span key={stage.key} className="flex items-center gap-1.5">
            {index > 0 && <span className="text-muted-foreground/50">→</span>}
            <Badge variant={stateVariant(stage.state)} className="h-5 gap-1 px-1.5 text-[11px]">
              <StageIcon state={stage.state} />
              {stage.title}
            </Badge>
            <span className="text-muted-foreground">{stage.detail}</span>
          </span>
        ))}

        {sync.error && <span className="text-destructive">状态获取失败：{sync.error}</span>}
        {mcpBlocked && (
          <span className="text-muted-foreground">MCP 状态需 {PIPELINE_PERMISSIONS.mcp} 权限</span>
        )}

        {/* T03e：编辑了但**没进** MDL 的节点（如全新建模型/视图/指标）。
            此前只写后端日志，用户点保存成功会误以为已生效 —— 这里如实提示。 */}
        {(sync.status?.unmatched_edit_count ?? 0) > 0 ? (
          <span
            className="flex items-center gap-1 rounded-md border border-warning/40 bg-warning/5 px-1.5 py-0.5 text-warning"
            title={
              (sync.status?.unmatched_edits ?? [])
                .map((it) => `${it.kind ?? '?'} · ${it.display_name ?? it.item_key ?? ''}`)
                .join('\n') || undefined
            }
          >
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            {sync.status?.unmatched_edit_count} 项编辑未生效（新建模型/视图/指标暂不自动物化，详见提示）
          </span>
        ) : null}

        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <Button
            size="sm"
            variant="secondary"
            className="h-7 gap-1 px-2 text-[12px]"
            disabled={disabledReason('publish') !== ''}
            title={disabledReason('publish') || '立即发布（触发 context build + memory index + 回填）'}
            onClick={() => request('publish')}
          >
            {running === 'publish' ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Play className="h-3.5 w-3.5" />
            )}
            立即发布
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7 gap-1 px-2 text-[12px]"
            disabled={disabledReason('reindex') !== ''}
            title={disabledReason('reindex') || '重新索引（memory reset + memory index）'}
            onClick={() => request('reindex')}
          >
            {running === 'reindex' ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Database className="h-3.5 w-3.5" />
            )}
            重新索引
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7 gap-1 px-2 text-[12px]"
            disabled={disabledReason('validate') !== ''}
            title={disabledReason('validate') || '模型校验（context validate）'}
            onClick={() => request('validate')}
          >
            {running === 'validate' ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <ShieldCheck className="h-3.5 w-3.5" />
            )}
            模型校验
          </Button>
          <Button
            size="sm"
            variant="destructive"
            className="h-7 gap-1 px-2 text-[12px]"
            disabled={disabledReason('rebuild') !== ''}
            title={disabledReason('rebuild') || '强制重建（context build --force + memory index）'}
            onClick={() => request('rebuild')}
          >
            <Hammer className="h-3.5 w-3.5" />
            强制重建
          </Button>
          {view.drift && (
            <Button
              size="sm"
              className="h-7 gap-1 px-2 text-[12px]"
              disabled={disabledReason('reconcile') !== ''}
              title={disabledReason('reconcile') || '重新导入（按 model 范围重建以重新收敛）'}
              onClick={() => request('reconcile')}
            >
              {running === 'reconcile' ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RotateCcw className="h-3.5 w-3.5" />
              )}
              重新导入
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            className="h-7 w-7 p-0"
            title="刷新状态"
            onClick={() => {
              sync.refresh();
              void mcpQuery.refetch();
            }}
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* 漂移：整条置橙 + fail-closed 说明（详情面板属 T04） */}
      {view.drift && (
        <div className="flex items-center gap-2 rounded border border-amber-500/50 bg-amber-50/80 px-2 py-1 text-amber-900">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          <span>
            检测到外部漂移（WrenAI 侧 MDL 已偏离平台基线）。已阻断发布/重建/索引（fail-closed），
            请先「重新导入」收敛；漂移详情面板属 T04。
          </span>
        </div>
      )}

      {/* 段失败：横幅告警 + 段内重试（幂等） */}
      {view.anyFailed && (
        <div className="flex flex-wrap items-center gap-2 rounded border border-destructive/40 bg-destructive/5 px-2 py-1 text-destructive">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          <span>
            {view.stages
              .filter((stage) => stage.state === 'failed')
              .map((stage) => `${stage.title}失败${stage.error ? `：${stage.error}` : ''}`)
              .join('；')}
          </span>
          {view.stages
            .filter((stage) => stage.state === 'failed' && stage.retry)
            .map((stage) => (
              <Button
                key={stage.key}
                size="sm"
                variant="outline"
                className="h-6 gap-1 px-1.5 text-[11px]"
                disabled={disabledReason(stage.retry as PipelineAction) !== ''}
                title={disabledReason(stage.retry as PipelineAction) || `重试：${stage.title}`}
                onClick={() => request(stage.retry as PipelineAction)}
              >
                {running === stage.retry ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <RotateCcw className="h-3 w-3" />
                )}
                重试{stage.title}
              </Button>
            ))}
        </div>
      )}

      {error && (
        <div className="rounded border border-destructive/40 bg-destructive/5 px-2 py-1 text-destructive">
          {error}
        </div>
      )}
      {notice && !error && (
        <div className="rounded border border-warning/40 bg-warning/5 px-2 py-1 text-warning">
          {notice}
        </div>
      )}

      {/* 未保存草稿拦截（store.dirtyDrafts：语义编辑草稿；布局坐标不在此列） */}
      <Dialog open={confirmDirty != null} onOpenChange={(open) => !open && setConfirmDirty(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-[14px]">还有未保存的编辑</DialogTitle>
            <DialogDescription className="text-[12px]">
              当前有 {dirtyItemKeys.length} 项未提交的编辑（{dirtyItemKeys.slice(0, 3).join('、')}
              {dirtyItemKeys.length > 3 ? ' 等' : ''}）。发布将不包含这些改动。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button size="sm" variant="outline" onClick={() => setConfirmDirty(null)}>
              先去保存
            </Button>
            <Button
              size="sm"
              onClick={() => {
                const action = confirmDirty;
                setConfirmDirty(null);
                if (action) {
                  void run(action);
                }
              }}
            >
              仍然{confirmDirty ? actionLabel(confirmDirty) : '发布'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 强制重建二次确认（沿用 SelfHealPanel 范式） */}
      <Dialog open={confirmRebuild} onOpenChange={setConfirmRebuild}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-[14px]">确认强制重建？</DialogTitle>
            <DialogDescription className="text-[12px]">
              将执行 <span className="font-mono">context build --force</span> 并重新下发记忆索引，
              会覆盖当前 WrenAI 已部署的语义模型。请确认当前无进行中的同步任务。
              {dirtyItemKeys.length > 0 && (
                <span className="mt-1 block text-destructive">
                  注意：还有 {dirtyItemKeys.length} 项未保存的编辑，重建同样不会包含它们。
                </span>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button size="sm" variant="outline" onClick={() => setConfirmRebuild(false)} disabled={running !== null}>
              取消
            </Button>
            <Button
              size="sm"
              variant="destructive"
              disabled={running !== null}
              onClick={() => {
                setConfirmRebuild(false);
                void run('rebuild');
              }}
            >
              {running === 'rebuild' ? '重建中…' : '确认重建'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default PublishPipelineBar;
