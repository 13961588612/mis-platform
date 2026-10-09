// @vitest-environment jsdom
/**
 * DesignerDialog 单测（T4.2 全屏容器）。
 *
 * 覆盖：
 * 1. `max-w-none` + 定位四类覆盖齐全（缺一个就错位 / 被压成 512px）
 * 2. `min-h-0` 高度链完整 —— 漏一处 ReactFlow 画布高度就是 0
 * 3. Esc / 点外部都能关；**有未保存改动时先二次确认**
 * 4. 「继续编辑」不关外层，「放弃改动」才关
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { DesignerDialog } from './designer-dialog';
import * as formApi from '@/lib/api/form-definition';
import * as workflowApi from '@/lib/api/workflow';
import { __setFormLoadersForTest } from '@/features/biz/forms/forms/form-loaders';

// ReactFlow 在 jsdom 里要 ResizeObserver / DOMMatrix，jsdom 都不提供 ⇒ 打桩
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as unknown as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;
(globalThis as unknown as { DOMMatrixReadOnly?: unknown }).DOMMatrixReadOnly ??= class {
  m22 = 1;
};

vi.mock('@/lib/api/form-definition', () => ({
  fetchEnabledFormDefinitions: vi.fn(),
  fetchFormDefinitions: vi.fn(),
  FORM_STATUS_ENABLED: 'ENABLED',
  FORM_STATUS_DISABLED: 'DISABLED',
}));

vi.mock('@/lib/api/workflow', () => ({
  fetchDefinition: vi.fn(),
  fetchDefinitions: vi.fn(),
}));

function outerDialog(): HTMLElement {
  return screen.getAllByRole('dialog')[0];
}

function renderDialog() {
  const onOpenChange = vi.fn();
  render(<DesignerDialog open onOpenChange={onOpenChange} />);
  return onOpenChange;
}

describe('DesignerDialog', () => {
  beforeEach(() => {
    __setFormLoadersForTest({});
    vi.mocked(formApi.fetchEnabledFormDefinitions).mockResolvedValue([]);
    vi.mocked(workflowApi.fetchDefinition).mockRejectedValue(new Error('n/a'));
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('拆掉 max-w-lg 并把居中定位四个类全覆盖', async () => {
    renderDialog();

    await waitFor(() => expect(screen.getAllByRole('dialog').length).toBeGreaterThan(0));
    const cls = outerDialog().className;
    expect(cls).toContain('max-w-none');
    expect(cls).toContain('left-4');
    expect(cls).toContain('top-4');
    expect(cls).toContain('translate-x-0');
    expect(cls).toContain('translate-y-0');
    expect(cls).toContain('w-[calc(100vw-4rem)]');
    expect(cls).toContain('h-[calc(100vh-4rem)]');
    // 默认的居中位移必须已被 tailwind-merge 挤掉
    expect(cls).not.toContain('-translate-x-1/2');
    expect(cls).not.toContain('-translate-y-1/2');
  });

  it('高度链上 min-h-0 齐全（画布不塌陷）', async () => {
    renderDialog();

    await waitFor(() => expect(screen.getByText('流程设计器')).toBeTruthy());
    const root = outerDialog();
    // ① DialogContent 自身是 flex-col 且有确定高度
    expect(root.className).toContain('flex');
    expect(root.className).toContain('flex-col');
    // ② DesignerBody 根：flex-1 + min-h-0
    const body = root.querySelector(':scope > div.flex-1') as HTMLElement | null;
    expect(body).toBeTruthy();
    expect(body?.className).toContain('min-h-0');
    // ③ 三栏容器：flex-1 + min-h-0 + overflow-hidden
    const columns = body?.querySelector(':scope > div.min-h-0.flex-1.overflow-hidden');
    expect(columns).toBeTruthy();
  });

  it('无改动时 Esc 直接关闭', async () => {
    const onOpenChange = renderDialog();
    await waitFor(() => expect(screen.getByText('流程设计器')).toBeTruthy());

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('有未保存改动时 Esc 先弹二次确认，不直接关', async () => {
    const onOpenChange = renderDialog();
    await waitFor(() => expect(screen.getByText('流程设计器')).toBeTruthy());

    // 动一下画布（自动布局）⇒ dirty
    fireEvent.click(screen.getByText('自动布局'));
    fireEvent.keyDown(document, { key: 'Escape' });

    expect(await screen.findByText('放弃未保存的改动？')).toBeTruthy();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it('「继续编辑」只关确认框，「放弃改动」才关外层', async () => {
    const onOpenChange = renderDialog();
    await waitFor(() => expect(screen.getByText('流程设计器')).toBeTruthy());
    fireEvent.click(screen.getByText('自动布局'));
    fireEvent.keyDown(document, { key: 'Escape' });

    fireEvent.click(await screen.findByText('继续编辑'));
    await waitFor(() => expect(screen.queryByText('放弃未保存的改动？')).toBeNull());
    expect(onOpenChange).not.toHaveBeenCalled();

    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.click(await screen.findByText('放弃改动'));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
