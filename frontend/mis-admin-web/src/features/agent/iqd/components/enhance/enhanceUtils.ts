/**
 * enhanceUtils.ts — 增强物料页（`iqd-enhance-page.tsx`）的**纯逻辑层**（T04e / MR-08·09）。
 *
 * <h2>为什么单独成纯函数层（沿用 `instructionUtils` / `propertyEditUtils` 的范式）</h2>
 * 这些判定错了都是**静默**的：
 * <ul>
 *   <li>{@link classifyS07Import}：把「未就绪的空导入」显示成「导入成功」→ 运营以为术语已同步；</li>
 *   <li>{@link ENHANCE_PERMISSIONS}：权限码写错 → 「前端放行、后端 40300」（T04b 踩过）。</li>
 * </ul>
 * 本文件**零运行时依赖**（只 `import type`），可在 node 环境直接单测。
 *
 * <h2>权限码（核实自 `sys_api ⋈ sys_menu_api ⋈ sys_menu` seed，非文档猜测）</h2>
 * <ul>
 *   <li>V73:92568/92569/92570 → 菜单 92515/92516 → `iqd:mask:view` / `iqd:mask:save`</li>
 *   <li>V73:92571/92572/92573 → 菜单 92517/92518 → `iqd:dimension:view` / `iqd:dimension:save`</li>
 *   <li>V73:92574/92575 → 菜单 92519/92511 → `iqd:scope:sync` / `iqd:scope:view`</li>
 *   <li>V74:92578-92585 → 菜单 92521/92522/92523 → `iqd:enhance:view` / `iqd:enhance:save`
 *       / `iqd:enhance:sync`（`enhance/push` 特指 `:sync`）</li>
 *   <li>V78:92586/92587 → 菜单 92525 → **`iqd:enhance:manage`**（`sql-pairs/translate` +
 *       `sql-pairs/trial`；**这一条常被文档漏掉**，本页模块头原先也只写了 `iqd:enhance:view|save|sync`）</li>
 * </ul>
 */

/** 增强物料页权限码（唯一来源，勿在组件里硬编码字符串）。 */
export const ENHANCE_PERMISSIONS = {
  maskView: 'iqd:mask:view',
  maskSave: 'iqd:mask:save',
  dimensionView: 'iqd:dimension:view',
  dimensionSave: 'iqd:dimension:save',
  scopeView: 'iqd:scope:view',
  scopeSync: 'iqd:scope:sync',
  enhanceView: 'iqd:enhance:view',
  enhanceSave: 'iqd:enhance:save',
  /** `POST /iqd/sql-pairs/translate` + `/trial`（V78:92586/92587 → 菜单 92525）。 */
  enhanceManage: 'iqd:enhance:manage',
  enhanceSync: 'iqd:enhance:sync',
} as const;

// ================================================================ S-07 术语导入（③）

/**
 * S-07 平台术语表读接口是否就绪（架构 A6）。
 *
 * <p>判定依据 = **后端能力位点**：mis-iqd `IqdAdminService.importS07Knowledge` 目前是**骨架**
 * （恒返回 `{imported:0, skipped:0, message:"S-07 术语表未就绪（A6 保留位点），本次空导入"}`），
 * 前端**无法在调用前探测**（没有 readiness 端点，且不该为了探测去调一次导入）。
 * 故以**能力开关常量**表达，置 `false` = 未就绪 → 按钮置灰 + tooltip。
 * A6 落地后（后端接上 S-07 只读接口）把它置 `true` 即可，无需改 UI 结构。
 */
export const S07_IMPORT_READY = false;

/** 未就绪时的 tooltip 文案（诚实说明现状，不假装可用）。 */
export const S07_NOT_READY_HINT =
  'S-07 平台术语表读接口尚未就绪（架构 A6 待确认）。当前仅支持本地录入（术语/口径/同义词）；' +
  '该接口就绪后此按钮自动启用。';

/** S-07 导入结果状态。 */
export type S07ImportState = 'idle' | 'not-ready' | 'imported' | 'empty' | 'failed';

/** S-07 导入结果分类。 */
export interface S07ImportOutcome {
  state: S07ImportState;
  /** 人话标签。 */
  label: string;
  imported: number;
  skipped: number;
}

/**
 * S-07 按钮是否可点（未就绪 / 进行中 → 不可点）。
 *
 * @param ready      能力开关（默认取 {@link S07_IMPORT_READY}）
 * @param importing  是否正在进行导入
 */
export function canTriggerS07Import(ready: boolean = S07_IMPORT_READY, importing = false): boolean {
  return ready && !importing;
}

/** 按钮 tooltip：未就绪 → 说明现状；就绪 → 正常说明。 */
export function s07ButtonTitle(ready: boolean = S07_IMPORT_READY): string {
  return ready
    ? '从平台术语表 S-07 单向导入（source=kb_s07；本地编辑不回写 S-07）'
    : S07_NOT_READY_HINT;
}

/**
 * 分类一次 S-07 导入结果（**不把「未就绪空导入」显示成成功**）。
 *
 * <p>优先级：`error` → failed；无 result → idle；message 含「未就绪」→ not-ready；
 * imported > 0 → imported；否则 empty（接口就绪但本次无新增）。
 *
 * @param result 后端返回（`{imported, skipped, message}`）
 * @param error  调用异常消息（非空即 failed）
 */
export function classifyS07Import(
  result: Record<string, unknown> | null | undefined,
  error: string | null,
): S07ImportOutcome {
  if (error) {
    return { state: 'failed', label: `S-07 导入失败：${error}`, imported: 0, skipped: 0 };
  }
  if (result == null) {
    return { state: 'idle', label: '', imported: 0, skipped: 0 };
  }
  const imported = Number(result.imported ?? 0);
  const skipped = Number(result.skipped ?? 0);
  const message = typeof result.message === 'string' ? result.message : '';
  if (message.includes('未就绪')) {
    return { state: 'not-ready', label: message, imported, skipped };
  }
  if (imported > 0) {
    return {
      state: 'imported',
      label: `S-07 导入完成：新增 ${imported} 条、跳过 ${skipped} 条`,
      imported,
      skipped,
    };
  }
  return {
    state: 'empty',
    label: message || `S-07 导入完成：本次无新增（跳过 ${skipped} 条）`,
    imported,
    skipped,
  };
}
