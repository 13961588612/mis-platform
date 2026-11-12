/**
 * driftUtils.ts — 漂移详情面板的**纯函数**层（v1.11 MR-11；T04b）。
 *
 * <h2>为什么单独成纯函数层（沿用 T03b/T03c 的 `relationUtils` / `cubeUtils` 做法）</h2>
 * 漂移面板的判定错法都是**静默**的：
 * <ul>
 *   <li>{@link isDrifting}：把「非漂移」误判成漂移 → 整条流水线 fail-closed 被锁死（用户以为平台坏了）；
 *       反之漏判 → 用户在已发散的数据上继续编辑；</li>
 *   <li>{@link selectDriftDiffItems}：候选清单口径错 → 展示「谁都没改」或「全都改了」两种误导；</li>
 *   <li>{@link forceRebuildBlockReason}：漂移期间「强制重建」必须置灰（fail-closed），文案错会让人反复点。</li>
 * </ul>
 * 本文件**零运行时依赖**（只 `import type`），可在 node 环境直接单测。
 *
 * <h2>⚠️ 数据可得性（诚实标注，勿过度承诺）</h2>
 * <ul>
 *   <li><b>版本/mdl_hash/编辑态</b>：来自既有 `GET /catalog/sync-status`
 *       （{@link IqdCatalogSyncStatus}），可直接展示；</li>
 *   <li><b>「最近对账时间」</b>：sync-status **当前无该字段**（见 `types/modeling.ts`）。
 *       本面板先展示「前端最近一次成功观测时刻」（本地时间），并在面板里标注来源；
 *       精确的服务端对账时间需后端补字段（见 `TODO(drift-reconcile-time)`）。</li>
 *   <li><b>「差异对象清单」</b>：既有端点**不返回精确 diff**（漂移是整库 `mdl_hash` 级判定）。
 *       {@link selectDriftDiffItems} 采用**保守启发式**：列出「非平台来源」的 catalog 项
 *       （`source ∉ {platform_edit, modeling}`）作为**疑似外部变更候选**，并明确标注「疑似」。
 *       精确 diff 需后端提供比对端点（见 `TODO(drift-diff-endpoint)`）。</li>
 * </ul>
 */
import type { IqdCatalogItem } from '@/lib/api/iqd';
import type { IqdCatalogSyncStatus } from '../../types/modeling';

/**
 * 平台受控写回来源（`iqd_catalog_item.source`）。
 *
 * <p>`platform_edit` = 二/四期 catalog 编辑；`modeling` = 建模台新建。二者之外的
 * （`mdl` / `db_meta` …）= 非平台受控写入 → 漂移排查的**候选**。
 */
export const PLATFORM_SOURCES: ReadonlySet<string> = new Set(['platform_edit', 'modeling']);

/**
 * 漂移面板相关权限码（**与后端 sys_api 绑定逐条对齐**，勿写错 —— 写错 = 「前端放行、后端 40300」）。
 *
 * <ul>
 *   <li>`iqd:catalog:edit`：`POST /catalog/reconcile`（V81:64 绑定 92592 → 菜单 92526）。「重新导入」用它。</li>
 *   <li>`iqd:selfheal:exec`：`POST /self-heal/force-rebuild`（V84:58-60 绑定）。「强制重建」用它。</li>
 * </ul>
 */
export const DRIFT_PERMISSIONS = {
  reconcile: 'iqd:catalog:edit',
  selfHeal: 'iqd:selfheal:exec',
} as const;

/**
 * 「重新导入」比对合并界面的跳转目标（MR-11 / A-03）。
 *
 * <p>权威决策 A-03：沿用既有 `syncCatalogFromMdl` 流程，**只做入口跳转，不复制流程**。
 * 前端既有的入口是 `/iqd/catalog` 页（其 `CatalogSyncStatusBar` + `SelfHealPanel` 承载
 * 漂移横幅与对账按钮）。此常量与 `iqd-catalog-page.tsx` 的 `IQD_CATALOG_PAGE_PATH` 同值
 * —— 刻意**不 import 该页面模块**（避免把整个 catalog 页依赖树拉进建模台 chunk）。
 */
export const SYNC_FROM_MDL_ENTRY_PATH = '/iqd/catalog';

/** 漂移差异候选（见文件头「数据可得性」）。 */
export interface DriftDiffItem {
  itemKey: string;
  kind: string;
  /** 非平台来源（`mdl` / `db_meta` …）。 */
  source: string;
  displayName: string | null;
}

/** 漂移详情视图模型（组件直接渲染）。 */
export interface DriftView {
  /** 是否处于漂移（fail-closed 依据）。 */
  drifting: boolean;
  /** 平台当前编辑版本。 */
  currentEditRevision: number;
  /** 平台已写回的编辑版本。 */
  builtEditRevision: number;
  /** 平台待写回的版本差（`current - built`，负数归 0）。 */
  revisionLag: number;
  /** 平台观测到的 WrenAI 侧 MDL 指纹。 */
  mdlHash: string | null;
  /** 最近一次成功观测时刻（本地；服务端暂无该字段，见文件头）。 */
  observedAt: string | null;
  /** 疑似外部变更候选对象。 */
  diffItems: DriftDiffItem[];
  /** 候选按 kind 计数（保 kind 首现序，便于阅读）。 */
  diffCountByKind: Array<{ kind: string; count: number }>;
}

