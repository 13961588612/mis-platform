/**
 * Quartz cron 校验（6/7 段，与后端 SchedulerManager/ConfigValidationService 同口径）。
 * 返回错误提示；通过返回 null。label 用于错误文案前缀（如「拉取 cron」「对账 cron」）。
 */
export function checkCron(expr: string, label = 'cron'): string | null {
  const s = expr.trim();
  if (!s) return null;
  // 中文输入法全角符号（如 ？）是 Quartz 报 Unexpected character 的主因，先拦截
  if (/[^\x00-\x7F]/.test(s)) {
    return `${label} 含非半角字符（如 ？），请改用半角 ?`;
  }
  const parts = s.split(/\s+/);
  if (parts.length < 6 || parts.length > 7) {
    return `${label} 须为 6 或 7 段：秒 分 时 日 月 周 [年]`;
  }
  const MONTHS = new Map<string, number>([
    ['JAN', 1], ['FEB', 2], ['MAR', 3], ['APR', 4], ['MAY', 5], ['JUN', 6],
    ['JUL', 7], ['AUG', 8], ['SEP', 9], ['OCT', 10], ['NOV', 11], ['DEC', 12],
  ]);
  const WEEKS = new Map<string, number>([
    ['SUN', 1], ['MON', 2], ['TUE', 3], ['WED', 4], ['THU', 5], ['FRI', 6], ['SAT', 7],
  ]);
  // [字段名, 最小值, 最大值, 允许特殊字符, 名称表]
  const fields: [string, number, number, string, Map<string, number> | null][] = [
    ['秒', 0, 59, '', null],
    ['分', 0, 59, '', null],
    ['时', 0, 23, '', null],
    ['日', 1, 31, 'LW', null],
    ['月', 1, 12, '', MONTHS],
    ['周', 1, 7, 'L#', WEEKS],
  ];
  for (let i = 0; i < 6; i++) {
    const [name, min, max, specials, names] = fields[i];
    if (!cronFieldOk(parts[i], min, max, specials, names)) {
      return `${label} ${name}段非法：${parts[i]}`;
    }
  }
  if (parts.length === 7 && !cronFieldOk(parts[6], 1970, 2199, '', null)) {
    return `${label} 年段非法：${parts[6]}`;
  }
  // Quartz 规则：日与周不能同时指定非 ?
  if (parts[3] !== '?' && parts[5] !== '?') {
    return `${label}「日」与「周」必须至少一个为 ?（如 0 15 10 * * ?）`;
  }
  return null;
}

function cronFieldOk(
  field: string,
  min: number,
  max: number,
  specials: string,
  names: Map<string, number> | null,
): boolean {
  const f = field.trim().toUpperCase();
  if (f === '*') return true;
  if (f === '?') return specials === 'LW' || specials === 'L#'; // 仅日/周允许 ?
  for (const item of f.split(',')) {
    if (!cronItemOk(item.trim(), min, max, specials, names)) return false;
  }
  return true;
}

function cronItemOk(
  item: string,
  min: number,
  max: number,
  specials: string,
  names: Map<string, number> | null,
): boolean {
  if (!item) return false;
  if (item.includes('L') || item.includes('W') || item.includes('#')) {
    if (!specials) return false;
    if (specials === 'LW') {
      return /^L(-\d+)?$/.test(item) || item === 'W' || item === 'LW';
    }
    // 周：L / nL（如 6L=最后周五）/ n#k（如 5#2=第2个周四）
    const last = item.match(/^(\d{1,2}|[A-Z]+)L$/);
    const nth = item.match(/^(\d{1,2}|[A-Z]+)#(\d{1,2})$/);
    if (last) return inRange(last[1], min, max, names);
    if (nth) return inRange(nth[1], min, max, names) && Number(nth[2]) >= 1 && Number(nth[2]) <= 5;
    return item === 'L';
  }
  const step = item.match(/^(.*)\/(\d+)$/);
  if (step) {
    if (Number(step[2]) < 1) return false;
    const base = step[1];
    if (base === '*') return true;
    if (base.includes('-')) {
      const [lo, hi] = base.split('-');
      const loV = valueOf(lo, names);
      const hiV = valueOf(hi, names);
      return loV !== null && hiV !== null && inRange(lo, min, max, names) && inRange(hi, min, max, names) && loV <= hiV;
    }
    return inRange(base, min, max, names);
  }
  if (item.includes('-')) {
    const [lo, hi] = item.split('-');
    const loV = valueOf(lo, names);
    const hiV = valueOf(hi, names);
    return loV !== null && hiV !== null && inRange(lo, min, max, names) && inRange(hi, min, max, names) && loV <= hiV;
  }
  return inRange(item, min, max, names);
}

function inRange(tok: string, min: number, max: number, names: Map<string, number> | null): boolean {
  const v = valueOf(tok, names);
  return v !== null && v >= min && v <= max;
}

function valueOf(tok: string, names: Map<string, number> | null): number | null {
  if (/^\d+$/.test(tok)) return Number(tok);
  if (names && names.has(tok)) return names.get(tok)!;
  return null;
}
