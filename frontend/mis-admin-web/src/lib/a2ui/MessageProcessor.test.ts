/**
 * MessageProcessor 单测（QA 回归：B1 / B2 / B3）。
 *
 * <p>场景：
 * - B1：深层 children path 定位（/components/{id}/children/{childId}）
 * - B2：updateDataModel 数组路径创建（rows.0.name / rows[0].name → 数组而非对象字面量）
 * - B3：removeSurface 后 activeSurfaceId 不得悬空
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { processA2uiMessage } from './MessageProcessor';
import { useSurfaceStore } from './surface-store';

function resetStore(): void {
  useSurfaceStore.setState({ surfaces: {}, activeSurfaceId: null });
}

describe('MessageProcessor', () => {
  beforeEach(() => {
    resetStore();
  });

  describe('B1: 深层 children path 定位', () => {
    it('updateComponents 通过 /components/{id}/children/{childId} 更新子节点 props', () => {
      processA2uiMessage({
        type: 'a2ui_surface',
        operations: [
          {
            op: 'createSurface',
            surfaceId: 'sfc-1',
            components: [
              {
                id: 'form-001',
                component: 'form-sheet',
                props: { title: '工单表单' },
                children: [
                  { id: 'field-001', component: 'form-sheet', props: { name: 'subject' } },
                  { id: 'field-002', component: 'form-sheet', props: { name: 'priority' } },
                ],
              },
            ],
          },
        ],
      });

      processA2uiMessage({
        type: 'a2ui_surface',
        operations: [
          {
            op: 'updateComponents',
            surfaceId: 'sfc-1',
            components: [
              {
                path: '/components/form-001/children/field-002',
                props: { name: 'urgency', required: true },
              },
            ],
          },
        ],
      });

      const surface = useSurfaceStore.getState().surfaces['sfc-1'];
      const parent = surface.components.find((c) => c.id === 'form-001');
      const child = parent?.children?.find((c) => c.id === 'field-002');
      expect(child).toBeDefined();
      expect(child?.props.name).toBe('urgency');
      expect(child?.props.required).toBe(true);
      // 未命中的兄弟节点不受影响
      const sibling = parent?.children?.find((c) => c.id === 'field-001');
      expect(sibling?.props.name).toBe('subject');
    });

    it('支持 /components/{index}/children/{index} 数字索引定位', () => {
      processA2uiMessage({
        type: 'a2ui_surface',
        operations: [
          {
            op: 'createSurface',
            surfaceId: 'sfc-idx',
            components: [
              {
                id: 'parent-0',
                component: 'form-sheet',
                props: {},
                children: [{ id: 'kid-0', component: 'form-sheet', props: { v: 'a' } }],
              },
            ],
          },
        ],
      });

      processA2uiMessage({
        type: 'a2ui_surface',
        operations: [
          {
            op: 'updateComponents',
            surfaceId: 'sfc-idx',
            components: [{ path: '/components/0/children/0', props: { v: 'b' } }],
          },
        ],
      });

      const surface = useSurfaceStore.getState().surfaces['sfc-idx'];
      expect(surface.components[0].children?.[0].props.v).toBe('b');
    });

    it('path 命中不到时静默忽略（不抛异常）', () => {
      processA2uiMessage({
        type: 'a2ui_surface',
        operations: [
          { op: 'createSurface', surfaceId: 'sfc-x', components: [{ id: 'a', component: 'data-table', props: {} }] },
        ],
      });

      expect(() =>
        processA2uiMessage({
          type: 'a2ui_surface',
          operations: [
            {
              op: 'updateComponents',
              surfaceId: 'sfc-x',
              components: [{ path: '/components/missing/children/zzz', props: { v: 1 } }],
            },
          ],
        }),
      ).not.toThrow();
    });

    it('支持三层 children path（/components/{id}/children/{id}/children/{id}）', () => {
      processA2uiMessage({
        type: 'a2ui_surface',
        operations: [
          {
            op: 'createSurface',
            surfaceId: 'sfc-depth3',
            components: [
              {
                id: 'root-001',
                component: 'form-sheet',
                props: {},
                children: [
                  {
                    id: 'section-001',
                    component: 'form-sheet',
                    props: {},
                    children: [
                      { id: 'leaf-001', component: 'form-sheet', props: { v: 'old' } },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      });

      processA2uiMessage({
        type: 'a2ui_surface',
        operations: [
          {
            op: 'updateComponents',
            surfaceId: 'sfc-depth3',
            components: [{ path: '/components/root-001/children/section-001/children/leaf-001', props: { v: 'new' } }],
          },
        ],
      });

      const surface = useSurfaceStore.getState().surfaces['sfc-depth3'];
      const leaf = surface.components[0].children?.[0].children?.[0];
      expect(leaf?.props.v).toBe('new');
    });
  });

  describe('B2: updateDataModel 数组路径创建', () => {
    it('rows.0.name 产出数组而非对象字面量', () => {
      processA2uiMessage({
        type: 'a2ui_surface',
        operations: [{ op: 'createSurface', surfaceId: 'sfc-dm' }],
      });

      processA2uiMessage({
        type: 'a2ui_surface',
        operations: [
          { op: 'updateDataModel', surfaceId: 'sfc-dm', path: 'rows.0.name', value: '张三' },
        ],
      });

      const dataModels = useSurfaceStore.getState().surfaces['sfc-dm'].dataModels;
      expect(Array.isArray(dataModels.rows)).toBe(true);
      expect(dataModels.rows).toEqual([{ name: '张三' }]);
    });

    it('支持方括号索引风格 rows[0].name', () => {
      processA2uiMessage({
        type: 'a2ui_surface',
        operations: [{ op: 'createSurface', surfaceId: 'sfc-bracket' }],
      });

      processA2uiMessage({
        type: 'a2ui_surface',
        operations: [
          { op: 'updateDataModel', surfaceId: 'sfc-bracket', path: 'rows[0].name', value: '李四' },
        ],
      });

      const dataModels = useSurfaceStore.getState().surfaces['sfc-bracket'].dataModels;
      expect(Array.isArray(dataModels.rows)).toBe(true);
      expect(dataModels.rows).toEqual([{ name: '李四' }]);
    });

    it('多级数组+对象混合路径', () => {
      processA2uiMessage({
        type: 'a2ui_surface',
        operations: [{ op: 'createSurface', surfaceId: 'sfc-mix' }],
      });

      processA2uiMessage({
        type: 'a2ui_surface',
        operations: [
          { op: 'updateDataModel', surfaceId: 'sfc-mix', path: 'groups.0.items.1.status', value: 'ok' },
        ],
      });

      const dataModels = useSurfaceStore.getState().surfaces['sfc-mix'].dataModels;
      expect(Array.isArray(dataModels.groups)).toBe(true);
      // QA 修复（类型）：dataModels 为 Record<string, unknown>，groups 需断言为数组再索引
      expect((dataModels.groups as unknown[])[0]).toEqual({ items: [undefined, { status: 'ok' }] });
    });

    it('父已存在为对象时数字段写入保留对象（不强制转数组）', () => {
      processA2uiMessage({
        type: 'a2ui_surface',
        operations: [{ op: 'createSurface', surfaceId: 'sfc-obj' }],
      });

      // 先写对象字段 rows.name
      processA2uiMessage({
        type: 'a2ui_surface',
        operations: [
          { op: 'updateDataModel', surfaceId: 'sfc-obj', path: 'rows.name', value: 'root' },
        ],
      });
      // 再向 rows 写数字段：父已存在为对象 → 保留对象，不破坏已有数据
      processA2uiMessage({
        type: 'a2ui_surface',
        operations: [
          { op: 'updateDataModel', surfaceId: 'sfc-obj', path: 'rows.0.v', value: 'x' },
        ],
      });

      const dataModels = useSurfaceStore.getState().surfaces['sfc-obj'].dataModels;
      expect(Array.isArray(dataModels.rows)).toBe(false);
      const rows = dataModels.rows as Record<string, unknown>;
      expect(rows.name).toBe('root');
      expect((rows['0'] as Record<string, unknown>).v).toBe('x');
    });
  });

  describe('F2: v0.9 风格 operations（{version, <one operation>}）', () => {
    it('createSurface + updateComponents（v0.9 风格）渲染 surface', () => {
      processA2uiMessage({
        type: 'a2ui_surface',
        operations: [
          {
            version: 'v0.9',
            createSurface: { surfaceId: 'sfc-v09', catalogId: 'mis-a2ui-catalog-v1' },
          },
          {
            version: 'v0.9',
            updateComponents: {
              surfaceId: 'sfc-v09',
              components: [
                { id: 'root', component: 'data-table', props: { title: '订单' } },
              ],
            },
          },
        ],
      });

      const surface = useSurfaceStore.getState().surfaces['sfc-v09'];
      expect(surface).toBeDefined();
      expect(useSurfaceStore.getState().activeSurfaceId).toBe('sfc-v09');
      expect(surface.components[0].id).toBe('root');
      expect(surface.components[0].component).toBe('data-table');
      expect(surface.components[0].props.title).toBe('订单');
    });

    it('updateDataModel（v0.9 风格）写入 dataModels', () => {
      processA2uiMessage({
        type: 'a2ui_surface',
        operations: [
          { version: 'v0.9', createSurface: { surfaceId: 'sfc-v09-dm' } },
        ],
      });
      processA2uiMessage({
        type: 'a2ui_surface',
        operations: [
          { version: 'v0.9', updateDataModel: { surfaceId: 'sfc-v09-dm', path: 'rows.0.name', value: '王五' } },
        ],
      });

      const dataModels = useSurfaceStore.getState().surfaces['sfc-v09-dm'].dataModels;
      expect(Array.isArray(dataModels.rows)).toBe(true);
      expect(dataModels.rows).toEqual([{ name: '王五' }]);
    });

    it('deleteSurface（v0.9 协议名）映射为 removeSurface，active 清理不悬空', () => {
      processA2uiMessage({
        type: 'a2ui_surface',
        operations: [
          { version: 'v0.9', createSurface: { surfaceId: 'sfc-v09-del' } },
        ],
      });
      expect(useSurfaceStore.getState().activeSurfaceId).toBe('sfc-v09-del');

      processA2uiMessage({
        type: 'a2ui_surface',
        operations: [
          { version: 'v0.9', deleteSurface: { surfaceId: 'sfc-v09-del' } },
        ],
      });

      const state = useSurfaceStore.getState();
      expect(state.surfaces['sfc-v09-del']).toBeUndefined();
      expect(state.activeSurfaceId).toBeNull();
    });

    it('op 风格与 v0.9 风格混用（v0.9 建 surface + op 风格增量更新）', () => {
      processA2uiMessage({
        type: 'a2ui_surface',
        operations: [
          { version: 'v0.9', createSurface: { surfaceId: 'sfc-mix-op' } },
          { version: 'v0.9', updateComponents: { surfaceId: 'sfc-mix-op', components: [{ id: 'c1', component: 'data-table', props: { v: 'a' } }] } },
        ],
      });
      processA2uiMessage({
        type: 'a2ui_surface',
        operations: [
          {
            op: 'updateComponents',
            surfaceId: 'sfc-mix-op',
            components: [{ path: '/components/c1', props: { v: 'b' } }],
          },
        ],
      });

      const surface = useSurfaceStore.getState().surfaces['sfc-mix-op'];
      expect(surface.components[0].props.v).toBe('b');
    });

    it('未知 operation（无 op 且无已知键名）静默忽略不抛异常', () => {
      expect(() =>
        processA2uiMessage({
          type: 'a2ui_surface',
          operations: [
            { version: 'v0.9', unknownOperation: { surfaceId: 'x' } } as unknown as import('./types').A2uiOperation,
          ],
        }),
      ).not.toThrow();
      expect(useSurfaceStore.getState().surfaces['x']).toBeUndefined();
    });
  });

  describe('B3: removeSurface 后 activeSurfaceId 清理', () => {
    it('删除唯一 surface 后 activeSurfaceId 为 null（不悬空）', () => {
      processA2uiMessage({
        type: 'a2ui_surface',
        operations: [{ op: 'createSurface', surfaceId: 'sfc-rm' }],
      });
      // createSurface 后 activeSurfaceId 已设置
      expect(useSurfaceStore.getState().activeSurfaceId).toBe('sfc-rm');

      processA2uiMessage({
        type: 'a2ui_surface',
        operations: [{ op: 'removeSurface', surfaceId: 'sfc-rm' }],
      });

      const state = useSurfaceStore.getState();
      expect(state.surfaces['sfc-rm']).toBeUndefined();
      expect(state.activeSurfaceId).toBeNull();
    });

    it('删除后创建新 surface 时 active 指向新 surface', () => {
      processA2uiMessage({
        type: 'a2ui_surface',
        operations: [{ op: 'createSurface', surfaceId: 'sfc-old' }],
      });
      processA2uiMessage({
        type: 'a2ui_surface',
        operations: [{ op: 'removeSurface', surfaceId: 'sfc-old' }],
      });
      processA2uiMessage({
        type: 'a2ui_surface',
        operations: [{ op: 'createSurface', surfaceId: 'sfc-new' }],
      });

      expect(useSurfaceStore.getState().activeSurfaceId).toBe('sfc-new');
    });

    it('删除非 active surface 时 active 保持原值', () => {
      processA2uiMessage({
        type: 'a2ui_surface',
        operations: [{ op: 'createSurface', surfaceId: 'sfc-a' }],
      });
      processA2uiMessage({
        type: 'a2ui_surface',
        operations: [{ op: 'createSurface', surfaceId: 'sfc-b' }],
      });
      expect(useSurfaceStore.getState().activeSurfaceId).toBe('sfc-b');

      // 删除非 active 的 sfc-a：active 应保持 sfc-b
      processA2uiMessage({
        type: 'a2ui_surface',
        operations: [{ op: 'removeSurface', surfaceId: 'sfc-a' }],
      });

      const state = useSurfaceStore.getState();
      expect(state.surfaces['sfc-a']).toBeUndefined();
      expect(state.surfaces['sfc-b']).toBeDefined();
      expect(state.activeSurfaceId).toBe('sfc-b');
    });
  });

  describe('LLM type→component 归一化', () => {
    it('扁平 type/字段抬升为 component + props，并递归 children', () => {
      processA2uiMessage({
        type: 'a2ui_surface',
        operations: [
          {
            op: 'createSurface',
            surfaceId: 'sfc-type',
            components: [
              {
                id: 'root',
                type: 'Text',
                text: 'hello',
                children: [{ id: 'c1', type: 'Button', label: 'ok' }],
              },
            ],
          },
        ],
      } as any);

      const surface = useSurfaceStore.getState().surfaces['sfc-type'];
      expect(surface).toBeDefined();
      expect(surface.components[0]).toMatchObject({
        id: 'root',
        component: 'Text',
        props: { text: 'hello' },
      });
      expect(surface.components[0].children?.[0]).toMatchObject({
        id: 'c1',
        component: 'Button',
        props: { label: 'ok' },
      });
    });
  });
});
