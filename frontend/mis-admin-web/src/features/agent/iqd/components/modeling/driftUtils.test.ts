/**
 * driftUtils.test.ts — 漂移详情面板纯函数单测（T04b / MR-11 回归守卫）。
 *
 * <p>钉住三处**静默失效**：
 * <ol>
 *   <li>{@link isDrifting} 的两个信号（`edit_status` / `stale_drift`）—— 漏判会让用户在已发散的数据上继续编辑；</li>
 *   <li>{@link selectDriftDiffItems} 的「非平台来源」口径 —— 口径错会给出误导性的排查清单；</li>
 *   <li>{@link forceRebuildBlockReason} 的 fail-closed 顺序（漂移优先于权限）。</li>
 * </ol>
 */
import { describe, expect, it } from 'vitest';
import type { IqdCatalogItem } from '@/lib/api/iqd';
import type { IqdCatalogSyncStatus } from '../../types/modeling';
import {
  DRIFT_PERMISSIONS,
  SYNC_FROM_MDL_ENTRY_PATH,
  countByKind,
  forceRebuildBlockReason,
  formatMdlHash,
  isDrifting,
  reconcileBlockReason,
  resolveDriftView,
  selectDriftDiffItems,
} from './driftUtils';

/** 造 sync-status（只填被测字段）。 */
function status(partial: Partial<IqdCatalogSyncStatus>): IqdCatalogSyncStatus {
  return partial as IqdCatalogSyncStatus;
}

/** 造 catalog 项。 */
function item(partial: Partial<IqdCatalogItem> & { item_key: string; kind: string }): IqdCatalogItem {
  return partial as IqdCatalogItem;
}

describe('isDrifting（两个信号任一为真）', () => {
  it('edit_status=STALE_DRIFT → 漂移', () => {
    expect(isDrifting(status({ edit_status: 'STALE_DRIFT' }))).toBe(true);
  });

  it('stale_drift=true 即使 edit_status 正常也算漂移', () => {
    expect(isDrifting(status({ edit_status: 'SYNCED', stale_drift: true }))).toBe(true);
    expect(isDrifting(status({ edit_status: 'SYNCED', stale_drift: false }))).toBe(false);
  });

  it('null / 无漂移信号 → false（不该误锁死流水线）', () => {
    expect(isDrifting(null)).toBe(false);
    expect(isDrifting(undefined)).toBe(false);
    expect(isDrifting(status({ edit_status: 'SYNCED' }))).toBe(false);
    expect(isDrifting(status({ edit_status: 'EDITED_UNSYNCED', stale_drift: false }))).toBe(false);
  });
});

describe('selectDriftDiffItems（非平台来源启发式）', () => {
  it('过滤掉 platform_edit / modeling；保留 mdl / db_meta 等非平台来源', () => {
    const catalog = [
      item({ item_key: 'mdl:model:orders', kind: 'model', source: 'platform_edit' }),
      item({ item_key: 'mdl:cube:rev', kind: 'cube', source: 'modeling' }),
      item({ item_key: 'pg.public.orders', kind: 'table', source: 'mdl', display_name: 'orders' }),
      item({ item_key: 'pg.public.orders.amount', kind: 'column', source: 'db_meta' }),
      item({ item_key: 'mdl:model:ghost', kind: 'model' }), // source 缺失 → unknown → 保留
    ];
    const diff = selectDriftDiffItems(catalog);
    expect(diff.map((entry) => entry.itemKey)).toEqual([
      'mdl:model:ghost',
      'pg.public.orders',
      'pg.public.orders.amount',
    ]);
    expect(diff.find((entry) => entry.itemKey === 'pg.public.orders')?.source).toBe('mdl');
    expect(diff.find((entry) => entry.itemKey === 'mdl:model:ghost')?.source).toBe('unknown');
  });

  it('按 item_key 升序稳定排序（清单不抖动）', () => {
    const diff = selectDriftDiffItems([
      item({ item_key: 'b', kind: 'table', source: 'mdl' }),
      item({ item_key: 'a', kind: 'table', source: 'mdl' }),
    ]);
    expect(diff.map((entry) => entry.itemKey)).toEqual(['a', 'b']);
  });
});

