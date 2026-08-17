import { create } from 'zustand';

/**
 * 部门类型版本计数 store（P0-PT-03 同源刷新）。
 *
 * <p>部门管理页内「部门类型」子 Tab 发生增删改后调用 {@link bumpDeptTypeVersion}，
 * 部门树列表引擎以 {@link deptTypeVersion} 作为 React key —— key 变化即整体重挂载，
 * 部门树 loader 与部门类型下拉（loadDeptTypeOptions）同步重新拉取，保证下拉同源。
 */
interface DeptTypeVersionState {
  deptTypeVersion: number;
  bumpDeptTypeVersion: () => void;
}

export const useDeptTypeVersionStore = create<DeptTypeVersionState>((set) => ({
  deptTypeVersion: 0,
  bumpDeptTypeVersion: () => set((s) => ({ deptTypeVersion: s.deptTypeVersion + 1 })),
}));
