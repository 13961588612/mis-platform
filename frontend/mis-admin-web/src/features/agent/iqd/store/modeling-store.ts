/**
 * modeling-store.ts — 可视化建模台 UI 态（zustand，Q5：仅 UI 态，不持服务端真值）。
 *
 * <p><b>职责边界（system-design §1.1 Q5）</b>：
 * - 服务端状态（catalog / sync-status / layout）→ **TanStack Query 单一缓存源**；
 * - UI 态（选中项 / 视口 / 抽屉开合 / 脏标记 / wizard 步骤 / 发布中）→ **本 store**；
 * - 画布 nodes/edges 由 catalog 数据 **selector 派生**，本 store **不持第二份真值**。
 *
 * <p>形态对齐 system-design §5 classDiagram 的 `ModelingStore`（字段 / 动作签名一致）；
 * 额外提供 `setConnectionId` / `setViewport` / `setSelectedNodeIds` / `setIsPublishing`
 * 四个 setter —— 类图只列了「业务动作」，而连接上下文与视口在 T02 起需要写入口
 * （A-14：wizard 状态按 connId 隔离，切换连接时需重置）。
 *
 * <p><b>T01 完整性要求</b>：本 store 逻辑纯净可测（无 IO、无副作用、无业务），
 * 单测见同目录 `modeling-store.test.ts`（vitest；项目既有测试框架）。
 */
import { create } from 'zustand';
import type { DrawerKind, ItemDraft, Viewport } from '../types/modeling';

/** 视口初值（画布未初始化时）。 */
const INITIAL_VIEWPORT: Viewport = { x: 0, y: 0, zoom: 1 };

/** 建模台 UI 态**数据字段**（对齐 system-design §5 `ModelingStore` 的属性段）。 */
export interface ModelingUiState {
  /** 当前连接 id（A-14：多连接下所有 UI 态按连接隔离；T01 初值 null）。 */
  connectionId: string | null;
  /** 当前选中项 item_key（右栏 PropertyPanel 数据源；无选中为 null）。 */
  selectedItemKey: string | null;
  /** 多选节点 id 集合（画布框选）。 */
  selectedNodeIds: Set<string>;
  /** 画布视口（拖拽/缩放后回写，用于 layout 持久化）。 */
  viewport: Viewport;
  /** 抽屉开合状态：closed | model | cube | calculatedColumn。 */
  drawer: DrawerKind;
  /** 脏草稿（draft vs server）；key = item_key。 */
  dirtyDrafts: Map<string, ItemDraft>;
  /** 是否正在发布（发布流水线期间禁用编辑入口）。 */
  isPublishing: boolean;
  /** 当前向导步骤（无向导为 null）。 */
  wizardStep: string | null;
  /** 向导步骤历史（`popWizardStep` 回退栈）。 */
  wizardHistory: string[];
}

/** 建模台 UI 态**动作**（§5 类图 + 连接上下文/视口 setter）。 */
export interface ModelingActions {
  /** 设置选中项并同步单元素多选集。 */
  setSelected: (key: string | null) => void;
  /** 打开抽屉（同时设置选中项）。 */
  openDrawer: (kind: DrawerKind, key: string | null) => void;
  /** 关闭抽屉（保留选中项）。 */
  closeDrawer: () => void;
  /** 标记草稿为脏。 */
  markDirty: (itemKey: string, draft: ItemDraft) => void;
  /** 清除脏标记。 */
  clearDirty: (itemKey: string) => void;
  /** 清空全部脏草稿（切换连接 / 发布完成后统一清理）。 */
  clearAllDirty: () => void;
  /** 推入向导步骤（历史栈追加）。 */
  pushWizardStep: (step: string) => void;
  /** 弹出向导步骤，返回弹出项（栈空返回 null）。 */
  popWizardStep: () => string | null;
  /** 重置全部 UI 态到初值。 */
  reset: () => void;
  /** 设置当前连接（切换连接时清空选中与草稿，避免跨连接串扰 —— A-14）。 */
  setConnectionId: (connectionId: string | null) => void;
  /** 设置画布视口。 */
  setViewport: (viewport: Viewport) => void;
  /** 整体替换多选节点集合。 */
  setSelectedNodeIds: (ids: Set<string>) => void;
  /** 设置发布中标记。 */
  setIsPublishing: (isPublishing: boolean) => void;
}

