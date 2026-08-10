import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { SHEET_FORM_BODY, SHEET_FORM_FIELD, SHEET_FORM_LABEL } from '@/components/common/sheet-form-styles';
import {
  createSynonymGroup,
  getSynonymGroup,
  KbSynonymTermConflictError,
  updateSynonymGroup,
} from '../api/kb-api';
import type { KbSynonymBudget, KbSynonymGroup } from '../types';
import { normalizeSynonymTerm } from '../types';

const fieldLabel = SHEET_FORM_LABEL;
const selectClass =
  'h-9 w-full rounded-md border border-input bg-card px-[0.7rem] text-sm text-foreground shadow-none';

/** 别名分隔符：逗号（中/英）、顿号、换行、空白。粘贴多行文本亦按行拆词。 */
const ALIAS_SPLIT_RE = /[\n,，、\s]+/;

interface AliasItem {
  /** 归一值（trim → NFKC → toLowerCase），用于去重与冲突比对。 */
  key: string;
  /** 用户原始录入（保留大小写 / 全半角，仅 trim 两端）。 */
  raw: string;
}

interface Props {
  open: boolean;
  /** 编辑模式传组 ID；新增传 null。 */
  groupId: number | null;
  /** 预算（来自全局配置，数字一律从后端取，不许写死）。 */
  budget: KbSynonymBudget | null;
  onClose: () => void;
  onSaved: () => void;
  /** 冲突时「查看该组」跳转（由页面实现为切换抽屉目标组）。 */
  onViewGroup: (groupId: number) => void;
}

