// @vitest-environment jsdom
/**
 * iqd-knowledge-dialog.test.tsx — 知识/术语「新增 · 编辑」弹窗（导出自动 `iqd-enhance-page.tsx`）。
 *
 * <p>为什么单独钉这个弹窗：它把「保存」从内联表单搬进弹窗，最容易出错的是**载荷契约**：
 * <ul>
 *   <li>带不带 `id` 决定走 `PUT /knowledge/{id}` 还是 `POST /knowledge`（走错 = 新增覆盖旧条目）；</li>
 *   <li>`related_item_keys`（关联对象，归属建模台）必须**原样带回**，否则保存一次就把关联清单
 *       擦成 `null`；</li>
 *   <li>`enabled` 必须沿用条目原值，不能静默改成「启用」。</li>
 * </ul>
 * 这三条在界面上都看不出来，所以用单测钉住。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { IqdKnowledgeDialog } from './iqd-enhance-page';
import type { IqdKnowledge } from '@/lib/api/iqd';
import * as iqdApi from '@/lib/api/iqd';
import { useAuthStore } from '@/stores/auth-store';

vi.mock('@/lib/api/iqd', () => ({ saveIqdKnowledge: vi.fn() }));

const m = vi.mocked(iqdApi);

const TITLE_PLACEHOLDER = '标题/术语（如：销售额）';

function renderDialog(initial: IqdKnowledge | null) {
  const onSaved = vi.fn();
  const onClose = vi.fn();
  render(
    <IqdKnowledgeDialog
      open
      initial={initial}
      onClose={onClose}
      onSaved={onSaved}
      ensureConnection={async () => 9}
    />,
  );
  return { onSaved, onClose };
}

beforeEach(() => {
  // 弹窗内部有页面级权限闸门（iqd:enhance:save）；
  // jsdom 环境默认 permissions 为空 → 保存按钮会被禁用，测试需先注入授权。
  useAuthStore.getState().setPermissions(['iqd:enhance:save', 'iqd:enhance:manage']);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  useAuthStore.getState().setPermissions([]);
});

describe('IqdKnowledgeDialog 保存载荷', () => {
  it('新增：不带 id，落 POST（kind=term、enabled=true）', async () => {
    const { onSaved } = renderDialog(null);
    fireEvent.change(screen.getByPlaceholderText(TITLE_PLACEHOLDER), {
      target: { value: '销售额' },
    });
    fireEvent.click(screen.getByRole('button', { name: /保存/ }));

    await waitFor(() => expect(m.saveIqdKnowledge).toHaveBeenCalledTimes(1));
    expect(m.saveIqdKnowledge).toHaveBeenCalledWith({
      id: undefined,
      connection_id: 9,
      kind: 'term',
      title: '销售额',
      content: null,
      related_item_keys: null,
      enabled: true,
    });
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
  });

  it('编辑：预填行数据，且关联对象 / 启用态原样带回（不被擦成 null、不被静默启用）', async () => {
    const row: IqdKnowledge = {
      id: 7,
      kind: 'metric_definition',
      title: '毛利率',
      content: '（收入-成本）/收入',
      related_item_keys: '["cube:finance","col:amount"]',
      enabled: false,
    };
    const { onSaved } = renderDialog(row);

    // 预填：标题取自行数据（类型/内容同样由 initial 预填）
    expect((screen.getByPlaceholderText(TITLE_PLACEHOLDER) as HTMLInputElement).value).toBe(
      '毛利率',
    );

    fireEvent.change(screen.getByPlaceholderText(TITLE_PLACEHOLDER), {
      target: { value: '毛利率（口径）' },
    });
    fireEvent.click(screen.getByRole('button', { name: /保存修改/ }));

    await waitFor(() => expect(m.saveIqdKnowledge).toHaveBeenCalledTimes(1));
    expect(m.saveIqdKnowledge).toHaveBeenCalledWith({
      id: 7,
      connection_id: 9,
      kind: 'metric_definition',
      title: '毛利率（口径）',
      content: '（收入-成本）/收入',
      related_item_keys: '["cube:finance","col:amount"]',
      enabled: false,
    });
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
  });

  it('标题为空：给出提示且不发请求', async () => {
    renderDialog(null);
    fireEvent.click(screen.getByRole('button', { name: /保存/ }));

    expect(await screen.findByText('标题/术语不能为空')).toBeTruthy();
    expect(m.saveIqdKnowledge).not.toHaveBeenCalled();
  });
});


describe('无权限时的保存闸门', () => {
  it('无 iqd:enhance:save 时「保存」置灰', () => {
    useAuthStore.getState().setPermissions([]);
    renderDialog(null);
    const saveBtn = screen.getByRole('button', { name: /保存/ });
    expect((saveBtn as HTMLButtonElement).disabled).toBe(true);
  });

  it('有 iqd:enhance:save 时可点', () => {
    useAuthStore.getState().setPermissions(['iqd:enhance:save']);
    renderDialog(null);
    const saveBtn = screen.getByRole('button', { name: /保存/ });
    expect((saveBtn as HTMLButtonElement).disabled).toBe(false);
  });
});
