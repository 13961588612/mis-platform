import { create } from 'zustand';

/**
 * 岗位类型版本计数 store（P0-PT-03 同源刷新）。
 *
 * <p>岗位管理页内「岗位类型」子 Tab 发生增删改后调用 {@link bumpPostTypeVersion}，
 * 岗位列表引擎以 {@link postTypeVersion} 作为 React key —— key 变化即整体重挂载，
 * 岗位列表 loader 与岗位类型下拉（loadPostTypeOptions）同步重新拉取，保证下拉同源。
 */
interface PostTypeVersionState {
  postTypeVersion: number;
  bumpPostTypeVersion: () => void;
}

export const usePostTypeVersionStore = create<PostTypeVersionState>((set) => ({
  postTypeVersion: 0,
  bumpPostTypeVersion: () => set((s) => ({ postTypeVersion: s.postTypeVersion + 1 })),
}));
