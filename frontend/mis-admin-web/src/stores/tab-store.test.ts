import { beforeEach, describe, expect, it } from 'vitest';
import { useTabStore } from './tab-store';

describe('tab-store Agent 详情族', () => {
  beforeEach(() => {
    useTabStore.setState({
      tabs: [
        {
          id: '/dashboard',
          path: '/dashboard',
          title: '仪表盘',
          icon: 'LayoutDashboard',
          pinned: true,
          appCode: 'system',
        },
      ],
      activeId: '/dashboard',
      lastActivePathByApp: { system: '/dashboard' },
    });
  });

  it('打开详情根与 skills 只保留一个主 Tab，并更新 path', () => {
    const { openTab } = useTabStore.getState();
    openTab({
      path: '/agent/agents/spm-report',
      title: 'Agent 详情',
      icon: 'Bot',
      appCode: 'agent',
    });
    openTab({
      path: '/agent/agents/spm-report/skills',
      title: 'Agent 详情',
      icon: 'Bot',
      appCode: 'agent',
    });

    const { tabs, activeId } = useTabStore.getState();
    const agentTabs = tabs.filter((t) => t.id.startsWith('/agent/agents/'));
    expect(agentTabs).toHaveLength(1);
    expect(agentTabs[0]?.id).toBe('/agent/agents/spm-report');
    expect(agentTabs[0]?.path).toBe('/agent/agents/spm-report/skills');
    expect(activeId).toBe('/agent/agents/spm-report');
  });

  it('切回概览时复用同一 Tab 并改回根 path', () => {
    const { openTab } = useTabStore.getState();
    openTab({ path: '/agent/agents/a/config', title: 'Agent 详情', appCode: 'agent' });
    openTab({ path: '/agent/agents/a', title: 'Agent 详情', appCode: 'agent' });

    const hit = useTabStore.getState().tabs.find((t) => t.id === '/agent/agents/a');
    expect(hit?.path).toBe('/agent/agents/a');
  });

  it('closeTab 返回下一 Tab 的 path 而非 id', () => {
    const { openTab, closeTab } = useTabStore.getState();
    openTab({ path: '/agent/agents/a/skills', title: 'Agent 详情', appCode: 'agent' });
    const next = closeTab('/agent/agents/a');
    expect(next).toBe('/dashboard');
  });
});
