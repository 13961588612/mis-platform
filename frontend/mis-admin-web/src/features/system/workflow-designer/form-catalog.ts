/**
 * 表单白名单的「候选项来源 + 序列化」（方案 §4.4 决策 3 + T4.6）。
 *
 * ## 候选项 = 后端 ENABLED ∧ 前端有实现（**取交集，不是并集**）
 *
 * 后端负责「这个 formCode 存在且启用」，前端负责「它长什么样」。
 * 只满足一半的表单**不能**被选中：
 * - 后端有、前端没有 ⇒ 审批页渲染不出组件（走 `not-registered` 兜底卡）
 * - 前端有、后端没启用 ⇒ 保存时被 `WfDefinitionService.validateSupportedForms` 拒
 *
 * ## ⚠️ 为什么用 `hasFormLoader()` 而不是 `isFormRegistered()`
 *
 * 方案 §4.4 原文写的是「前端 `isFormRegistered()` 过滤」，但那在本页是**错的**：
 * `features/biz/forms/forms/form-loaders.ts` 把表单做成**按需动态 import**，
 * 只有 `FormShell` 真正要渲染某个表单时才 `loadFormEntry()` 把它塞进注册表。
 * 编排页从来没渲染过任何表单 ⇒ 注册表恒为空 ⇒ 交集恒为空 ⇒ 下拉永远是空的。
 *
 * 「前端有没有这个表单的代码」的正确判定是加载表的 `hasFormLoader()` /
 * `listFormLoaderCodes()`（只看有没有实现，不看加载没加载）。
 */
import { useEffect, useState } from 'react';
import { fetchEnabledFormDefinitions } from '@/lib/api/form-definition';
import { hasFormLoader, listFormLoaderCodes } from '@/features/biz/forms/forms/form-loaders';

/** 一个可被流程白名单选中的表单。 */
export interface FormOption {
  code: string;
  name: string;
}

export interface FormCatalog {
  /** 可选项（后端 ENABLED ∧ 前端有实现），按 code 字典序。 */
  options: FormOption[];
  /** 首次加载中。 */
  loading: boolean;
  /** 降级说明；`null` = 后端正常。非空时界面上要给出可见提示，不能静默。 */
  notice: string | null;
}

/** `FlowMeta.supportedFormCodes`（逗号串）→ code 数组。 */
export function parseFormCodes(raw: string | null | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** code 数组 → `FlowMeta.supportedFormCodes`（逗号串）。 */
export function serializeFormCodes(codes: readonly string[]): string {
  return codes.join(',');
}

function sortByCode(list: FormOption[]): FormOption[] {
  return [...list].sort((a, b) => a.code.localeCompare(b.code, 'en'));
}

/**
 * 编排页的表单候选清单。
 *
 * ⚠️ **后端不就绪时的降级**（方案 T4.6 要求，不能白屏）：
 * 请求失败（403 未授权 / 500 / 网络断开）或返回空时，
 * 回退到「前端加载表里全部 code」——此时交集条件只剩一半，
 * 但保存时后端仍会校验，且界面会打出 `notice` 提示，不静默。
 */
export function useFormCatalog(tenantId = '1'): FormCatalog {
  const [options, setOptions] = useState<FormOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetchEnabledFormDefinitions(tenantId)
      .then((items) => {
        if (!alive) return;
        const intersected = sortByCode(
          items
            .filter((it) => it.code && hasFormLoader(it.code))
            .map((it) => ({ code: it.code, name: it.name || it.code })),
        );
        if (intersected.length > 0) {
          setOptions(intersected);
          setNotice(null);
          return;
        }
        // 后端通了但没有交集（或一条都没启用）⇒ 退回前端清单并说明原因，
        // 否则管理员看到的是「下拉空的」，无法区分「没配」和「接口坏了」。
        setOptions(sortByCode(listFormLoaderCodes().map((code) => ({ code, name: code }))));
        setNotice(
          items.length === 0
            ? '后端没有已启用的表单定义，已回退到前端已实现清单'
            : '后端已启用表单与前端已实现表单无交集，已回退到前端已实现清单',
        );
      })
      .catch((e: unknown) => {
        if (!alive) return;
        setOptions(sortByCode(listFormLoaderCodes().map((code) => ({ code, name: code }))));
        setNotice(
          `后端表单清单不可用，已回退到前端已实现清单（${e instanceof Error ? e.message : '未知错误'}）`,
        );
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [tenantId]);

  return { options, loading, notice };
}

/**
 * 已选中但**不在候选项里**的 code（未注册 / 已停用 / 后端删了）。
 *
 * ⚠️ 刻意**返回出来而不是过滤掉**：方案 §4.4「已选中但未注册的项标红保留」，
 * 静默丢弃用户既有配置是数据丢失，比报错更糟。
 */
export function missingFormCodes(options: readonly FormOption[], selected: readonly string[]): string[] {
  const known = new Set(options.map((o) => o.code));
  return selected.filter((code) => !known.has(code));
}
