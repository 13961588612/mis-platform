import type { WfDefinition, WfNode } from '@/lib/api/workflow';

/** 从流程定义取默认过期时间：首个带 timeoutHours 的审批/会签节点。 */
export function defaultDueFromDefinition(def: WfDefinition | null | undefined): Date | null {
  if (!def?.nodes?.length) return null;
  const nodes = [...def.nodes].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  for (const n of nodes) {
    if (isTimedApproval(n) && n.timeoutHours != null && n.timeoutHours > 0) {
      return new Date(Date.now() + n.timeoutHours * 3600_000);
    }
  }
  return null;
}

function isTimedApproval(n: WfNode): boolean {
  const t = (n.nodeType || '').toUpperCase();
  return t === 'APPROVAL' || t === 'ROUTING';
}

/** 转为 datetime-local 字符串。 */
export function toDatetimeLocalValue(d: Date | null): string {
  if (!d || Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