/**
 * 是否处于漂移（两个信号任一为真）。
 *
 * <p>与 `PublishPipelineBar` 的 `resolvePipeline` 同口径：`edit_status === 'STALE_DRIFT'`
 * **或** `stale_drift === true`（后端补写 `stale_drift` 布尔字段的路径可能先于派生 `edit_status`）。
 */
export function isDrifting(status: IqdCatalogSyncStatus | null | undefined): boolean {
  if (status == null) {
    return false;
  }
  return status.edit_status === 'STALE_DRIFT' || status.stale_drift === true;
}

/** 归一非负整数（`null`/`undefined`/负数 → 0；小数截断）。 */
function toRevision(value: number | null | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return 0;
  }
  return Math.floor(value);
}

/**
 * 从 catalog 中挑出「疑似外部来源对象」（`source ∉ platform_edit/modeling`）。
 *
 * <p>⚠️ 这是**启发式近似**（既有端点不给精确 diff）：漂移是整库 `mdl_hash` 级判定，
 * 精确到 item 的比对需后端提供端点。此处只列出「平台没直接写过」的项作为排查起点。
 *
 * @param catalog catalog 全量（`useCatalogNodes().catalog`）
 * @returns 按 `item_key` 升序的候选清单
 */
export function selectDriftDiffItems(catalog: IqdCatalogItem[]): DriftDiffItem[] {
  return catalog
    .filter((item) => !PLATFORM_SOURCES.has(item.source ?? ''))
    .map((item) => ({
      itemKey: item.item_key,
      kind: item.kind,
      source: item.source ?? 'unknown',
      displayName: item.display_name ?? null,
    }))
    .sort((a, b) => a.itemKey.localeCompare(b.itemKey));
}

/** 候选按 kind 计数（保首现序）。 */
export function countByKind(items: DriftDiffItem[]): Array<{ kind: string; count: number }> {
  const order: string[] = [];
  const counts = new Map<string, number>();
  for (const item of items) {
    if (!counts.has(item.kind)) {
      order.push(item.kind);
      counts.set(item.kind, 0);
    }
    counts.set(item.kind, (counts.get(item.kind) ?? 0) + 1);
  }
  return order.map((kind) => ({ kind, count: counts.get(kind) ?? 0 }));
}

/**
 * 归一：MDL 指纹展示（截断到 12 字符 + 省略号；空 → `—`）。
 *
 * <p>截断而非全长：面板要一眼可读，全长指纹放 `title` 悬浮展示。
 */
export function formatMdlHash(hash: string | null | undefined): string {
  if (!hash) {
    return '—';
  }
  const text = String(hash);
  return text.length > 12 ? `${text.slice(0, 12)}…` : text;
}

/**
 * 构建漂移视图（组件渲染的唯一数据源）。
 *
 * @param status     sync-status（null = 未加载/无连接）
 * @param catalog    catalog 全量（用于挑候选）
 * @param observedAt 最近一次成功观测时刻（本地 ISO 串；null = 尚未观测）
 */
export function resolveDriftView(
  status: IqdCatalogSyncStatus | null,
  catalog: IqdCatalogItem[],
  observedAt: string | null,
): DriftView {
  const currentEditRevision = toRevision(status?.current_edit_revision);
  const builtEditRevision = toRevision(status?.built_edit_revision);
  const diffItems = selectDriftDiffItems(catalog);
  return {
    drifting: isDrifting(status),
    currentEditRevision,
    builtEditRevision,
    revisionLag: Math.max(0, currentEditRevision - builtEditRevision),
    mdlHash: status?.mdl_hash ?? null,
    observedAt,
    diffItems,
    diffCountByKind: countByKind(diffItems),
  };
}

/**
 * 「强制重建」置灰原因（可点返回 `''`）—— 漂移期间 fail-closed。
 *
 * <p>漂移优先于权限判定：即便有权限，漂移期间也应先「重新导入」收敛（A-03 / U3）。
 */
export function forceRebuildBlockReason(drifting: boolean, canSelfHeal: boolean): string {
  if (drifting) {
    return '检测到外部漂移，请先「重新导入」收敛后再重建（fail-closed）';
  }
  if (!canSelfHeal) {
    return `无 ${DRIFT_PERMISSIONS.selfHeal} 权限`;
  }
  return '';
}

/** 「重新导入」置灰原因（可点返回 `''`）。 */
export function reconcileBlockReason(canReconcile: boolean): string {
  return canReconcile ? '' : `无 ${DRIFT_PERMISSIONS.reconcile} 权限`;
}
