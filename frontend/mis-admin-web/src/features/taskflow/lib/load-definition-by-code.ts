import { fetchDefinition, fetchDefinitions, type WfDefinition } from '@/lib/api/workflow';

const TENANT = '1';

/** 按 definitionCode 解析定义详情（含 nodes / assigneeRule）。 */
export async function loadDefinitionByCode(code: string): Promise<WfDefinition> {
  const page = await fetchDefinitions(TENANT, 1, 50, null, code);
  const hit =
    page.list.find((d) => d.code === code && d.status === 'ACTIVE') ??
    page.list.find((d) => d.code === code) ??
    null;
  if (!hit) throw new Error(`未找到流程定义：${code}`);
  return fetchDefinition(hit.id, TENANT);
}
