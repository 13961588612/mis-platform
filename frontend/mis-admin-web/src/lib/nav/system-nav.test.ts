/**
 * system-nav 单元测试（信息架构）：
 * 验证「个人事务」（/task/*）**不**出现在系统管理侧栏（已移至门户/顶栏），
 * 而管理工作「流程中心」仍保留在侧栏。
 */
import { describe, expect, it } from 'vitest';
import { SYSTEM_NAV, flattenNavLeaves, pickBestNavLeaf } from './system-nav';

describe('SYSTEM_NAV · taskflow entries', () => {
  it('系统管理侧栏**不再**包含个人事务（工作台已移至门户/顶栏）', () => {
    const leaves = flattenNavLeaves(SYSTEM_NAV).map((l) => l.path);
    expect(leaves).not.toContain('/task/pending');
    expect(leaves).not.toContain('/task/inbox');
    expect(leaves).not.toContain('/task/my-sent');
    expect(leaves).not.toContain('/task/my-processed');
  });

  it('包含流程中心定义入口', () => {
    const leaves = flattenNavLeaves(SYSTEM_NAV).map((l) => l.path);
    expect(leaves).toContain('/system/workflow/definitions');
  });

  it('最长路径优先：流程中心子路径命中定义页', () => {
    const best = pickBestNavLeaf('/system/workflow/definitions/1', flattenNavLeaves(SYSTEM_NAV));
    expect(best?.path).toBe('/system/workflow/definitions');
  });

  it('流程中心与系统其他叶子不冲突', () => {
    const best = pickBestNavLeaf('/system/workflow/definitions', flattenNavLeaves(SYSTEM_NAV));
    expect(best?.path).toBe('/system/workflow/definitions');
  });
});