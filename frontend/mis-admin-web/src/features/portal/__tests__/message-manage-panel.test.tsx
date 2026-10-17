// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MessageManagePanel } from '../components/message-manage-panel';
import * as messageManageApi from '@/lib/api/message-manage';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

vi.mock('@/lib/api/message-manage', () => ({
  fetchSentMessages: vi.fn(),
  fetchSentMessageDetail: vi.fn(),
  previewMessageAudience: vi.fn(),
  sendManagedMessage: vi.fn(),
  uploadMessageFile: vi.fn(),
  resolvePhones: vi.fn(),
  downloadMessageFile: vi.fn(),
  audienceLabel: () => '全员',
}));

vi.mock('@/lib/api/orgs', () => ({ listOrgs: vi.fn().mockResolvedValue([]) }));
vi.mock('@/lib/api/depts', () => ({ fetchDeptTree: vi.fn().mockResolvedValue([]) }));
vi.mock('@/lib/api/post-types', () => ({ listPostTypeTree: vi.fn().mockResolvedValue([]) }));
vi.mock('@/lib/api/users', () => ({ pageUsers: vi.fn().mockResolvedValue({ page: 1, size: 20, total: 0, list: [] }) }));

vi.mock('../components/message-rich-editor', () => ({
  MessageRichEditor: () => <div>富文本编辑器</div>,
  normalizeEditorHtml: (html: string) => html,
}));

describe('消息管理界面', () => {
  afterEach(() => cleanup());

  it('先显示发送记录，点添加后进入三个接收条件页签', async () => {
    vi.mocked(messageManageApi.fetchSentMessages).mockResolvedValue({
      page: 1,
      size: 20,
      total: 1,
      list: [{
        id: '1',
        title: '停水通知',
        summary: null,
        senderName: 'admin',
        audience: null,
        readCount: 0,
        totalCount: 3,
        createdAt: '2026-10-16T06:00:00Z',
      }],
    });

    render(<MessageManagePanel onClose={() => {}} />);

    expect(await screen.findByText('停水通知')).toBeTruthy();
    expect(screen.queryByText('富文本编辑器')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '添加' }));

    expect(await screen.findByText('富文本编辑器')).toBeTruthy();
    expect(screen.getByRole('button', { name: '添加部门/岗位条件' })).toBeTruthy();
    expect(screen.getByLabelText('手机号码清单')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '添加部门/岗位条件' }));
    expect(await screen.findByText('选择部门与岗位类型')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    fireEvent.click(screen.getByRole('button', { name: '返回记录' }));
    await waitFor(() => expect(screen.getByText('停水通知')).toBeTruthy());
  });
});
