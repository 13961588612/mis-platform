/**
 * 搜索索引单测（门户三入口 + 各业务 APP 菜单）。
 *
 * <p><b>被测</b>：`search-registry.ts` 的 `buildSearchIndex()`。
 *
 * <p><b>本轮口径</b>：命令面板 = 门户三入口（带 `portalTab`）+ system / agent / kb / iqd / finance
 * 五份菜单（带 `appCode` / `appName`）；**不含工作台（`task`）菜单**，**不含 `type:'app'` 项**。
 *
 * <p>本文件为纯逻辑（不渲染、不连网），沿用 vitest 默认 `node` 环境。
 */
import { describe, expect, it } from 'vitest';
import { buildSearchIndex, groupLabel, PLATFORM_GROUP_LABEL } from './search-registry';

describe('buildSearchIndex() · 门户三入口', () => {
  it('含门户首页 / 待办事项 / 消息中心（且在最前、各带正确 portalTab）', () => {
    const items = buildSearchIndex();
    const portal = items.filter((i) => i.portalTab);
    expect(portal.map((i) => i.title)).toEqual(['门户首页', '待办事项', '消息中心']);
    expect(portal.every((i) => i.path === '/portal')).toBe(true);
    expect(portal.map((i) => i.portalTab)).toEqual(['home', 'todo', 'message']);
    // 三条门户项在前（顺序稳定）
    expect(items.slice(0, 3).map((i) => i.id)).toEqual(['portal:home', 'portal:todo', 'portal:message']);
  });
});

describe('buildSearchIndex() · 各业务 APP 菜单', () => {
  it('含 system / agent / kb / iqd / finance 五份菜单（带 appCode / appName）', () => {
    const items = buildSearchIndex();
    for (const appCode of ['system', 'agent', 'kb', 'iqd', 'finance']) {
      const menus = items.filter((i) => i.appCode === appCode);
      expect(menus.length, `应含 ${appCode} 的菜单`).toBeGreaterThan(0);
      expect(menus.every((i) => i.type === 'menu')).toBe(true);
      expect(menus.every((i) => typeof i.appName === 'string' && i.appName.length > 0)).toBe(true);
    }
  });

  it('代表性菜单项俱在（跨 APP 抽样）', () => {
    const titles = buildSearchIndex().map((i) => i.title);
    for (const title of ['用户管理', '会话反馈', '命中测试', '问数', '终端管理']) {
      expect(titles).toContain(title);
    }
  });

  it('不含工作台（task）菜单', () => {
    const items = buildSearchIndex();
    // 无任何 item 的 appCode 为 'task'
    expect(items.some((i) => i.appCode === 'task')).toBe(false);
    // 工作台代表性菜单项一个都不出现
    for (const gone of ['我的待办', '消息与待办', '我发起的', '我审批的']) {
      expect(items.some((i) => i.title === gone)).toBe(false);
    }
  });

  it('不含 type===\'app\' 项（不放「一个一个应用」）', () => {
    const items = buildSearchIndex();
    expect(items.some((i) => i.type === 'app')).toBe(false);
  });

  it('id 稳定且唯一', () => {
    const ids = buildSearchIndex().map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('每次调用返回独立数组（互不共享引用）', () => {
    const a = buildSearchIndex();
    const b = buildSearchIndex();
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });
});

describe('groupLabel()', () => {
  it('appCode 为 null → 平台级；有 appName 用之', () => {
    expect(groupLabel(null, null)).toBe(PLATFORM_GROUP_LABEL);
    expect(groupLabel('kb', '知识库')).toBe('知识库');
    expect(groupLabel('kb', null)).toBe('知识库');
  });
});
