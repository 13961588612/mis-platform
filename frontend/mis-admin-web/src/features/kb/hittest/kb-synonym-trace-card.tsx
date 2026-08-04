import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronDown, ChevronRight, Copy, Info } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { usePermission } from '@/hooks/use-permission';
import type { KbSynonymExpansion, KbSynonymHit } from '../types';
import { KB_SYNONYM_EXPANSION_STATUS_META, synonymExpansionStatusLabel } from '../types';

/** S-07 词表页路由（跳转一律走路由，绝不 import S-07 组件——会与 keep-alive 形成循环引用）。 */
const SYNONYM_PAGE_PATH = '/kb/synonyms';

/** 复制文本到剪贴板（命中测试为只读回显，复制不记审计）。 */
async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    toast.success('已复制');
  } catch {
    toast.error('复制失败，请手动选择复制');
  }
}

/**
 * 徽标文案。
 *
 * <p>`EXPANDED` 需带出扩展了几组（PRD §5.2「已扩展 N 组」），其余三态直接用
 * 权威口径表；未知状态原样回显，绝不吞成「未扩展」。
 */
function badgeText(expansion: KbSynonymExpansion): string {
  if (expansion.status === 'EXPANDED') {
    const n = expansion.usedGroups ?? expansion.hits?.length ?? 0;
    return n > 0 ? `已扩展 ${n} 组` : '已扩展';
  }
  return synonymExpansionStatusLabel(expansion.status);
}

/** 徽标配色：四态各自独立，`DISABLED_GLOBAL` 与 `DISABLED_REQUEST` 绝不合并。 */
function badgeVariant(expansion: KbSynonymExpansion): 'success' | 'secondary' | 'info' | 'warning' {
  return KB_SYNONYM_EXPANSION_STATUS_META[expansion.status]?.variant ?? 'secondary';
}

/** 在 `expandedQuery` 中高亮命中的规范词，形成「原问句 vs 实际问句」的可视对照。 */
function renderExpandedQuery(expanded: string, canonicalTerms: string[]): ReactNode {
  const escaped = canonicalTerms.filter(Boolean).map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (escaped.length === 0) return expanded;
  const re = new RegExp(`(${escaped.join('|')})`, 'gi');
  const lowerSet = new Set(canonicalTerms.map((c) => c.toLowerCase()));
  return expanded.split(re).map((part, i) =>
    lowerSet.has(part.toLowerCase()) ? (
      <mark key={i} className="rounded bg-success/15 px-0.5 text-success">
        {part}
      </mark>
    ) : (
      <span key={i}>{part}</span>
    ),
  );
}

/** 命中术语组 chip 的展示文案。 */
function hitLabel(hit: KbSynonymHit): string {
  return hit.canonicalTerm ?? hit.matchedTerm ?? `组 ${hit.groupId ?? '-'}`;
}

/**
 * 同义词扩展状态徽标（供命中测试并排对比槽两侧各自使用）。
 *
 * <p>并排对比的价值全在「两侧不一样」：一侧 `EXPANDED`、另一侧 `DISABLED_REQUEST`，
 * 差异必须一眼可见，否则用户看不出勾选那个框到底起没起作用。
 */
export function KbSynonymStatusBadge({ expansion }: { expansion: KbSynonymExpansion | null }) {
  if (!expansion) return null;
  return <Badge variant={badgeVariant(expansion)}>{badgeText(expansion)}</Badge>;
}

