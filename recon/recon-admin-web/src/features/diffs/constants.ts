import type { DiffStatus, DiffType, HandleStatus } from '@/types/api';

/** 差异状态徽章映射（status） */
export const STATUS_BADGE: Record<DiffStatus, { label: string; variant: 'warning' | 'destructive' | 'success' | 'secondary' }> = {
  pending: { label: '待确认', variant: 'warning' },
  confirmed: { label: '已确认', variant: 'destructive' },
  resolved: { label: '已解决', variant: 'success' },
  deferred: { label: '已延期', variant: 'secondary' },
};

/** 差异类型中文标签 */
export const DIFF_TYPE_LABEL: Record<DiffType, string> = {
  field_mismatch: '字段不符',
  unmatched_left: '仅左端有',
  unmatched_right: '仅右端有',
  anomaly: '异常',
  custom_check: '整检查自定义',
};

/** 差异类型徽章映射 */
export const TYPE_BADGE: Record<DiffType, { label: string; variant: 'destructive' | 'warning' | 'default' }> = {
  field_mismatch: { label: DIFF_TYPE_LABEL.field_mismatch, variant: 'warning' },
  unmatched_left: { label: DIFF_TYPE_LABEL.unmatched_left, variant: 'destructive' },
  unmatched_right: { label: DIFF_TYPE_LABEL.unmatched_right, variant: 'destructive' },
  anomaly: { label: DIFF_TYPE_LABEL.anomaly, variant: 'default' },
  custom_check: { label: DIFF_TYPE_LABEL.custom_check, variant: 'default' },
};

/** 人工处理状态徽章映射 */
export const HANDLE_BADGE: Record<HandleStatus, { label: string; variant: 'secondary' | 'success' }> = {
  unhandled: { label: '未处理', variant: 'secondary' },
  handled: { label: '已处理', variant: 'success' },
  ignored: { label: '已忽略', variant: 'secondary' },
  false_positive: { label: '误报', variant: 'secondary' },
};

/** 状态历史 reason 中文说明 */
export const STATUS_REASON_LABEL: Record<string, string> = {
  first_unmatched: '首次入池（待确认）',
  peer_advanced: '对端水位推进',
  timeout: '超时升级',
  reopened: '重新打开',
  matched: '匹配一致（配平出池）',
  field_mismatch: '字段不一致',
  anomaly: '数据异常',
  manual_handle: '人工判定',
  manual_revert: '人工回退',
};