/** 把原始串按分隔符拆成词元（不去重，去重由调用方保序完成）。 */
function splitAliases(raw: string): string[] {
  return raw
    .split(ALIAS_SPLIT_RE)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * 构造「指名道姓」的冲突提示（PRD §4.3 / AC-11）。
 *
 * <p>⚠️ 归一化包含 NFKC 全半角折叠，因此完全可能出现「我输入半角 `OKR`，
 * 系统说和 `ＯＫＲ` 冲突」这种**看起来根本不是同一个词**的情形。只说「词条冲突」
 * 会让管理员判定系统坏了，所以两种原始写法必须同时列出，并把折叠规则说破。
 *
 * @param mineRaw 用户在本次表单里录入的原始写法（可能为空，如后端报了一个界面上找不到的词）
 */
function conflictMessage(conflict: KbSynonymTermConflictError, mineRaw: string): string {
  const theirs = conflict.term ?? '';
  const owner = conflict.ownerCanonicalTerm ?? `#${conflict.ownerGroupId ?? '-'}`;
  const mine = mineRaw || theirs;
  if (mine && theirs && mine !== theirs) {
    return `「${mine}」与术语组「${owner}」中的「${theirs}」冲突 —— 系统将全角/半角视为同一个词。`;
  }
  return `「${mine || theirs}」已属于术语组「${owner}」，一个词条只能归属一个组。`;
}

/**
 * 术语组新增 / 编辑抽屉（S-07 / PRD §4.3）。
 *
 * <p>别名以**有序**数组维护，顺序即预算截断优先级（WD-25 P0）：靠前的别名在
 * 扩展预算不足时优先入选。因此去重必须保序（`Set` 判重 + 顺序 push），
 * **绝不允许字典序重排**。排序交互用上移 / 下移按钮——仓库无任何 DnD 依赖，
 * 而 WD-25 的拖拽是 P1、顺序语义才是 P0，为此装包不划算。
 *
 * <p>词条冲突（`KbSynonymTermConflictError`，40927）：冲突项标红 + 保存按钮置灰 +
 * 「查看该组」跳转，**且不清除用户已录入内容**。任一字段变更即清冲突态，可直接重试。
 */
export function KbSynonymDrawer({ open, groupId, budget, onClose, onSaved, onViewGroup }: Props) {
  const [canonicalTerm, setCanonicalTerm] = useState('');
  const [remark, setRemark] = useState('');
  const [status, setStatus] = useState<number>(1);
  const [aliases, setAliases] = useState<AliasItem[]>([]);
  const [aliasInput, setAliasInput] = useState('');
  const [conflict, setConflict] = useState<KbSynonymTermConflictError | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  // 预算数字一律取自后端；未下发（null）时不展示相关提示，绝不写死默认值。
  const minTermLength = budget?.minTermLength ?? null;
  const maxTermsPerGroup = budget?.maxTermsPerGroup ?? null;

  // 打开 / 切换组时拉取详情并回填（新增则清空）。
  useEffect(() => {
    if (!open) return;
    setConflict(null);
    if (groupId == null) {
      setCanonicalTerm('');
      setRemark('');
      setStatus(1);
      setAliases([]);
      setAliasInput('');
      return;
    }
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const g: KbSynonymGroup = await getSynonymGroup(groupId);
        if (cancelled) return;
        setCanonicalTerm(g.canonicalTerm);
        setRemark(g.remark ?? '');
        setStatus(g.status === 0 ? 0 : 1);
        // 保序回填：按 sortNo 升序，这就是预算截断时的入选优先级。
        const seeded = (g.terms ?? [])
          .filter((t) => t.canonical !== true)
          .sort((a, b) => (a.sortNo ?? 0) - (b.sortNo ?? 0))
          .map((t) => ({ key: normalizeSynonymTerm(t.term), raw: t.term.trim() }));
        setAliases(seeded);
        setAliasInput('');
      } catch (e) {
        if (!cancelled) toast.error(e instanceof Error ? e.message : '加载术语组失败');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, groupId]);

  /** 追加别名：`Set` 判重但按录入顺序 push —— 去重保序，不做任何重排。 */
  const addAliasFromInput = (): void => {
    const tokens = splitAliases(aliasInput);
    if (tokens.length === 0) return;
    setAliases((prev) => {
      const existing = new Set(prev.map((a) => a.key));
      const next = [...prev];
      for (const t of tokens) {
        const key = normalizeSynonymTerm(t);
        if (!key || existing.has(key)) continue;
        existing.add(key);
        next.push({ key, raw: t });
      }
      return next;
    });
    setAliasInput('');
    // 用户改了别名 → 旧的冲突态失效，允许重试保存。
    setConflict(null);
  };

  const removeAlias = (index: number): void => {
    setAliases((prev) => prev.filter((_, i) => i !== index));
    setConflict(null);
  };

  /** 上移 / 下移：WD-25 的顺序语义靠它满足（零新增依赖，不引 DnD 库）。 */
  const moveAlias = (index: number, dir: -1 | 1): void => {
    setAliases((prev) => {
      const target = index + dir;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
    setConflict(null);
  };

  /** 短词判定用**归一化后**的长度：与后端 `SynonymTermNormalizer` 同口径。 */
  const isShort = (key: string): boolean => minTermLength != null && key.length < minTermLength;

  const conflictKey = conflict == null ? null : normalizeSynonymTerm(conflict.term ?? '');
  const canonicalKey = normalizeSynonymTerm(canonicalTerm);
  const canonicalConflicted = conflictKey != null && conflictKey !== '' && conflictKey === canonicalKey;

  /** 冲突词在本次表单里的原始写法（用于 AC-11 的「两种写法并列」提示）。 */
  const mineRaw = useMemo(() => {
    if (conflictKey == null || conflictKey === '') return '';
    if (canonicalKey === conflictKey) return canonicalTerm.trim();
    return aliases.find((a) => a.key === conflictKey)?.raw ?? '';
  }, [aliases, canonicalKey, canonicalTerm, conflictKey]);

  // 组内词条数 = 规范词 1 个 + 别名若干（上限取自后端预算，不写死）。
  const totalTerms = aliases.length + (canonicalTerm.trim() ? 1 : 0);
  const overBudget = maxTermsPerGroup != null && totalTerms > maxTermsPerGroup;

  const canSave = useMemo(
    () => canonicalTerm.trim().length > 0 && aliases.length > 0 && conflict == null && !saving,
    [canonicalTerm, aliases, conflict, saving],
  );

  async function onSave(): Promise<void> {
    if (!canSave) return;
    setSaving(true);
    try {
      const payload = {
        canonicalTerm: canonicalTerm.trim(),
        // 按界面顺序提交，后端据此生成 sortNo —— 顺序即业务语义。
        terms: aliases.map((a) => a.raw),
        remark: remark.trim() || null,
        status,
      };
      if (groupId == null) {
        await createSynonymGroup(payload);
      } else {
        await updateSynonymGroup(groupId, payload);
      }
      toast.success('已保存，可立即在命中测试中验证；问答链路约 3 秒内全平台生效。');
      onSaved();
      onClose();
    } catch (e) {
      if (e instanceof KbSynonymTermConflictError) {
        // 指名道姓：标红 + 置灰 + 可跳转，不丢用户已录入内容。
        setConflict(e);
        const key = normalizeSynonymTerm(e.term ?? '');
        const raw =
          canonicalKey === key ? canonicalTerm.trim() : (aliases.find((a) => a.key === key)?.raw ?? '');
        toast.error(conflictMessage(e, raw));
      } else {
        toast.error(e instanceof Error ? e.message : '保存失败');
      }
    } finally {
      setSaving(false);
    }
  }

  /** 任一关键字段变更都清冲突态（规范词改名可能改变冲突判定）。 */
  const clearConflictOnChange = (): void => {
    if (conflict) setConflict(null);
  };

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent className="flex w-full flex-col sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>{groupId == null ? '新增术语组' : '编辑术语组'}</SheetTitle>
        </SheetHeader>

        {loading ? (
          <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
            加载中…
          </div>
        ) : (
          <div className={SHEET_FORM_BODY}>
            <div className={SHEET_FORM_FIELD}>
              <Label className={fieldLabel}>规范词 *</Label>
              <Input
                value={canonicalTerm}
                className={canonicalConflicted ? 'border-destructive' : undefined}
                onChange={(e) => {
                  setCanonicalTerm(e.target.value);
                  clearConflictOnChange();
                }}
                placeholder="例如：登录失败"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                规范词恒为组内首位词条；问句中出现任一别名时，系统按规范词一并检索。
              </p>
            </div>

            {/* 冲突提示：必须指名道姓，并说破全半角折叠规则（AC-11） */}
            {conflict ? (
              <div className="space-y-1.5 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                <p className="font-medium">{conflictMessage(conflict, mineRaw)}</p>
                <p>
                  一个词条全平台只能归属一个术语组（停用的组同样占位）。请改用其它写法，
                  或到该组内把这个词合并进去。
                </p>
                {conflict.ownerGroupId != null ? (
                  <button
                    type="button"
                    className="underline"
                    onClick={() => onViewGroup(conflict.ownerGroupId as number)}
                  >
                    查看术语组「{conflict.ownerCanonicalTerm ?? conflict.ownerGroupId}」
                  </button>
                ) : null}
              </div>
            ) : null}

            {/* 别名录入区 */}
            <div className={SHEET_FORM_FIELD}>
              <Label className={fieldLabel}>别名（同义词）</Label>
              <div className="flex gap-2">
                <Input
                  value={aliasInput}
                  onChange={(e) => setAliasInput(e.target.value)}
                  placeholder="输入后回车 / 逗号 / 顿号确认，可粘贴多行"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ',' || e.key === '、') {
                      e.preventDefault();
                      addAliasFromInput();
                    }
                  }}
                />
                <Button type="button" size="sm" variant="outline" onClick={addAliasFromInput}>
                  <Plus className="h-4 w-4" />
                  添加
                </Button>
              </div>

              {aliases.length === 0 ? (
                <p className="mt-2 text-xs text-muted-foreground">尚未添加别名，至少需 1 个别名。</p>
              ) : (
                <ul className="mt-2 space-y-1">
                  {aliases.map((item, i) => {
                    const short = isShort(item.key);
                    const conflicted = conflictKey != null && conflictKey === item.key;
                    return (
                      <li
                        key={item.key}
                        className={`flex items-center gap-2 rounded-md border px-2 py-1.5 text-sm ${
                          conflicted
                            ? 'border-destructive bg-destructive/10 text-destructive'
                            : short
                              ? 'border-dashed border-border bg-muted/40 text-muted-foreground'
                              : 'border-border bg-card'
                        }`}
                      >
                        <span className="w-5 shrink-0 text-center text-xs text-muted-foreground tabular-nums">
                          {i + 1}
                        </span>
                        <span className="flex min-w-0 flex-1 items-center gap-1 truncate">
                          {short ? (
                            <AlertTriangle
                              className="h-3.5 w-3.5 shrink-0 text-warning"
                              aria-label="不参与扩展"
                            />
                          ) : null}
                          <span className="truncate">{item.raw}</span>
                          {conflicted ? (
                            <span className="shrink-0 text-xs">· 与已有术语组冲突</span>
                          ) : short && minTermLength != null ? (
                            <span className="shrink-0 text-xs">
                              · 不足 {minTermLength} 字，不参与扩展
                            </span>
                          ) : null}
                        </span>
                        <button
                          type="button"
                          className="rounded p-1 text-muted-foreground hover:bg-accent disabled:opacity-40"
                          disabled={i === 0}
                          onClick={() => moveAlias(i, -1)}
                          title="上移（提升扩展优先级）"
                        >
                          <ArrowUp className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          className="rounded p-1 text-muted-foreground hover:bg-accent disabled:opacity-40"
                          disabled={i === aliases.length - 1}
                          onClick={() => moveAlias(i, 1)}
                          title="下移（降低扩展优先级）"
                        >
                          <ArrowDown className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          className="rounded p-1 text-destructive hover:bg-destructive/10"
                          onClick={() => removeAlias(i)}
                          title="删除"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
              <p className="mt-2 text-xs text-muted-foreground">
                别名顺序即扩展优先级：预算不足被截断时，靠前的别名优先入选，可用上下箭头调整。
              </p>
              {minTermLength != null ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  灰显词条为归一化后不足 {minTermLength} 字者：可以保存并保留在组内，但不参与检索扩展。
                </p>
              ) : null}
              {overBudget ? (
                <p className="mt-1 text-xs text-warning">
                  当前 {totalTerms} 个词条，已超过每组上限 {maxTermsPerGroup} 个；
                  超出部分在扩展时会被预算截断（按上方顺序取前 {maxTermsPerGroup} 个）。
                </p>
              ) : null}
            </div>

            <div className={SHEET_FORM_FIELD}>
              <Label className={fieldLabel}>状态</Label>
              <select
                className={selectClass}
                value={String(status)}
                onChange={(e) => setStatus(Number(e.target.value))}
              >
                <option value="1">启用</option>
                <option value="0">停用</option>
              </select>
              <p className="mt-1 text-xs text-muted-foreground">
                停用组仍占用词条唯一性，不会被其它组抢走；但不再参与扩展。
              </p>
            </div>

            <div className={SHEET_FORM_FIELD}>
              <Label className={fieldLabel}>备注</Label>
              <Textarea
                value={remark}
                onChange={(e) => setRemark(e.target.value)}
                placeholder="可选，记录该组的业务背景"
              />
            </div>

            {budget ? (
              <p className="rounded-md border border-dashed bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                当前预算（由运维在配置中心下发，页面只读）：每组最多{' '}
                {budget.maxTermsPerGroup ?? '-'} 个词条 · 单次扩展最多 {budget.maxGroups ?? '-'} 组 ·
                扩展后问句最长 {budget.maxQueryChars ?? '-'} 字 · 参与扩展的最短词长{' '}
                {budget.minTermLength ?? '-'} 字。
              </p>
            ) : null}
          </div>
        )}

        <SheetFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            取消
          </Button>
          <Button disabled={!canSave} onClick={() => void onSave()}>
            {saving ? '保存中…' : '保存'}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
