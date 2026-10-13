/**
 * 门户「发起人（公司）」展示文案。
 *
 * @returns `张三（华东分公司）` / `张三` / `null`（无发起人时由调用方回退）
 */
export function formatInitiatorCompany(
  name: string | null | undefined,
  orgName?: string | null,
): string | null {
  const n = name?.trim();
  if (!n) return null;
  const org = orgName?.trim();
  return org ? `${n}（${org}）` : n;
}
