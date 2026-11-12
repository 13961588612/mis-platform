// @vitest-environment jsdom
/**
 * designer-page 重定向单测（T4.5 三处同步的第 3 处）。
 *
 * 编排 Dialog 化后，`/system/workflow/designer` 这条路由不能删（V123 的 sys_menu 95007
 * 与 V128 绑在它上面的「取消发布 / PUT 更新定义」两个 sys_menu_api 都指着它），
 * 所以做法是：路由保留 + 侧栏项保留，进来后 `replace` 回流程定义页。
 *
 * ⚠️ 断言的是 **replace**：用 push 会多出一条历史（进一条、退一条），
 * 用户按后退会觉得「退不出去」。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import { WorkflowDesignerPage } from './designer-page';

const navigate = vi.fn();

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => navigate };
});

describe('WorkflowDesignerPage', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('进来即用 replace 跳回流程定义页，不产生历史条目', async () => {
    render(<WorkflowDesignerPage />);

    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith('/system/workflow/definitions', { replace: true }),
    );
  });
});