describe('countByKind（保首现序计数）', () => {
  it('按 kind 首现顺序计数', () => {
    const counts = countByKind([
      { itemKey: 'a', kind: 'model', source: 'mdl', displayName: null },
      { itemKey: 'b', kind: 'table', source: 'mdl', displayName: null },
      { itemKey: 'c', kind: 'model', source: 'mdl', displayName: null },
    ]);
    expect(counts).toEqual([
      { kind: 'model', count: 2 },
      { kind: 'table', count: 1 },
    ]);
  });
});

describe('formatMdlHash', () => {
  it('长指纹截断 12 字符 + 省略号；短指纹/空值各归其位', () => {
    expect(formatMdlHash('0123456789abcdef0123')).toBe('0123456789ab…');
    expect(formatMdlHash('short')).toBe('short');
    expect(formatMdlHash(null)).toBe('—');
    expect(formatMdlHash(undefined)).toBe('—');
  });
});

describe('resolveDriftView（组件唯一数据源）', () => {
  it('null status → 全 0 / 不漂移（不误报）', () => {
    const view = resolveDriftView(null, [], null);
    expect(view.drifting).toBe(false);
    expect(view.currentEditRevision).toBe(0);
    expect(view.builtEditRevision).toBe(0);
    expect(view.revisionLag).toBe(0);
    expect(view.mdlHash).toBeNull();
    expect(view.diffItems).toEqual([]);
  });

  it('revisionLag = current - built，负数归 0（built 超前是异常态，不该出现负差）', () => {
    expect(
      resolveDriftView(status({ current_edit_revision: 7, built_edit_revision: 3 }), [], null)
        .revisionLag,
    ).toBe(4);
    expect(
      resolveDriftView(status({ current_edit_revision: 2, built_edit_revision: 5 }), [], null)
        .revisionLag,
    ).toBe(0);
  });

  it('漂移 + 候选清单 + 计数一并产出', () => {
    const view = resolveDriftView(
      status({ edit_status: 'STALE_DRIFT', current_edit_revision: 4, built_edit_revision: 2, mdl_hash: 'abcdef0123456789' }),
      [
        item({ item_key: 'pg.public.orders', kind: 'table', source: 'mdl' }),
        item({ item_key: 'mdl:model:orders', kind: 'model', source: 'platform_edit' }),
      ],
      '2026-09-22T10:00:00.000Z',
    );
    expect(view.drifting).toBe(true);
    expect(view.revisionLag).toBe(2);
    expect(view.diffItems).toHaveLength(1);
    expect(view.diffCountByKind).toEqual([{ kind: 'table', count: 1 }]);
    expect(view.observedAt).toBe('2026-09-22T10:00:00.000Z');
  });
});

describe('fail-closed 置灰原因', () => {
  it('★ 漂移优先于权限：即便有 selfheal 权限，漂移期间也必须置灰', () => {
    expect(forceRebuildBlockReason(true, true)).toContain('fail-closed');
    expect(forceRebuildBlockReason(true, false)).toContain('fail-closed');
  });

  it('未漂移时：无 selfheal 权限给出权限原因；有权限则可点', () => {
    expect(forceRebuildBlockReason(false, false)).toContain(DRIFT_PERMISSIONS.selfHeal);
    expect(forceRebuildBlockReason(false, true)).toBe('');
  });

  it('重新导入：无 iqd:catalog:edit 不可点', () => {
    expect(reconcileBlockReason(false)).toContain(DRIFT_PERMISSIONS.reconcile);
    expect(reconcileBlockReason(true)).toBe('');
  });
});

describe('权限码与入口路径（改动即失败：码写错 = 前端放行、后端 40300）', () => {
  it('逐条钉住（V81:64 / V84:58-60）', () => {
    expect(DRIFT_PERMISSIONS.reconcile).toBe('iqd:catalog:edit');
    expect(DRIFT_PERMISSIONS.selfHeal).toBe('iqd:selfheal:exec');
  });

  it('「重新导入」入口跳既有 /iqd/catalog（A-03：只跳转，不复制流程）', () => {
    expect(SYNC_FROM_MDL_ENTRY_PATH).toBe('/iqd/catalog');
  });
});