/** 建模台 UI 态 store 接口（数据 + 动作）。 */
export type ModelingState = ModelingUiState & ModelingActions;

/** 全部 UI 态初值（`reset()` 与 create 共用，保证二者恒一致）。 */
function initialState(): ModelingUiState {
  return {
    connectionId: null,
    selectedItemKey: null,
    selectedNodeIds: new Set<string>(),
    viewport: { ...INITIAL_VIEWPORT },
    drawer: 'closed',
    dirtyDrafts: new Map<string, ItemDraft>(),
    isPublishing: false,
    wizardStep: null,
    wizardHistory: [],
  };
}

/**
 * 建模台 UI 态 store（内存态，不持久化）。
 *
 * <p>不持久化的理由：跨页真值是服务端 catalog（TanStack Query 缓存 + 5000ms 轮询），
 * UI 态刷新即重算；layout 坐标的持久化走 `iqd_model_layout`（Q6），不走 store。
 */
export const useModelingStore = create<ModelingState>()((set, get) => ({
  ...initialState(),

  setSelected: (key) =>
    set(() => ({
      selectedItemKey: key,
      selectedNodeIds: key ? new Set<string>([key]) : new Set<string>(),
    })),

  openDrawer: (kind, key) =>
    set(() => ({
      drawer: kind,
      selectedItemKey: key,
      selectedNodeIds: key ? new Set<string>([key]) : new Set<string>(),
    })),

  closeDrawer: () => set(() => ({ drawer: 'closed' })),

  markDirty: (itemKey, draft) =>
    set((state) => {
      const next = new Map(state.dirtyDrafts);
      next.set(itemKey, draft);
      return { dirtyDrafts: next };
    }),

  clearDirty: (itemKey) =>
    set((state) => {
      if (!state.dirtyDrafts.has(itemKey)) {
        return { dirtyDrafts: state.dirtyDrafts };
      }
      const next = new Map(state.dirtyDrafts);
      next.delete(itemKey);
      return { dirtyDrafts: next };
    }),

  clearAllDirty: () =>
    set((state) => {
      if (state.dirtyDrafts.size === 0) {
        return { dirtyDrafts: state.dirtyDrafts };
      }
      return { dirtyDrafts: new Map<string, ItemDraft>() };
    }),

  pushWizardStep: (step) =>
    set((state) => {
      const history =
        state.wizardStep === null ? [...state.wizardHistory] : [...state.wizardHistory, state.wizardStep];
      return { wizardStep: step, wizardHistory: history };
    }),

  popWizardStep: () => {
    const { wizardHistory } = get();
    if (wizardHistory.length === 0) {
      set(() => ({ wizardStep: null }));
      return null;
    }
    const next = [...wizardHistory];
    const popped = next.pop() ?? null;
    set(() => ({ wizardStep: popped, wizardHistory: next }));
    return popped;
  },

  reset: () => set(() => ({ ...initialState() })),

  setConnectionId: (connectionId) =>
    set(() => ({
      // 切换连接即清空跨连接易串扰的 UI 态（A-14 / R-8）
      connectionId,
      selectedItemKey: null,
      selectedNodeIds: new Set<string>(),
      drawer: 'closed',
      dirtyDrafts: new Map<string, ItemDraft>(),
      wizardStep: null,
      wizardHistory: [],
    })),

  setViewport: (viewport) => set(() => ({ viewport: { ...viewport } })),

  setSelectedNodeIds: (ids) => set(() => ({ selectedNodeIds: new Set<string>(ids) })),

  setIsPublishing: (isPublishing) => set(() => ({ isPublishing })),
}));

/** 便捷 selector：当前是否处于脏状态（存在未提交草稿）。 */
export function selectHasDirtyDrafts(state: ModelingState): boolean {
  return state.dirtyDrafts.size > 0;
}

/** 便捷 selector：某个节点是否有未提交草稿（抽屉/顶栏按节点判脏）。 */
export function selectIsDirty(state: ModelingState, itemKey: string): boolean {
  return state.dirtyDrafts.has(itemKey);
}

/** 便捷 selector：脏草稿对应的 item_key 列表（发布前拦截提示用，保插入序）。 */
export function selectDirtyItemKeys(state: ModelingState): string[] {
  return Array.from(state.dirtyDrafts.keys());
}