/**
 * 同义词扩展轨迹卡片（T13 / PRD §5）。
 *
 * <p>命中测试是链路里**唯一**被允许回显扩展结果的出口。四态徽标必须全部显式展示：
 * - `EXPANDED`         绿：已扩展 N 组，轨迹可展开
 * - `NO_MATCH`         灰：未命中任何术语组 —— **必须显式渲染，一片空白会被理解成功能坏了**
 * - `DISABLED_REQUEST` 蓝：本次测试临时关闭 —— 取消勾选即可恢复
 * - `DISABLED_GLOBAL`  黄：全局开关已关 —— 要去 S-07 改总开关
 *
 * <p>⛔ 后两者绝不可合并成一个 disabled：管理员的后续动作完全不同。
 *
 * <p>⛔ 无 `kb:config:synonym:view` 权限时，命中组 chip 降级为**纯文本而非隐藏**：
 * 管理员仍需知道命中了哪些组，只是点不进去（点进去也是 403）。
 *
 * <p>⛔ 静默回退是禁止的：被预算截断、被短词过滤的部分都要明说，数字一律取自
 * `expansion.budget`，不写死。
 */
export function KbSynonymTraceCard({ expansion }: { expansion: KbSynonymExpansion }) {
  const navigate = useNavigate();
  const { hasPermission } = usePermission();
  const canViewSynonyms = hasPermission('kb:config:synonym:view') === true;
  const [traceOpen, setTraceOpen] = useState(true);

  const hits = expansion.hits ?? [];
  const canonicalTerms = hits.map((h) => h.canonicalTerm ?? '').filter(Boolean);
  const original = expansion.originalQuestion ?? '';
  const expanded = expansion.expandedQuery ?? original;
  const dropped = expansion.droppedGroups ?? [];
  const shortTerms = expansion.skippedShortTerms ?? [];
  const budget = expansion.budget ?? null;
  // 能力位一律 `=== true`：字段缺失时不展示，安全侧。
  const showEngineNativeHint = expansion.engineNativeHint === true;
  const showTruncation = expansion.truncated === true || dropped.length > 0;
  const hasDetail = hits.length > 0 || showTruncation || shortTerms.length > 0;

  const jump = (groupId: number): void => {
    navigate(`${SYNONYM_PAGE_PATH}?groupId=${groupId}`);
  };

  return (
    <div className="space-y-3 rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-medium">同义词扩展轨迹</h3>
        <Badge variant={badgeVariant(expansion)}>{badgeText(expansion)}</Badge>
        {typeof expansion.totalMatchedGroups === 'number' ? (
          <span className="text-xs text-muted-foreground tabular-nums">
            共命中 {expansion.totalMatchedGroups} 组 · 实际使用 {expansion.usedGroups ?? 0} 组
          </span>
        ) : null}
        {expansion.truncated === true ? <Badge variant="warning">已按预算截断</Badge> : null}
        {hasDetail ? (
          <button
            type="button"
            className="ml-auto inline-flex items-center gap-0.5 text-xs text-primary hover:underline"
            onClick={() => setTraceOpen((v) => !v)}
          >
            {traceOpen ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" />
            )}
            {traceOpen ? '收起轨迹' : '展开轨迹'}
          </button>
        ) : null}
      </div>

      {/* 四态各自的处置指引：DISABLED_GLOBAL 与 DISABLED_REQUEST 的后续动作完全不同 */}
      {expansion.status === 'NO_MATCH' ? (
        <p className="rounded-md bg-secondary/40 px-2.5 py-2 text-xs text-muted-foreground">
          本次问句未命中任何术语组，检索问句与原问句一致。
          若你预期它应当被扩展，请检查该词是否已收录在词表中。
        </p>
      ) : null}
      {expansion.status === 'DISABLED_REQUEST' ? (
        <p className="rounded-md bg-info/10 px-2.5 py-2 text-xs text-info">
          本次测试临时关闭了同义词扩展（全局开关未受影响）。
          取消上方「本次不使用同义词扩展」勾选并重新执行，即可看到扩展后的结果。
        </p>
      ) : null}
      {expansion.status === 'DISABLED_GLOBAL' ? (
        <p className="rounded-md bg-warning/10 px-2.5 py-2 text-xs text-warning">
          同义词扩展已全局关闭，本次检索未做任何扩展。
          {canViewSynonyms ? (
            <button
              type="button"
              className="ml-1 underline"
              onClick={() => navigate(SYNONYM_PAGE_PATH)}
            >
              前往「同义词」页开启总开关
            </button>
          ) : (
            <span className="ml-1">如需开启，请联系具备同义词配置权限的管理员。</span>
          )}
        </p>
      ) : null}

      {/* 原问句 vs 实际检索问句（上下对照 + 一键复制） */}
      <div className="space-y-2">
        <div>
          <div className="mb-1 flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">原始问题</span>
            <button
              type="button"
              className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
              onClick={() => void copyText(original)}
            >
              <Copy className="h-3 w-3" />
              复制
            </button>
          </div>
          <p className="rounded-md border bg-muted/30 px-2 py-1.5 text-sm">{original || '-'}</p>
        </div>
        <div>
          <div className="mb-1 flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">实际检索问句</span>
            <button
              type="button"
              className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
              onClick={() => void copyText(expanded)}
            >
              <Copy className="h-3 w-3" />
              复制
            </button>
          </div>
          <p className="rounded-md border bg-muted/30 px-2 py-1.5 text-sm">
            {expanded ? renderExpandedQuery(expanded, canonicalTerms) : '-'}
          </p>
        </div>
      </div>

      {hasDetail && traceOpen ? (
        <div className="space-y-2 border-t pt-3">
          {/* 命中术语组：有权限可跳转，无权限降级为纯文本（不是隐藏） */}
          {hits.length > 0 ? (
            <div>
              <p className="mb-1 text-xs font-medium text-muted-foreground">
                命中术语组{canViewSynonyms ? '（点击查看）' : '（无查看权限，仅展示）'}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {hits.map((h, i) => {
                  const label = hitLabel(h);
                  const added =
                    typeof h.addedTermCount === 'number' && h.addedTermCount > 0
                      ? `+${h.addedTermCount}`
                      : null;
                  if (!canViewSynonyms || h.groupId == null) {
                    return (
                      <span
                        key={h.groupId ?? `${label}-${i}`}
                        className="rounded-full border border-border bg-secondary px-2 py-0.5 text-xs"
                      >
                        {label}
                        {added ? <span className="ml-1 text-muted-foreground">{added}</span> : null}
                      </span>
                    );
                  }
                  return (
                    <button
                      key={h.groupId}
                      type="button"
                      className="rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-xs text-primary hover:bg-primary/20"
                      title={`查看术语组 #${h.groupId}`}
                      onClick={() => jump(h.groupId as number)}
                    >
                      {label}
                      {added ? <span className="ml-1 text-muted-foreground">{added}</span> : null}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}

          {/* 截断必须明说：静默回退会让管理员误以为词表没生效 */}
          {showTruncation ? (
            <p className="text-xs text-warning">
              共命中 {expansion.totalMatchedGroups ?? hits.length} 组，实际使用前{' '}
              {expansion.usedGroups ?? hits.length} 组
              {budget?.maxGroups != null ? `（单次扩展上限 ${budget.maxGroups} 组）` : ''}
              {budget?.maxQueryChars != null
                ? `，扩展后问句上限 ${budget.maxQueryChars} 字`
                : ''}
              。
              {dropped.length > 0 ? `未参与：${dropped.join('、')}` : '未参与的组由服务端按预算裁定。'}
            </p>
          ) : null}

          {/* 短词过滤同样不能静默 */}
          {shortTerms.length > 0 ? (
            <p className="text-xs text-muted-foreground">
              以下 {shortTerms.length} 个词过短未参与扩展
              {budget?.minTermLength != null ? `（参与扩展的最短词长 ${budget.minTermLength} 字）` : ''}
              ：{shortTerms.join('、')}
            </p>
          ) : null}
        </div>
      ) : null}

      {showEngineNativeHint ? (
        <p className="flex items-start gap-1 border-t pt-2 text-xs text-muted-foreground">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          检索引擎自身也配置了原生同义词词表，最终召回可能同时受其影响；
          平台词表与引擎词表的差异请以引擎侧配置为准。
        </p>
      ) : null}
    </div>
  );
}
