/**
 * modeling-store.test.ts — 建模台 UI 态单测（T01 验收要点 6）。
 *
 * <p>覆盖（对齐 system-design §5 `ModelingStore` 动作集）：
 * `setSelected` / `openDrawer` / `closeDrawer` / `markDirty` / `clearDirty` /
 * `pushWizardStep` / `popWizardStep` / `reset`（+ 连接上下文与视口 setter）。
 *
 * <p>环境：项目既有 vitest（`npm run test`，node 环境即可 —— store 无 DOM 依赖）。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { useModelingStore } from './modeling-store';
import type { ItemDraft } from '../types/modeling';

/** 构造一个最小可用草稿。 */
function draft(itemKey: string): ItemDraft {
  return {
    itemKey,
    kind: 'model',
    baseValues: { displayName: 'orders' },
    draftValues: { displayName: '订单' },
    baseRevision: 3,
    idempotencyKey: `1:model:create:${itemKey}`,
  };
}

beforeEach(() => {
  useModelingStore.getState().reset();
});

describe('ModelingStore 初值', () => {
  it('connectionId / selectedItemKey 为 null，drawer 为 closed', () => {
    const s = useModelingStore.getState();
    expect(s.connectionId).toBeNull();
    expect(s.selectedItemKey).toBeNull();
    expect(s.drawer).toBe('closed');
    expect(s.selectedNodeIds.size).toBe(0);
    expect(s.dirtyDrafts.size).toBe(0);
    expect(s.isPublishing).toBe(false);
    expect(s.wizardStep).toBeNull();
    expect(s.wizardHistory).toEqual([]);
    expect(s.viewport).toEqual({ x: 0, y: 0, zoom: 1 });
  });
});

describe('ModelingStore setSelected', () => {
  it('设置选中项并同步单元素多选集', () => {
    useModelingStore.getState().setSelected('mdl:model:orders');
    const s = useModelingStore.getState();
    expect(s.selectedItemKey).toBe('mdl:model:orders');
    expect([...s.selectedNodeIds]).toEqual(['mdl:model:orders']);
  });

  it('传 null 清空选中与多选集', () => {
    useModelingStore.getState().setSelected('mdl:model:orders');
    useModelingStore.getState().setSelected(null);
    const s = useModelingStore.getState();
    expect(s.selectedItemKey).toBeNull();
    expect(s.selectedNodeIds.size).toBe(0);
  });
});

describe('ModelingStore 抽屉', () => {
  it('openDrawer 设置抽屉种类与选中项', () => {
    useModelingStore.getState().openDrawer('cube', 'mdl:cube:revenue');
    const s = useModelingStore.getState();
    expect(s.drawer).toBe('cube');
    expect(s.selectedItemKey).toBe('mdl:cube:revenue');
  });

  it('closeDrawer 归位 closed 且保留选中项', () => {
    useModelingStore.getState().openDrawer('model', 'mdl:model:orders');
    useModelingStore.getState().closeDrawer();
    const s = useModelingStore.getState();
    expect(s.drawer).toBe('closed');
    expect(s.selectedItemKey).toBe('mdl:model:orders');
  });
});

describe('ModelingStore 脏标记', () => {
  it('markDirty 写入草稿，clearDirty 删除', () => {
    useModelingStore.getState().markDirty('mdl:model:orders', draft('mdl:model:orders'));
    expect(useModelingStore.getState().dirtyDrafts.get('mdl:model:orders')?.baseRevision).toBe(3);

    useModelingStore.getState().clearDirty('mdl:model:orders');
    expect(useModelingStore.getState().dirtyDrafts.size).toBe(0);
  });

  it('clearDirty 对未存在的 key 幂等（引用不变）', () => {
    const before = useModelingStore.getState().dirtyDrafts;
    useModelingStore.getState().clearDirty('mdl:model:absent');
    expect(useModelingStore.getState().dirtyDrafts).toBe(before);
  });
});

describe('ModelingStore 向导步骤', () => {
  it('pushWizardStep 推进并累积历史', () => {
    useModelingStore.getState().pushWizardStep('connection-basic');
    useModelingStore.getState().pushWizardStep('connection-profile');
    const s = useModelingStore.getState();
    expect(s.wizardStep).toBe('connection-profile');
    expect(s.wizardHistory).toEqual(['connection-basic']);
  });

  it('popWizardStep 回退并返回弹出步；栈空返回 null', () => {
    useModelingStore.getState().pushWizardStep('step-1');
    useModelingStore.getState().pushWizardStep('step-2');

    expect(useModelingStore.getState().popWizardStep()).toBe('step-1');
    expect(useModelingStore.getState().wizardStep).toBe('step-1');

    expect(useModelingStore.getState().popWizardStep()).toBeNull();
    expect(useModelingStore.getState().wizardStep).toBeNull();
  });
});

describe('ModelingStore 连接上下文 / 视口', () => {
  it('setConnectionId 清空跨连接易串扰 UI 态（A-14）', () => {
    useModelingStore.getState().openDrawer('model', 'mdl:model:orders');
    useModelingStore.getState().markDirty('mdl:model:orders', draft('mdl:model:orders'));
    useModelingStore.getState().pushWizardStep('step-1');

    useModelingStore.getState().setConnectionId('2');
    const s = useModelingStore.getState();
    expect(s.connectionId).toBe('2');
    expect(s.selectedItemKey).toBeNull();
    expect(s.drawer).toBe('closed');
    expect(s.dirtyDrafts.size).toBe(0);
    expect(s.wizardStep).toBeNull();
  });

  it('setViewport 写入副本（外部对象变更不影响 store）', () => {
    const vp = { x: 10, y: 20, zoom: 1.5 };
    useModelingStore.getState().setViewport(vp);
    vp.x = 999;
    expect(useModelingStore.getState().viewport).toEqual({ x: 10, y: 20, zoom: 1.5 });
  });
});

describe('ModelingStore reset', () => {
  it('reset 归位全部字段', () => {
    const st = useModelingStore.getState();
    st.setConnectionId('1');
    st.setSelected('mdl:model:orders');
    st.openDrawer('model', 'mdl:model:orders');
    st.markDirty('mdl:model:orders', draft('mdl:model:orders'));
    st.pushWizardStep('step-1');
    st.setIsPublishing(true);
    st.setViewport({ x: 5, y: 5, zoom: 2 });

    useModelingStore.getState().reset();
    const s = useModelingStore.getState();
    expect(s.connectionId).toBeNull();
    expect(s.selectedItemKey).toBeNull();
    expect(s.selectedNodeIds.size).toBe(0);
    expect(s.drawer).toBe('closed');
    expect(s.dirtyDrafts.size).toBe(0);
    expect(s.isPublishing).toBe(false);
    expect(s.wizardStep).toBeNull();
    expect(s.wizardHistory).toEqual([]);
    expect(s.viewport).toEqual({ x: 0, y: 0, zoom: 1 });
  });
});
