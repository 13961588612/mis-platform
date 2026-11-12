/**
 * 表单注册表（方案 Q2 §2.3）。
 *
 * **纯Map + 纯函数，不 import 任何 React 组件** ⇒ 可在 node 环境单测，
 * 也可被后端一致性巡检逻辑安全引用。
 *
 * 与业务实现的分离：`forms/` 下的具体表单组件由 barrel 显式收集后调`registerForms`，
 * **不做模块副作用自注册**（无副作用、可 tree-shake、可测）。
 */
import type { FormRegistryEntry } from './types';

const entries = new Map<string, FormRegistryEntry>();
const listeners = new Set<() => void>();

function notify(): void {
  // 复制一份再遍历：回调里可能增删监听器，直接遍历 Set 会跳过元素。
  for (const fn of Array.from(listeners)) fn();
}

/**
 * 注册一批表单。
 *
 * ⚠️ 重复 `formCode` **抛错**而非静默覆盖：静默覆盖会让「两个模块都注册了 PUR_FORM」
 * 这种 bug 变成随机行为（取决于 import 顺序），开发期立即炸出来才是对的。
 *
 * ⚠️ **先校验全部再写入**：批量注册中途失败时不会留下半批已注册状态。
 */
export function registerForms(list: readonly FormRegistryEntry[]): void {
  const seen = new Set<string>();
  for (const entry of list) {
    if (seen.has(entry.formCode) || entries.has(entry.formCode)) {
      throw new Error(`表单 ${entry.formCode} 重复注册`);
    }
    seen.add(entry.formCode);
  }
  for (const entry of list) {
    entries.set(entry.formCode, entry);
  }
  if (list.length > 0) notify();
}

/**
 * 取消注册（测试与「表单下线」用）。
 *
 * ⚠️ 与 `registerForms` 不同，**静默忽略未注册的 code**——它是清理动作，不是注册动作。
 */
export function unregisterForms(formCodes: readonly string[]): void {
  let changed = false;
  for (const code of formCodes) {
    changed = entries.delete(code) || changed;
  }
  if (changed) notify();
}

/** 重置注册表（仅供测试）。 */
export function __resetRegistryForTest(): void {
  if (entries.size > 0 || listeners.size > 0) {
    entries.clear();
    listeners.clear();
  }
}

/** 按 code 取条目；未注册返回 **null**（不抛异常，交由套壳兜底）。 */
export function resolveForm(formCode: string | null | undefined): FormRegistryEntry | null {
  if (!formCode) return null;
  return entries.get(formCode) ?? null;
}

/** 是否已注册。 */
export function isFormRegistered(formCode: string | null | undefined): boolean {
  return !!formCode && entries.has(formCode);
}

/**
 * 全部已注册 code，**按字典序升序**。
 *
 * 排序是硬要求：管理页与一致性巡检要展示稳定列表，
 * 而 Map 的插入序会随用户发起的流程顺序变化，导致每次渲染顺序不同。
 */
export function listRegisteredCodes(): string[] {
  return Array.from(entries.keys()).sort((a, b) => a.localeCompare(b, 'en'));
}

/** 订阅注册表变化，返回取消订阅函数。 */
export function subscribeRegistry(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
