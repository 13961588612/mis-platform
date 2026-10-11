/**
 * 全局搜索索引聚合器单测（P0，QA 独立验证轮）。
 *
 * <p><b>被测</b>：`search-registry.ts` 的 `buildSearchIndex()` / `groupLabel()`。
 * <p><b>核心回归</b>：命令面板原先只搜硬编码 `SYSTEM_NAV`（18 叶 + 1「返回门户」= 19 条，
 * 设计事实 F7），kb / agent / iqd / finance / task 的页面**完全搜不到**。本测试锁死
 * 「遍历全部 6 份 `*_NAV` + 带 `appCode` 归属」这一改造目标，防止回退。
 *
 * <p>本文件为纯逻辑（不渲染、不连网），沿用 vitest 默认 `node` 环境。
 */
import { describe, expect, it } from 'vitest';
import { buildSearchIndex, groupLabel, PLATFORM_GROUP_LABEL } from './search-registry';
import { SYSTEM_NAV, flattenNavLeaves } from '@/lib/nav/system-nav';
import { AGENT_NAV } from '@/lib/nav/agent-nav';
import { KB_NAV } from '@/lib/nav/kb-nav';
import { IQD_NAV } from '@/lib/nav/iqd-nav';
import { FINANCE_NAV } from '@/lib/nav/finance-nav';
import { TASK_NAV } from '@/lib/nav/task-nav';
import type { SearchItem } from './types';
import type { AppItem } from '@/types/api';

const APP_CODES = ['system', 'agent', 'kb', 'iqd', 'finance', 'task'] as const;

/** 构造最小可用 AppItem（补齐全部必填字段，避免任何类型断言）。 */
function app(partial: Pick<AppItem, 'id' | 'code' | 'name'> & Partial<AppItem>): AppItem {
  return {
    tenantId: '1',
    icon: null,
    basePath: null,
    description: null,
    portalGroup: null,
    kind: 'host',
    runtime: 'host',
    sort: 0,
    status: 1,
    enterable: true,
    ...partial,
  };
}

/** 6 份 `*_NAV` 的期望叶子总数（各来源真实叶子之和）。 */
const EXPECTED_NAV_LEAF_TOTAL =
  flattenNavLeaves(SYSTEM_NAV).length +
  flattenNavLeaves(AGENT_NAV).length +
  flattenNavLeaves(KB_NAV).length +
  flattenNavLeaves(IQD_NAV).length +
  flattenNavLeaves(FINANCE_NAV).length +
  flattenNavLeaves(TASK_NAV).length;

describe('buildSearchIndex() · 覆盖范围', () => {
  it('遍历全部 6 份 *_NAV：条目数远超旧的 19 条', () => {
    const items = buildSearchIndex();
    // 旧实现只有 18 叶 + 1「返回门户」= 19。改造后必须显著更多。
    expect(items.length).toBeGreaterThan(19);
    // 菜单项 = 6 份 *_NAV 叶子之和；外加 1 条「返回门户」。
    expect(items.filter((i) => i.type === 'menu').length).toBe(EXPECTED_NAV_LEAF_TOTAL + 1);
  });

  it('6 个 APP 归属全覆盖，且平台级（appCode=null）也在索引中', () => {
    const appCodes = new Set(buildSearchIndex().map((i) => i.appCode));
    for (const code of APP_CODES) {
      expect(appCodes.has(code), `应包含 appCode=${code} 的搜索项`).toBe(true);
    }
    expect(appCodes.has(null), '应包含平台级（appCode=null）搜索项').toBe(true);
  });

  it('此前「完全搜不到」的 5 个非 system 页面现已入索引', () => {
    const paths = new Set(buildSearchIndex().map((i) => i.path));
    // 每个非 system APP 取一个代表页面。
    expect(paths.has('/kb/hit-test')).toBe(true);
    expect(paths.has('/agent/feedback')).toBe(true);
    expect(paths.has('/iqd/data-query')).toBe(true);
    expect(paths.has('/finance/bank-account/pos-account/terminals')).toBe(true);
    expect(paths.has('/task/pending')).toBe(true);
  });

  it('SYSTEM_NAV 页面仍在（不回退丢失）', () => {
    const paths = new Set(buildSearchIndex().map((i) => i.path));
    expect(paths.has('/system/role')).toBe(true);
    expect(paths.has('/monitor/login-log')).toBe(true);
  });
});

