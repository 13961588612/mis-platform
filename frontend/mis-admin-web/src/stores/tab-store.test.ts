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
      recentTabIds: ['/dashboard'],
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

  it('closeTab 优先回到同 APP 最近打开过的未关闭 Tab，不跳到邻接的其他 APP', () => {
    const { openTab, closeTab } = useTabStore.getState();
    // 顺序：system 仪表盘 → agent 技能池 → system 用户 → agent 会话（当前）
    openTab({ path: '/agent/skills', title: '技能池', appCode: 'agent' });
    openTab({ path: '/system/users', title: '用户', appCode: 'system' });
    openTab({ path: '/agent/sessions', title: '会话', appCode: 'agent' });

    // 顶栏顺序大致：dashboard | skills | users | sessions
    // 旧逻辑关 sessions 会落到 users（邻接），从而切到 system
    const next = closeTab('/agent/sessions');
    expect(next).toBe('/agent/skills');
    expect(useTabStore.getState().activeId).toBe('/agent/skills');
  });

  it('closeTab 同 APP 无剩余 Tab 时才回退到其他 APP', () => {
    const { openTab, closeTab } = useTabStore.getState();
    openTab({ path: '/agent/skills', title: '技能池', appCode: 'agent' });
    const next = closeTab('/agent/skills');
    expect(next).toBe('/dashboard');
  });
});
