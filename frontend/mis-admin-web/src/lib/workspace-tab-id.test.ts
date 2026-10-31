import { describe, expect, it } from 'vitest';
import { isSameWorkspaceTab, resolveWorkspaceTabId } from './workspace-tab-id';

describe('resolveWorkspaceTabId', () => {
  it('普通路径 id 等于 path', () => {
    expect(resolveWorkspaceTabId('/agent/agents')).toBe('/agent/agents');
    expect(resolveWorkspaceTabId('/agent/skills')).toBe('/agent/skills');
    expect(resolveWorkspaceTabId('/kb/libraries/12')).toBe('/kb/libraries/12');
  });

  it('Agent 详情根与二级 Tab 共用同一 id', () => {
    const root = '/agent/agents/spm-report';
    expect(resolveWorkspaceTabId(root)).toBe(root);
    expect(resolveWorkspaceTabId(`${root}/skills`)).toBe(root);
    expect(resolveWorkspaceTabId(`${root}/config`)).toBe(root);
    expect(resolveWorkspaceTabId(`${root}/coordination`)).toBe(root);
  });

  it('未知后缀或更深路径不合并', () => {
    expect(resolveWorkspaceTabId('/agent/agents/spm-report/foo')).toBe(
      '/agent/agents/spm-report/foo',
    );
    expect(resolveWorkspaceTabId('/agent/agents/spm-report/skills/extra')).toBe(
      '/agent/agents/spm-report/skills/extra',
    );
  });

  it('isSameWorkspaceTab 识别同族', () => {
    expect(isSameWorkspaceTab('/agent/agents/a', '/agent/agents/a/skills')).toBe(true);
    expect(isSameWorkspaceTab('/agent/agents/a', '/agent/agents/b')).toBe(false);
  });
});