describe('buildSearchIndex() · 归属字段', () => {
  it('每个菜单项都带 appCode；appName 与 appCode 语义一致（null↔null）', () => {
    const items = buildSearchIndex().filter((i) => i.type === 'menu');
    for (const item of items) {
      expect(item).toHaveProperty('appCode');
      if (item.appCode === null) {
        expect(item.appName, `平台级项 ${item.title} 的 appName 应为 null`).toBeNull();
      } else {
        expect(item.appName, `应用级项 ${item.title} 的 appName 不应为空`).toBeTruthy();
      }
    }
  });

  it('「返回门户」为平台级快捷项，指向 /portal', () => {
    const portal = buildSearchIndex().find((i) => i.title === '返回门户');
    expect(portal).toBeTruthy();
    expect(portal?.appCode).toBeNull();
    expect(portal?.appName).toBeNull();
    expect(portal?.path).toBe('/portal');
  });

  it('id 稳定且唯一（设计 §5.4 规则 `appCode ?? "_" : path ?? title`）', () => {
    const items = buildSearchIndex();
    const ids = items.map((i) => i.id);
    expect(new Set(ids).size, 'id 必须全局唯一').toBe(ids.length);
    // 抽查一条：kb 的命中测试页
    const hit = items.find((i) => i.path === '/kb/hit-test');
    expect(hit?.id).toBe('kb:/kb/hit-test');
    // 平台级「返回门户」
    expect(portalId(items)).toBe('_:/portal');
  });
});

function portalId(items: SearchItem[]): string | undefined {
  return items.find((i) => i.title === '返回门户')?.id;
}

describe('buildSearchIndex(apps) · 并入 APP 列表', () => {
  it('传入 apps 时增设 type="app" 项（appCode=code）', () => {
    const apps: AppItem[] = [
      app({ id: '91010', code: 'kb', name: '知识库', basePath: '/kb', icon: 'BookOpen' }),
      app({ id: '1', code: 'system', name: '系统管理', basePath: '/system', icon: 'Settings' }),
    ];
    const items = buildSearchIndex(apps);
    const appItems = items.filter((i) => i.type === 'app');
    expect(appItems.length).toBe(2);
    const kbApp = appItems.find((i) => i.appCode === 'kb');
    expect(kbApp?.title).toBe('知识库');
    expect(kbApp?.path).toBe('/kb');
  });

  it('未传 apps（fetchApps 失败/未就绪）时仍返回纯 *_NAV 索引，不抛错', () => {
    const base = buildSearchIndex();
    const withUndefined = buildSearchIndex(undefined);
    expect(withUndefined.length).toBe(base.length);
    expect(withUndefined.some((i) => i.type === 'app')).toBe(false);
    expect(withUndefined.length).toBeGreaterThan(19);
  });
});

describe('groupLabel()', () => {
  it('平台级（appCode=null）标签为「平台级」', () => {
    expect(groupLabel(null, null)).toBe(PLATFORM_GROUP_LABEL);
    expect(PLATFORM_GROUP_LABEL).toBe('平台级');
  });

  it('应用级优先用传入的 appName，缺失时回退静态表', () => {
    expect(groupLabel('kb', '知识库')).toBe('知识库');
    expect(groupLabel('kb', null)).toBe('知识库'); // 回退 APP_NAME['kb']
    expect(groupLabel('tab', '工作台')).toBe('工作台');
  });
});
