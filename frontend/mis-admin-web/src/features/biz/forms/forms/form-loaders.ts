/**
 * 表单实现的**按需加载表**（方案 §2.3「运行时动态 import」）。
 *
 * ## 为什么不建 `forms/index.ts` barrel
 *
 * 方案 §2.3 原文确实是「barrel + 运行时动态 import」，但落地时**不能**写成
 * `import { PurForm } from './pur-form'` 的静态 barrel ——
 * 那会把所有表单实现（及其依赖的控件）打进主 chunk，
 * 「注册了但没人用」的表单也照样付出下载成本。
 *
 * 所以这里存的是**加载函数**而不是组件：
 * `import()` 由 Vite 分析成独立 chunk，只在真正要渲染该表单时才下载。
 *
 * ## 谁来触发加载
 *
 * `form-shell.tsx` 在挂载时调`loadFormEntry`。
 * ⚠️ 这一步是**必须的**，不是优化：审批页首次渲染时注册表还是空的，
 * 若同步直出`not-registered`，运维会看到一个**假的**「前端未注册」黄色告警卡
 * —— 而实际上代码就在前端，只是chunk 还没下载完。
 * 那是发版信号，被误报一次就没人再信它了。
 *
 * 纯函数 + 纯Map，不 import 任何组件 ⇒ 可在 node 环境单测。
 */
import { registerForms, resolveForm } from '../registry';
import type { FormRegistryEntry } from '../types';

/** formCode → 动态 import 出该表单的注册条目。 */
type FormEntryLoader = () => Promise<FormRegistryEntry[]>;

const loaders: Record<string, FormEntryLoader> = {
  // ⚠️ 必须存在：`V123__taskflow_menu_api_seed.sql:145` 种了演示定义
  // `PURCHASE_APPROVAL_DEMO`，白名单是 `ARRAY['PUR_FORM']`。
  // 没有这一行 ⇒ 那条既有演示流程的审批页直接走 not-registered。
  PUR_FORM: async () => [(await import('./pur-form')).purFormEntry],
};

/** 进行中的加载，用于并发去重（同一 code 被两个套壳同时挂载只import 一次）。 */
const inflight = new Map<string, Promise<boolean>>();

/**
 * 该formCode 是否有前端实现（**只看加载表，不看注册表**）。
 *
 * ⚠️ 与 `isFormRegistered()` 的区别：那个问「现在注册好了吗」，
 * 这个问「有没有这个表单的代码」。套壳据此区分
 * 「正在下载」与「压根没实现（该显示 not-registered）」。
 */
export function hasFormLoader(formCode: string | null | undefined): boolean {
  return !!formCode && Object.prototype.hasOwnProperty.call(loaders, formCode);
}

/** 全部有前端实现的 formCode（字典序）。 */
export function listFormLoaderCodes(): string[] {
  return Object.keys(loaders).sort((a, b) => a.localeCompare(b, 'en'));
}

/**
 * 覆盖加载表（**仅供测试**）。
 *
 * 与 `registry.__resetRegistryForTest` 同一个理由：加载表是模块级常量，
 * 不给测试一个注入口就只能依赖真实的表单实现，套壳的「加载中」分支将无法覆盖。
 */
export function __setFormLoadersForTest(next: Record<string, FormEntryLoader>): void {
  for (const key of Object.keys(loaders)) delete loaders[key];
  Object.assign(loaders, next);
  inflight.clear();
}

/**
 * 确保 formCode 已注册进注册表，返回是否可用。
 *
 * ⚠️ **幂等**：已注册时直接返回，不重复 import（`registerForms` 对重复 code 抛错）。
 * ⚠️ **失败不抛**：chunk 下载失败（网络/发版不完整）时返回 false，
 * 由调用方显示 `not-registered` 兜底卡——让审批页还能用比抛异常更重要。
 */
export function loadFormEntry(formCode: string): Promise<boolean> {
  if (resolveForm(formCode)) return Promise.resolve(true);

  const cached = inflight.get(formCode);
  if (cached) return cached;

  const loader = loaders[formCode];
  // 没有加载器 = 前端确实没实现，不是「还没加载完」。交回调用方显示兜底卡。
  if (!loader) return Promise.resolve(false);

  const task = loader()
    .then((list) => {
      registerForms(list);
      return true;
    })
    .catch(() => false)
    .finally(() => {
      inflight.delete(formCode);
    });

  inflight.set(formCode, task);
  return task;
}
