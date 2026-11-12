/**
 * 门户列表 / 表格统一时间展示：`yyyy-MM-dd HH:mm:ss`。
 *
 * <p>接受后端常见 ISO 串（含 `T`、毫秒、`Z`）；兼容 Jackson
 * {@code WRITE_DATES_AS_TIMESTAMPS} 数组形态 {@code [y,m,d,h,mi,s]}；无效或空值返回 `—`。
 */
export function formatDateTimeSec(iso: string | number[] | null | undefined): string {
  if (iso == null || iso === '') return '—';
  if (Array.isArray(iso)) {
    const [y, m, d, h = 0, mi = 0, s = 0] = iso;
    if (y == null || m == null || d == null) return '—';
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${y}-${pad(m)}-${pad(d)} ${pad(h)}:${pad(mi)}:${pad(s)}`;
  }
  if (typeof iso !== 'string') return '—';
  const normalized = iso.replace('T', ' ').replace(/\.\d+/, '').replace(/Z$/, '').trim();
  const withSec = normalized.match(/^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})/);
  if (withSec) return withSec[1];
  const withMin = normalized.match(/^(\d{4}-\d{2}-\d{2} \d{2}:\d{2})/);
  if (withMin) return `${withMin[1]}:00`;
  return normalized || '—';
}
