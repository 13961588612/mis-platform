/**
 * enhanceUtils.test.ts — 增强物料页纯逻辑单测（T04e / MR-08·09 回归守卫）。
 *
 * <p>钉住两处**静默失效**：
 * <ol>
 *   <li>{@link classifyS07Import}：把后端骨架的「未就绪空导入」显示成「导入成功」→ 运营误以为术语已同步；</li>
 *   <li>{@link ENHANCE_PERMISSIONS}：权限码写错 → 「前端放行、后端 40300」（T04b 踩过；
 *       尤其 `sql-pairs/translate|trial` 用的是 `iqd:enhance:manage`，常被文档漏写）。</li>
 * </ol>
 */
import { describe, expect, it } from 'vitest';
import {
  ENHANCE_PERMISSIONS,
  S07_IMPORT_READY,
  S07_NOT_READY_HINT,
  canTriggerS07Import,
  classifyS07Import,
  s07ButtonTitle,
} from './enhanceUtils';

describe('ENHANCE_PERMISSIONS（核实自 seed，改动即失败）', () => {
  it('逐条钉住', () => {
    expect(ENHANCE_PERMISSIONS.maskView).toBe('iqd:mask:view');
    expect(ENHANCE_PERMISSIONS.maskSave).toBe('iqd:mask:save');
    expect(ENHANCE_PERMISSIONS.dimensionView).toBe('iqd:dimension:view');
    expect(ENHANCE_PERMISSIONS.dimensionSave).toBe('iqd:dimension:save');
    expect(ENHANCE_PERMISSIONS.scopeView).toBe('iqd:scope:view');
    expect(ENHANCE_PERMISSIONS.scopeSync).toBe('iqd:scope:sync');
    expect(ENHANCE_PERMISSIONS.enhanceView).toBe('iqd:enhance:view');
    expect(ENHANCE_PERMISSIONS.enhanceSave).toBe('iqd:enhance:save');
    expect(ENHANCE_PERMISSIONS.enhanceSync).toBe('iqd:enhance:sync');
  });

  it('★ translate/trial 用 iqd:enhance:manage（V78:92586/92587 → 菜单 92525），非 :save', () => {
    expect(ENHANCE_PERMISSIONS.enhanceManage).toBe('iqd:enhance:manage');
    expect(ENHANCE_PERMISSIONS.enhanceManage).not.toBe(ENHANCE_PERMISSIONS.enhanceSave);
    expect(ENHANCE_PERMISSIONS.enhanceManage).not.toBe(ENHANCE_PERMISSIONS.enhanceSync);
  });

  it('不得出现通配符式权限码（如 iqd:mask:*，这是本次纠正的文档写法）', () => {
    for (const code of Object.values(ENHANCE_PERMISSIONS)) {
      expect(code).not.toContain('*');
    }
  });
});

describe('S-07 就绪判定（③）', () => {
  it('默认未就绪（A6）', () => {
    expect(S07_IMPORT_READY).toBe(false);
  });

  it('canTriggerS07Import：未就绪 / 进行中 → 不可点', () => {
    expect(canTriggerS07Import(false, false)).toBe(false);
    expect(canTriggerS07Import(false, true)).toBe(false);
    expect(canTriggerS07Import(true, true)).toBe(false);
    expect(canTriggerS07Import(true, false)).toBe(true);
    // 缺省参数 = 取常量（未就绪）
    expect(canTriggerS07Import()).toBe(false);
  });

  it('s07ButtonTitle：未就绪说明 A6，就绪说明用途', () => {
    expect(s07ButtonTitle(false)).toContain('A6');
    expect(s07ButtonTitle(false)).toBe(S07_NOT_READY_HINT);
    expect(s07ButtonTitle(true)).toContain('S-07');
    expect(s07ButtonTitle(true)).not.toContain('未就绪');
  });
});

describe('classifyS07Import（不把「未就绪空导入」当成功）', () => {
  it('异常 → failed（label 含错误消息）', () => {
    const out = classifyS07Import(null, '网络错误');
    expect(out.state).toBe('failed');
    expect(out.label).toContain('网络错误');
  });

  it('无结果 → idle', () => {
    expect(classifyS07Import(null, null)).toEqual({ state: 'idle', label: '', imported: 0, skipped: 0 });
    expect(classifyS07Import(undefined, null).state).toBe('idle');
  });

  it('★ 后端骨架返回（message 含「未就绪」）→ not-ready，**不是** imported', () => {
    const skeleton = {
      imported: 0,
      skipped: 0,
      message: 'S-07 术语表未就绪（A6 保留位点），本次空导入',
    };
    const out = classifyS07Import(skeleton, null);
    expect(out.state).toBe('not-ready');
    expect(out.label).toBe(skeleton.message);
  });

  it('真的导入了 → imported（label 含新增/跳过数）', () => {
    const out = classifyS07Import({ imported: 3, skipped: 1, message: '' }, null);
    expect(out.state).toBe('imported');
    expect(out.imported).toBe(3);
    expect(out.skipped).toBe(1);
    expect(out.label).toContain('3');
    expect(out.label).toContain('1');
  });

  it('接口就绪但本次无新增 → empty', () => {
    const out = classifyS07Import({ imported: 0, skipped: 2, message: '' }, null);
    expect(out.state).toBe('empty');
    expect(out.label).toContain('2');
  });
});
