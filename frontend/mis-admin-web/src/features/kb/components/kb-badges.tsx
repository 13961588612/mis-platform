import { Badge } from '@/components/ui/badge';
import { parseStatusLabel, secrecyLabel } from '../types';

/** 密级徽标：public/internal 中性，confidential/secret 警示。 */
export function SecrecyBadge({ secrecy }: { secrecy: string | null | undefined }) {
  const variant =
    secrecy === 'secret'
      ? 'destructive'
      : secrecy === 'confidential'
        ? 'warning'
        : secrecy === 'internal'
          ? 'info'
          : 'secondary';
  return <Badge variant={variant}>{secrecyLabel(secrecy)}</Badge>;
}

/** 解析状态徽标。 */
export function ParseStatusBadge({ status }: { status: string | null | undefined }) {
  const variant =
    status === 'success'
      ? 'success'
      : status === 'failed'
        ? 'destructive'
        : status === 'parsing'
          ? 'info'
          : 'secondary';
  return <Badge variant={variant}>{parseStatusLabel(status)}</Badge>;
}

/** 启用状态徽标（enabled: 1 启用 / 0 停用）。 */
export function EnabledBadge({ enabled }: { enabled: number | null | undefined }) {
  return enabled === 1 ? (
    <Badge variant="success">启用</Badge>
  ) : (
    <Badge variant="secondary">停用</Badge>
  );
}

/** 引擎健康徽标。 */
export function EngineHealthBadge({ healthy }: { healthy: boolean | null | undefined }) {
  if (healthy == null) return <Badge variant="secondary">未知</Badge>;
  return healthy ? <Badge variant="success">连通</Badge> : <Badge variant="destructive">异常</Badge>;
}

/** 能力开关徽标（能力不支持时灰化提示）。 */
export function CapabilityBadge({ label, supported }: { label: string; supported: boolean | null | undefined }) {
  return (
    <Badge variant={supported ? 'success' : 'secondary'}>
      {label}
      {supported ? ' 支持' : ' 不支持'}
    </Badge>
  );
}
