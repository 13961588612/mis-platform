/**
 * nav-registration.test.ts — 建模台「四处同改」注册链路单测（T01 验收要点 1/2）。
 *
 * <p>覆盖两类**静默失败**风险（两者都不报错，只在界面上表现为「好像少了点什么」）：
 * 1. **icon 静默回退**：`icons.ts` 漏登记 → `resolveNavIcon()` 恒回退 `LayoutDashboard`，
 *    侧栏「可视化建模台」图标与首页一致（无任何报错、无任何日志）。此处用
 *    「解析结果 === lucide 同名导出」把登记是否真实存在钉死。
 * 2. **导航清单缺项**：`iqd-nav.ts` 少一条 leaf → 后端菜单接口不可用（迁移未执行 /
 *    权限未授予）时侧栏该入口直接消失；`PAGE_MAP` 少一条 → 点得进去但渲染「页面不存在」。
 *    此处断言路径 / 标题 / 图标三元组齐全。
 *
 * <p>环境：项目既有 vitest（node 环境；本文件只依赖纯数据与 lucide 组件引用，无 DOM）。
 */
import { describe, expect, it } from 'vitest';
import { Workflow } from 'lucide-react';
import { IQD_NAV, flattenIqdNavLeaves } from '@/lib/nav/iqd-nav';
import { resolveNavIcon } from '@/lib/nav/icons';
import { resolvePageComponent } from '@/components/layout/keep-alive-outlet';

/** 建模台主页路径（与 iqd-modeling-page.tsx 的 IQD_MODELING_PAGE_PATH 一致）。 */
const MODELING_PATH = '/iqd/modeling';

describe('「四处同改」① 导航清单（lib/nav/iqd-nav.ts）', () => {
  it('IQD_NAV 含 /iqd/modeling「可视化建模台」+ Workflow', () => {
    const leaf = flattenIqdNavLeaves().find((n) => n.path === MODELING_PATH);
    expect(leaf).toBeDefined();
    expect(leaf?.title).toBe('可视化建模台');
    expect(leaf?.icon).toBe('Workflow');
  });

  it('建模台紧随旗舰页问数之后（侧栏顺序）', () => {
    const paths = flattenIqdNavLeaves().map((n) => n.path);
    expect(paths.indexOf(MODELING_PATH)).toBe(paths.indexOf('/iqd/data-query') + 1);
  });

  it('既有问数页面路径未被迁移破坏（/iqd/* 不变；指令并入 enhance）', () => {
    const paths = flattenIqdNavLeaves().map((n) => n.path);
    for (const p of [
      '/iqd/data-query',
      '/iqd/config',
      '/iqd/catalog',
      '/iqd/scope',
      '/iqd/test-chat',
      '/iqd/traces',
      '/iqd/enhance',
    ]) {
      expect(paths).toContain(p);
    }
    expect(paths).not.toContain('/iqd/instruction');
    const enhance = flattenIqdNavLeaves().find((n) => n.path === '/iqd/enhance');
    expect(enhance?.title).toBe('知识与规则');
    expect(IQD_NAV.length).toBeGreaterThanOrEqual(8);
  });
});

describe('「四处同改」④ icon 登记（lib/nav/icons.ts，防静默回退）', () => {
  it('Workflow 命中真实 lucide 组件（非 LayoutDashboard 回退）', () => {
    expect(resolveNavIcon('Workflow')).toBe(Workflow);
  });

  it('未登记 icon 才会回退 LayoutDashboard（对照组）', () => {
    expect(resolveNavIcon('__not_registered__')).toBe(resolveNavIcon(null));
    expect(resolveNavIcon('Workflow')).not.toBe(resolveNavIcon('__not_registered__'));
  });

  it('建模台其余 3 个 icon 已登记（GitBranchPlus / Calculator / Layers）', () => {
    for (const name of ['GitBranchPlus', 'Calculator', 'Layers']) {
      expect(resolveNavIcon(name)).not.toBe(resolveNavIcon('__not_registered__'));
    }
  });
});

describe('「四处同改」② PAGE_MAP（keep-alive-outlet.tsx）', () => {
  it('/iqd/modeling 能解析出页面组件（否则渲染「页面不存在」）', () => {
    expect(resolvePageComponent(MODELING_PATH)).not.toBeNull();
  });

  it('既有 /iqd/* 路径仍可解析（迁移无 404；instruction 兼容重定向）', () => {
    for (const p of ['/iqd/config', '/iqd/catalog', '/iqd/scope', '/iqd/enhance', '/iqd/instruction']) {
      expect(resolvePageComponent(p)).not.toBeNull();
    }
  });
});
