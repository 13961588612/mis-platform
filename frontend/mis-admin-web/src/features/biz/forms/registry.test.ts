/**
 * 注册表单单测（方案 T2.1 验收标准）。
 *
 * 覆盖：注册成功 / 重复注册抛错 / 未知 code 返回 null / `listRegisteredCodes` 排序。
 *
 * 注：本文件是 node 环境（vite.config.ts 的 `test.environment: 'node'`），
 * 所以用 `createElement` 而不是 JSX——注册表本身不 import 组件，无需 jsdom。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import {
  __resetRegistryForTest,
  isFormRegistered,
  listRegisteredCodes,
  registerForms,
  resolveForm,
  subscribeRegistry,
  unregisterForms,
} from './registry';
import type { FormComponent, FormProps, FormRegistryEntry } from './types';

function Comp(_props: FormProps) {
  return null;
}

function entry(formCode: string, overrides: Partial<FormRegistryEntry> = {}): FormRegistryEntry {
  return {
    formCode,
    name: `表单 ${formCode}`,
    component: Comp as FormComponent,
    fields: [{ key: 'amount', label: '金额', type: 'number' }],
    ...overrides,
  };
}

afterEach(() => {
  __resetRegistryForTest();
});

describe('registerForms / resolveForm', () => {
  it('注册后能按 code 取回完整条目（组件 + fields + name）', () => {
    registerForms([entry('PUR_FORM')]);

    const found = resolveForm('PUR_FORM');
    expect(found).not.toBeNull();
    expect(found?.formCode).toBe('PUR_FORM');
    expect(found?.name).toBe('表单 PUR_FORM');
    expect(found?.component).toBe(Comp);
    expect(found?.fields).toEqual([{ key: 'amount', label: '金额', type: 'number' }]);
  });

  it('未注册的 code 返回 null 而不是抛异常（交由套壳兜底）', () => {
    registerForms([entry('PUR_FORM')]);

    expect(resolveForm('NOT_REGISTERED')).toBeNull();
  });

  it('null / undefined / 空串一律返回 null（后端form_data 可能缺startedFormCode）', () => {
    expect(resolveForm(null)).toBeNull();
    expect(resolveForm(undefined)).toBeNull();
    expect(resolveForm('')).toBeNull();
  });

  it('一次注册多条，顺序不影响查询结果', () => {
    registerForms([entry('A_FORM'), entry('B_FORM')]);

    expect(resolveForm('A_FORM')?.formCode).toBe('A_FORM');
    expect(resolveForm('B_FORM')?.formCode).toBe('B_FORM');
  });
});

describe('重复注册', () => {
  it('同一 code 注册两次抛错（不静默覆盖）', () => {
    registerForms([entry('PUR_FORM')]);

    expect(() => registerForms([entry('PUR_FORM')])).toThrow(/PUR_FORM/);
    expect(() => registerForms([entry('PUR_FORM')])).toThrow(/重复注册/);
  });

  it('同一批次内重复也抛错', () => {
    expect(() => registerForms([entry('X'), entry('X')])).toThrow(/重复注册/);
  });

  it('⚠️ 批量注册中途失败时不留下半批状态（先校验后写入）', () => {
    registerForms([entry('EXISTING')]);

    expect(() => registerForms([entry('NEW_ONE'), entry('EXISTING')])).toThrow();

    expect(resolveForm('NEW_ONE')).toBeNull();
    expect(resolveForm('EXISTING')?.formCode).toBe('EXISTING');
  });

  it('抛错时监听器不被通知（注册表未变化）', () => {
    registerForms([entry('PUR_FORM')]);
    const spy = vi.fn();
    subscribeRegistry(spy);

    expect(() => registerForms([entry('PUR_FORM')])).toThrow();
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('isFormRegistered', () => {
  it('已注册返回 true，未注册 / 空值返回 false', () => {
    registerForms([entry('PUR_FORM')]);

    expect(isFormRegistered('PUR_FORM')).toBe(true);
    expect(isFormRegistered('NOPE')).toBe(false);
    expect(isFormRegistered(null)).toBe(false);
    expect(isFormRegistered(undefined)).toBe(false);
    expect(isFormRegistered('')).toBe(false);
  });
});

describe('listRegisteredCodes', () => {
  it('按字典序升序返回，而不是注册顺序', () => {
    registerForms([entry('ZEBRA'), entry('ALPHA'), entry('MIKE')]);

    expect(listRegisteredCodes()).toEqual(['ALPHA', 'MIKE', 'ZEBRA']);
  });

  it('空注册表返回空数组', () => {
    expect(listRegisteredCodes()).toEqual([]);
  });

  it('取消注册后不再出现', () => {
    registerForms([entry('ALPHA'), entry('MIKE')]);

    unregisterForms(['MIKE']);

    expect(listRegisteredCodes()).toEqual(['ALPHA']);
  });

  it('unregister 未注册的 code 静默忽略（清理动作不是注册动作）', () => {
    registerForms([entry('ALPHA')]);

    expect(() => unregisterForms(['NEVER_REGISTERED'])).not.toThrow();
    expect(listRegisteredCodes()).toEqual(['ALPHA']);
  });
});

describe('subscribeRegistry', () => {
  it('注册后订阅者被通知', () => {
    const spy = vi.fn();
    subscribeRegistry(spy);

    registerForms([entry('PUR_FORM')]);

    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('取消注册（真的有变化时）通知订阅者', () => {
    registerForms([entry('PUR_FORM')]);
    const spy = vi.fn();
    subscribeRegistry(spy);

    unregisterForms(['PUR_FORM']);

    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('注册空数组不通知（无变化）', () => {
    const spy = vi.fn();
    subscribeRegistry(spy);

    registerForms([]);

    expect(spy).not.toHaveBeenCalled();
  });

  it('退订后不再收到通知', () => {
    const spy = vi.fn();
    const unsubscribe = subscribeRegistry(spy);
    unsubscribe();

    registerForms([entry('PUR_FORM')]);

    expect(spy).not.toHaveBeenCalled();
  });

  it('回调内退订自己不会导致遍历异常', () => {
    const seen: string[] = [];
    const unsubscribeA = subscribeRegistry(() => {
      seen.push('a');
      unsubscribeA();
    });
    const spyB = vi.fn();
    subscribeRegistry(spyB);

    expect(() => registerForms([entry('PUR_FORM')])).not.toThrow();
    expect(seen).toEqual(['a']);
    // 关键：遍历的是快照，B 仍被调用（直接遍历 Set 会因 A 的删除而跳过 B）
    expect(spyB).toHaveBeenCalledTimes(1);
  });
});

describe('类型契约', () => {
  it('FormComponent 接受一个吃 FormProps 的函数组件', () => {
    const props: FormProps = {
      formCode: 'PUR_FORM',
      value: { amount: 100, urgent: true },
      readOnly: false,
      fields: [{ key: 'amount', label: '金额' }],
    };
    // 只验证类型能编译 + createElement 能吃下（node 环境无 DOM，不能真渲染）
    const el = createElement(Comp as FormComponent, props);
    expect(el.type).toBe(Comp);
  });
});
