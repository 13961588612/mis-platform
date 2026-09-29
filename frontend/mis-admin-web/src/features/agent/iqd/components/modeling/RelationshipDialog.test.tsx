// @vitest-environment jsdom
/**
 * RelationshipDialog.test.tsx — T03c 关系删除路径的组件级验证（2026-09-29）。
 *
 * <p>为何单独钉：删除是不可撤销操作，且有三个**静默**风险点：
 * <ol>
 *   <li>无写权（`iqd:modeling:edit`）时应不出现删除按钮；</li>
 *   <li>必须经**二次确认**才发请求（否则误点即删）；</li>
 *   <li>42200 带 `dependents` 时必须**列出引用方**并不删（与改名阻断同样式）。</li>
 * </ol>
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { RelationshipDialog } from './RelationshipDialog';
import * as modelingApi from '../../api/iqd-modeling';
import { IqdModelingApiError } from '../../api/iqd-modeling';
import type { IqdCatalogItem } from '@/lib/api/iqd';

vi.mock('../../api/iqd-modeling', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api/iqd-modeling')>();
  return {
    ...actual,
    createRelationship: vi.fn(),
    deleteRelationship: vi.fn(),
  };
});

vi.mock('../../hooks/useDirtyState', () => ({
  useDirtyState: () => ({
    draft: { joinType: 'inner', cardinality: '1:N', condition: 'a.id = b.id' },
    patchDraft: vi.fn(),
    isDirty: false,
    idempotencyKey: 'k',
    rotateIdempotencyKey: vi.fn(),
    resetDraft: vi.fn(),
  }),
}));

const m = vi.mocked(modelingApi);

const RELATION: IqdCatalogItem = {
  item_key: 'mdl:relationship:sale_ord_store',
  kind: 'relationship',
  display_name: 'sale_ord_store',
  expression:
    '{"join_type":"inner","cardinality":"1:N","condition":"a.store_id = b.store_id","source_model":"mdl:model:a","target_model":"mdl:model:b"}',
};

function renderDialog(opts: { canEdit?: boolean } = {}) {
  const onDeleted = vi.fn();
  render(
    <RelationshipDialog
      open
      mode="view"
      onOpenChange={vi.fn()}
      connectionId={1}
      source={{ itemKey: 'mdl:model:a', displayName: 'a', fields: ['store_id'] }}
      target={{ itemKey: 'mdl:model:b', displayName: 'b', fields: ['store_id'] }}
      existing={RELATION}
      baseRevision={7}
      onDeleted={onDeleted}
      canEdit={opts.canEdit ?? true}
    />,
  );
  return { onDeleted };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('关系删除（T03c）', () => {
  it('有写权：弹窗出现「删除关系」按钮', () => {
    renderDialog({ canEdit: true });
    expect(screen.getByRole('button', { name: /删除关系/ })).toBeTruthy();
  });

  it('无写权：不出现删除按钮（保持只读）', () => {
    renderDialog({ canEdit: false });
    expect(screen.queryByRole('button', { name: /删除关系/ })).toBeNull();
  });

  it('必须二次确认：点删除 → 弹确认并不发请求；再确认才发', async () => {
    renderDialog({ canEdit: true });
    fireEvent.click(screen.getByRole('button', { name: /删除关系/ }));
    // 二次确认框已出现，但尚未发请求
    expect(screen.getByText(/确认删除该关系/)).toBeTruthy();
    expect(m.deleteRelationship).not.toHaveBeenCalled();
  });

  it('确认后：传 connectionId / item_key / base_revision，并回调 onDeleted', async () => {
    m.deleteRelationship.mockResolvedValue({
      edit_revision: 8,
      edit_status: 'EDITED_UNSYNCED',
      deleted_item_key: RELATION.item_key,
    });
    const { onDeleted } = renderDialog({ canEdit: true });
    fireEvent.click(screen.getByRole('button', { name: /删除关系/ }));
    fireEvent.click(screen.getByRole('button', { name: /确认删除/ }));

    await waitFor(() => expect(m.deleteRelationship).toHaveBeenCalledTimes(1));
    expect(m.deleteRelationship).toHaveBeenCalledWith(
      1,
      RELATION.item_key,
      7,
      expect.any(String),
    );
    await waitFor(() => expect(onDeleted).toHaveBeenCalledTimes(1));
  });

  it('42200 带 dependents：列出引用方且不回调删除', async () => {
    m.deleteRelationship.mockRejectedValue(
      new IqdModelingApiError('该关系被引用，禁止删除', 42200, {
        dependents: [{ item_key: 'mdl:cube:x', kind: 'cube' }],
      }),
    );
    const { onDeleted } = renderDialog({ canEdit: true });
    fireEvent.click(screen.getByRole('button', { name: /删除关系/ }));
    fireEvent.click(screen.getByRole('button', { name: /确认删除/ }));

    expect(await screen.findByText(/mdl:cube:x/)).toBeTruthy();
    expect(onDeleted).not.toHaveBeenCalled();
  });
});
