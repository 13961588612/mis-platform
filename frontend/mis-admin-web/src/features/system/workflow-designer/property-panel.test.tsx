// @vitest-environment jsdom
/**
 * PropertyPanel 表单白名单（T4.6）+ 分类枚举（§4.4 字段 3）单测。
 *
 * 覆盖：
 * 1. 选项来自后端「已启用 ∧ 前端已实现」交集，不再是自由文本框
 * 2. 后端 403/500 时降级为前端已实现清单，并打出可见提示（不白屏）
 * 3. 后端有但前端没实现的 code 不出现在候选里
 * 4. 已选中但未注册的 code 标红保留，不静默丢弃
 * 5. 勾选后回传的是逗号串（与后端 `CreateDefinitionRequest.supportedFormCodes` 对齐）
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { PropertyPanel, type FlowMeta } from './property-panel';
import * as formApi from '@/lib/api/form-definition';
import { __setFormLoadersForTest } from '@/features/biz/forms/forms/form-loaders';

vi.mock('@/lib/api/form-definition', () => ({
  fetchEnabledFormDefinitions: vi.fn(),
  fetchFormDefinitions: vi.fn(),
  FORM_STATUS_ENABLED: 'ENABLED',
  FORM_STATUS_DISABLED: 'DISABLED',
}));

const meta: FlowMeta = {
  code: 'PUR_APPROVAL',
  name: '采购审批',
  category: 'APPROVAL',
  description: '',
  supportedFormCodes: '',
};

function renderPanel(overrides: Partial<FlowMeta> = {}) {
  const onChange = vi.fn();
  render(
    <PropertyPanel
      selected={null}
      flowMeta={{ ...meta, ...overrides }}
      onFlowMetaChange={onChange}
      onNodeChange={vi.fn()}
      onDeleteNode={vi.fn()}
    />,
  );
  return onChange;
}

describe('PropertyPanel 表单白名单', () => {
  beforeEach(() => {
    __setFormLoadersForTest({
      PUR_FORM: async () => [
        {
          formCode: 'PUR_FORM',
          name: '采购申请单',
          component: () => null,
          fields: [],
        },
      ],
    });
    vi.mocked(formApi.fetchEnabledFormDefinitions).mockResolvedValue([
      {
        id: '960010',
        tenantId: '1',
        parentId: 0,
        code: 'PUR_FORM',
        name: '采购申请单',
        description: null,
        status: 'ENABLED',
        sortOrder: 0,
        config: null,
        children: null,
        createdAt: null,
        updatedAt: null,
      },
      {
        id: '960011',
        tenantId: '1',
        parentId: 0,
        code: 'GHOST_FORM',
        name: '前端没实现的表单',
        description: null,
        status: 'ENABLED',
        sortOrder: 1,
        config: null,
        children: null,
        createdAt: null,
        updatedAt: null,
      },
    ]);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('白名单是下拉多选，不再是可手打的文本框', async () => {
    renderPanel();

    await waitFor(() => expect(screen.getByTestId('multi-select-trigger')).toBeTruthy());
    // 自由文本框已从白名单字段上消失（流程编码/名称/说明仍是 Input）
    expect(screen.queryByPlaceholderText('PUR_FORM, PUR_EMERGENCY_FORM')).toBeNull();
  });

  it('选项只列「后端已启用 ∧ 前端已实现」的交集', async () => {
    renderPanel();

    await waitFor(() => expect(screen.getByTestId('multi-select-trigger')).toBeTruthy());
    fireEvent.click(screen.getByTestId('multi-select-trigger'));

    expect(screen.getByText('采购申请单（PUR_FORM）')).toBeTruthy();
    expect(screen.queryByText('前端没实现的表单（GHOST_FORM）')).toBeNull();
  });

  it('后端不可用时降级为前端已实现清单，并给出可见提示', async () => {
    vi.mocked(formApi.fetchEnabledFormDefinitions).mockRejectedValue(new Error('403'));
    renderPanel();

    await waitFor(() => expect(screen.getByTestId('multi-select-trigger')).toBeTruthy());
    fireEvent.click(screen.getByTestId('multi-select-trigger'));

    // 不白屏：仍能选到前端已实现的 PUR_FORM
    expect(screen.getByText('PUR_FORM（PUR_FORM）')).toBeTruthy();
    expect(screen.getByText(/后端表单清单不可用/)).toBeTruthy();
  });

  it('已选中但未注册的 code 标红保留，不静默丢弃', async () => {
    renderPanel({ supportedFormCodes: 'PUR_FORM,LEGACY_FORM' });

    await waitFor(() => expect(screen.getByTestId('multi-select-trigger')).toBeTruthy());
    const trigger = screen.getByTestId('multi-select-trigger');
    expect(trigger.textContent).toContain('采购申请单（PUR_FORM）');
    expect(trigger.textContent).toContain('LEGACY_FORM（未注册或已停用）');
    expect(screen.getByText(/未注册或已停用，保存会被后端拒绝/)).toBeTruthy();
  });

  it('勾选后把逗号串回写给 FlowMeta', async () => {
    const onChange = renderPanel();

    await waitFor(() => expect(screen.getByTestId('multi-select-trigger')).toBeTruthy());
    fireEvent.click(screen.getByTestId('multi-select-trigger'));
    fireEvent.click(screen.getAllByRole('checkbox')[0]);

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ supportedFormCodes: 'PUR_FORM' }),
    );
  });

  it('分类收敛为枚举，不再是自由文本', async () => {
    renderPanel();

    // `Field` 的 <Label> 没有 htmlFor，无法用 getByLabelText 关联，按 role 取
    const select = screen.getAllByRole('combobox')[0] as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.value)).toEqual(['APPROVAL', 'NOTICE', 'TASK']);
  });
});
