/**
 * 审批人规则可视化编辑器。
 *
 * <p>类型用下拉；人员 / 角色 / 部门通过「选择 / 修改」按钮打开弹窗点选，不再内联 Popover / MultiSelect。
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ChevronRight, Pencil } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { pageUsers, getUser } from '@/lib/api/users';
import { listOrgs } from '@/lib/api/orgs';
import { fetchDeptTree } from '@/lib/api/depts';
import { listPosts } from '@/lib/api/posts';
import type { DeptNode, OrgItem, PostItem, UserView } from '@/types/api';
import {
  ASSIGNEE_RULE_OPTIONS,
  isLegacyAssigneeRuleType,
  orgPostKey,
  parseAssigneeRule,
  serializeAssigneeRule,
  type AssigneeRuleType,
  type OrgPostValue,
  type ParsedAssigneeRule,
} from './assignee-rule';

export interface AssigneeRuleEditorProps {
  value: string;
  onChange: (json: string) => void;
  /** 节点类型：用于「人员列表」在普通审批下的行为提示。 */
  nodeKind?: 'APPROVAL' | 'ROUTING' | string;
}

function commitRule(rule: ParsedAssigneeRule, onChange: (json: string) => void) {
  onChange(serializeAssigneeRule(rule));
}

export function AssigneeRuleEditor({ value, onChange, nodeKind }: AssigneeRuleEditorProps) {
  const parsed = useMemo(() => parseAssigneeRule(value), [value]);
  const hint = ASSIGNEE_RULE_OPTIONS.find((o) => o.value === parsed.type)?.hint ?? '';
  const legacy = isLegacyAssigneeRuleType(parsed.type);

  function setType(next: AssigneeRuleType) {
    commitRule({ type: next, ids: [], orgPosts: [] }, onChange);
  }

  return (
    <div className="space-y-2">
      <div>
        <Label className="mb-1 block text-[12px] text-muted-foreground">审批人规则</Label>
        <select
          aria-label="审批人规则类型"
          value={parsed.type}
          onChange={(e) => setType(e.target.value as AssigneeRuleType)}
          className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm"
        >
          {legacy ? (
            <option value={parsed.type}>
              {parsed.type === 'FIXED' ? '指定人员（已停用）' : '指定角色（已停用）'}
            </option>
          ) : null}
          {ASSIGNEE_RULE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        {legacy ? (
          <p className="mt-1 text-[11px] text-warning">
            「指定人员 / 指定角色」已停用，请改选「指定人员列表」或其他规则。
          </p>
        ) : null}
        {hint ? <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p> : null}
        {parsed.type === 'USER_LIST' && nodeKind === 'APPROVAL' ? (
          <p className="mt-1 text-[11px] text-warning">
            当前是普通审批节点：列表中任一人通过即推进流程。若要「全部通过」或「任一通过并作废其余」，请改用「会签/路由」节点并设置会签策略。
          </p>
        ) : null}
        {parsed.type === 'USER_LIST' && nodeKind === 'ROUTING' ? (
          <p className="mt-1 text-[11px] text-muted-foreground">
            会签策略在下方「会签策略」中配置：全部通过（会签）/ 任一通过（或签）。
          </p>
        ) : null}
        {parsed.type === 'USER_LIST' && nodeKind === 'CC' ? (
          <p className="mt-1 text-[11px] text-muted-foreground">
            抄送不阻塞流程：到达本节点即分发给列表中的人，并自动进入下一节点。
          </p>
        ) : null}
      </div>

      {parsed.type === 'USER_LIST' ? (
        <UserPickField
          selectedIds={parsed.ids}
          onChangeIds={(ids) => commitRule({ type: 'USER_LIST', ids }, onChange)}
        />
      ) : null}
      {parsed.type === 'DEPT_LEADER' ? (
        <DeptPickField
          selectedId={parsed.ids[0] ?? null}
          onChangeId={(id) => commitRule({ type: 'DEPT_LEADER', ids: id ? [id] : [] }, onChange)}
        />
      ) : null}
      {parsed.type === 'ORG_POST' ? (
        <OrgPostPickField
          value={parsed.orgPosts ?? []}
          onChangeValue={(orgPosts) => commitRule({ type: 'ORG_POST', ids: [], orgPosts }, onChange)}
        />
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 摘要行 + 按钮
// ---------------------------------------------------------------------------

function SummaryRow({
  label,
  summary,
  emptyText,
  buttonText,
  onOpen,
}: {
  label: string;
  summary: string | null;
  emptyText: string;
  buttonText: string;
  onOpen: () => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="block text-[12px] text-muted-foreground">{label}</Label>
      <div className="rounded-md border border-input bg-muted/30 px-2 py-1.5 text-[12px]">
        {summary ? (
          <span className="break-words text-foreground">{summary}</span>
        ) : (
          <span className="text-muted-foreground">{emptyText}</span>
        )}
      </div>
      <Button type="button" size="sm" variant="outline" className="h-8 w-full" onClick={onOpen}>
        <Pencil className="mr-1 h-3.5 w-3.5" />
        {buttonText}
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 人员（弹窗，多选：左搜索添加 / 右已选删除）
// ---------------------------------------------------------------------------

function UserPickField({
  selectedIds,
  onChangeIds,
}: {
  selectedIds: string[];
  onChangeIds: (ids: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [labels, setLabels] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const missing = selectedIds.filter((id) => !labels[id]);
      if (missing.length === 0) return;
      const next = { ...labels };
      await Promise.all(
        missing.map(async (id) => {
          try {
            const u = await getUser(id);
            next[id] = u.realName?.trim() || u.username || id;
          } catch {
            next[id] = id;
          }
        }),
      );
      if (!cancelled) setLabels(next);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIds.join(',')]);

  const summary =
    selectedIds.length === 0
      ? null
      : selectedIds.map((id) => labels[id] ?? id).join('、');

  return (
    <>
      <SummaryRow
        label="审批人列表"
        summary={summary}
        emptyText="尚未选择人员"
        buttonText={selectedIds.length > 0 ? '修改人员' : '选择人员'}
        onOpen={() => setOpen(true)}
      />
      <UserSelectDialog
        open={open}
        initialIds={selectedIds}
        onOpenChange={setOpen}
        onConfirm={(ids, nameMap) => {
          setLabels((prev) => ({ ...prev, ...nameMap }));
          onChangeIds(ids);
          setOpen(false);
        }}
      />
    </>
  );
}

function userDisplayName(u: Pick<UserView, 'realName' | 'username' | 'id'>): string {
  return u.realName?.trim() || u.username || u.id;
}

function UserPersonMeta({
  phone,
  orgName,
  deptName,
  postName,
}: {
  phone?: string | null;
  orgName?: string | null;
  deptName?: string | null;
  postName?: string | null;
}) {
  return (
    <span className="block text-[11px] leading-relaxed text-muted-foreground">
      <span>手机 {phone?.trim() || '—'}</span>
      <span className="mx-1.5 text-border">·</span>
      <span>公司 {orgName?.trim() || '—'}</span>
      <span className="mx-1.5 text-border">·</span>
      <span>部门 {deptName?.trim() || '—'}</span>
      <span className="mx-1.5 text-border">·</span>
      <span>岗位 {postName?.trim() || '—'}</span>
    </span>
  );
}

type UserLiteInfo = {
  id: string;
  name: string;
  phone?: string | null;
  orgName?: string | null;
  deptName?: string | null;
  postName?: string | null;
};

function toUserLite(u: UserView): UserLiteInfo {
  return {
    id: u.id,
    name: userDisplayName(u),
    phone: u.phone,
    orgName: u.orgName,
    deptName: u.deptName,
    postName: u.postName,
  };
}

function UserSelectDialog({
  open,
  initialIds,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  initialIds: string[];
  onOpenChange: (open: boolean) => void;
  onConfirm: (ids: string[], nameMap: Record<string, string>) => void;
}) {
  const [keyword, setKeyword] = useState('');
  const [users, setUsers] = useState<UserView[]>([]);
  const [loading, setLoading] = useState(false);
  const [draft, setDraft] = useState<string[]>([]);
  const [infoMap, setInfoMap] = useState<Record<string, UserLiteInfo>>({});

  function rememberUsers(list: UserView[]) {
    setInfoMap((prev) => {
      const next = { ...prev };
      for (const u of list) next[u.id] = toUserLite(u);
      return next;
    });
  }

  useEffect(() => {
    if (!open) return;
    setKeyword('');
    setDraft([...initialIds]);
    let cancelled = false;
    void (async () => {
      const loaded: UserView[] = [];
      await Promise.all(
        initialIds.map(async (id) => {
          try {
            loaded.push(await getUser(id));
          } catch {
            loaded.push({
              id,
              username: id,
              realName: id,
              employeeNo: null,
              employeeId: null,
              deptId: null,
              deptName: null,
              orgId: null,
              orgName: null,
              email: null,
              phone: null,
              status: 1,
              isTenantAdmin: null,
              roles: [],
              postName: null,
              createdAt: null,
            });
          }
        }),
      );
      if (!cancelled) rememberUsers(loaded);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, initialIds]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    const timer = window.setTimeout(() => {
      void pageUsers({ realName: keyword.trim() || undefined, status: 1, size: 50 })
        .then((res) => {
          if (cancelled) return;
          const list = res.list ?? [];
          setUsers(list);
          rememberUsers(list);
        })
        .catch(() => {
          if (!cancelled) setUsers([]);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [open, keyword]);

  function addUser(u: UserView) {
    rememberUsers([u]);
    setDraft((prev) => (prev.includes(u.id) ? prev : [...prev, u.id]));
  }

  function removeSelected(id: string) {
    setDraft((prev) => prev.filter((x) => x !== id));
  }

  function nameMapFromInfo(): Record<string, string> {
    const m: Record<string, string> = {};
    for (const id of draft) m[id] = infoMap[id]?.name ?? id;
    return m;
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>选择人员（可多选）</DialogTitle>
          <DialogDescription>
            左侧搜索后点「添加」加入右侧；右侧可点「删除」移除，两侧均展示手机 / 公司 / 部门 / 岗位。
          </DialogDescription>
        </DialogHeader>

        <div className="grid h-[28rem] grid-cols-2 gap-3">
          <div className="flex min-h-0 flex-col gap-2">
            <Label className="text-[12px] text-muted-foreground">搜索人员</Label>
            <Input
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="搜索姓名"
              aria-label="搜索人员"
            />
            <div className="min-h-0 flex-1 space-y-1 overflow-auto rounded-md border p-1">
              {loading ? (
                <p className="py-4 text-center text-sm text-muted-foreground">加载中…</p>
              ) : users.length === 0 ? (
                <p className="py-4 text-center text-sm text-muted-foreground">无匹配用户</p>
              ) : (
                users.map((u) => {
                  const added = draft.includes(u.id);
                  return (
                    <div
                      key={u.id}
                      data-testid="user-option"
                      className="flex items-start gap-2 rounded border border-transparent px-2 py-1.5 text-sm hover:bg-accent"
                    >
                      <div className="min-w-0 flex-1 space-y-0.5">
                        <div className="truncate font-medium">{userDisplayName(u)}</div>
                        <UserPersonMeta
                          phone={u.phone}
                          orgName={u.orgName}
                          deptName={u.deptName}
                          postName={u.postName}
                        />
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        variant={added ? 'secondary' : 'outline'}
                        className="h-7 shrink-0 px-2 text-xs"
                        disabled={added}
                        aria-label={added ? `已添加 ${userDisplayName(u)}` : `添加 ${userDisplayName(u)}`}
                        onClick={() => addUser(u)}
                      >
                        {added ? '已添加' : '添加'}
                      </Button>
                    </div>
                  );
                })
              )}
            </div>
          </div>
          <div className="flex min-h-0 flex-col gap-2">
            <Label className="text-[12px] text-muted-foreground">
              已选人员{draft.length > 0 ? `（${draft.length}）` : ''}
            </Label>
            <div className="min-h-0 flex-1 space-y-1 overflow-auto rounded-md border p-1">
              {draft.length === 0 ? (
                <p className="py-4 text-center text-sm text-muted-foreground">尚未选择</p>
              ) : (
                draft.map((id) => {
                  const info = infoMap[id];
                  return (
                    <div
                      key={id}
                      data-testid="user-selected"
                      className="flex items-start gap-2 rounded border border-transparent px-2 py-1.5 text-sm hover:bg-accent"
                    >
                      <div className="min-w-0 flex-1 space-y-0.5">
                        <div className="truncate font-medium">{info?.name ?? id}</div>
                        <UserPersonMeta
                          phone={info?.phone}
                          orgName={info?.orgName}
                          deptName={info?.deptName}
                          postName={info?.postName}
                        />
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-7 shrink-0 px-2 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive"
                        aria-label={`删除 ${info?.name ?? id}`}
                        onClick={() => removeSelected(id)}
                      >
                        删除
                      </Button>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button type="button" size="sm" variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={draft.length === 0}
            onClick={() => onConfirm(draft, nameMapFromInfo())}
          >
            确定
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// 部门树（可展开 / 收起）
// ---------------------------------------------------------------------------

function collectDeptIds(nodes: DeptNode[]): string[] {
  const ids: string[] = [];
  const walk = (list: DeptNode[]) => {
    for (const n of list) {
      ids.push(String(n.id));
      if (n.children?.length) walk(n.children);
    }
  };
  walk(nodes);
  return ids;
}

function collectExpandableDeptIds(nodes: DeptNode[]): string[] {
  const ids: string[] = [];
  const walk = (list: DeptNode[]) => {
    for (const n of list) {
      if (n.children?.length) {
        ids.push(String(n.id));
        walk(n.children);
      }
    }
  };
  walk(nodes);
  return ids;
}

function findDeptName(nodes: DeptNode[], id: string): string | undefined {
  for (const n of nodes) {
    if (String(n.id) === id) return n.name;
    if (n.children?.length) {
      const found = findDeptName(n.children, id);
      if (found) return found;
    }
  }
  return undefined;
}

function DeptTreeList({
  nodes,
  selectedId,
  onSelect,
  testIdPrefix = 'dept',
}: {
  nodes: DeptNode[];
  selectedId: string;
  onSelect: (id: string) => void;
  testIdPrefix?: string;
}) {
  const expandableIds = useMemo(() => collectExpandableDeptIds(nodes), [nodes]);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(expandableIds));

  useEffect(() => {
    // 树重载时默认全部展开，便于浏览；若已有选中项也保证祖先可见
    setExpanded(new Set(collectExpandableDeptIds(nodes)));
  }, [nodes]);

  function toggleExpand(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function expandAll() {
    setExpanded(new Set(expandableIds));
  }

  function collapseAll() {
    setExpanded(new Set());
  }

  const renderNodes = (list: DeptNode[], depth: number): ReactNode =>
    list.map((n) => {
      const id = String(n.id);
      const hasChildren = (n.children?.length ?? 0) > 0;
      const isOpen = expanded.has(id);
      const on = selectedId === id;
      const enabled = n.status === 1;
      return (
        <div key={id}>
          <div
            className={cn(
              'flex w-full items-center gap-0.5 rounded border px-1 py-1 text-sm',
              on ? 'border-primary bg-primary/10 font-medium text-primary' : 'border-transparent',
            )}
            style={{ paddingLeft: `${4 + depth * 12}px` }}
          >
            {hasChildren ? (
              <button
                type="button"
                className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted"
                aria-label={isOpen ? '收起' : '展开'}
                aria-expanded={isOpen}
                onClick={() => toggleExpand(id)}
              >
                <ChevronRight className={cn('h-3.5 w-3.5 transition', isOpen && 'rotate-90')} />
              </button>
            ) : (
              <span className="inline-block h-5 w-5 shrink-0" aria-hidden />
            )}
            <button
              type="button"
              data-testid={`${testIdPrefix}-option`}
              onClick={() => onSelect(id)}
              className="flex min-w-0 flex-1 items-center gap-1.5 rounded px-1 py-0.5 text-left hover:bg-accent/60"
            >
              <span className="truncate">{n.name}</span>
              <span
                className={cn(
                  'ml-auto shrink-0 rounded px-1 text-[0.65rem]',
                  enabled ? 'bg-success/10 text-success' : 'bg-muted text-muted-foreground',
                )}
              >
                {enabled ? '启用' : '停用'}
              </span>
            </button>
          </div>
          {hasChildren && isOpen ? renderNodes(n.children ?? [], depth + 1) : null}
        </div>
      );
    });

  if (nodes.length === 0) {
    return <p className="py-3 text-center text-sm text-muted-foreground">暂无部门</p>;
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-1">
      <div className="flex shrink-0 items-center gap-1 px-0.5">
        <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={expandAll}>
          全部展开
        </Button>
        <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={collapseAll}>
          全部收起
        </Button>
        <span className="ml-auto text-[11px] text-muted-foreground">
          {collectDeptIds(nodes).length} 个部门
        </span>
      </div>
      <div className="min-h-0 flex-1 space-y-0.5 overflow-auto rounded-md border p-1">
        {renderNodes(nodes, 0)}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 部门负责人（弹窗：组织 + 部门）
// ---------------------------------------------------------------------------

function DeptPickField({
  selectedId,
  onChangeId,
}: {
  selectedId: string | null;
  onChangeId: (id: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState<string | null>(null);

  return (
    <>
      <SummaryRow
        label="部门"
        summary={selectedId ? (label ?? `部门#${selectedId}`) : null}
        emptyText="尚未选择部门"
        buttonText={selectedId ? '修改部门' : '选择部门'}
        onOpen={() => setOpen(true)}
      />
      <DeptSelectDialog
        open={open}
        initialId={selectedId}
        onOpenChange={setOpen}
        onConfirm={(id, name) => {
          setLabel(name);
          onChangeId(id);
          setOpen(false);
        }}
      />
    </>
  );
}

function DeptSelectDialog({
  open,
  initialId,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  initialId: string | null;
  onOpenChange: (open: boolean) => void;
  onConfirm: (id: string, name: string) => void;
}) {
  const [orgs, setOrgs] = useState<OrgItem[]>([]);
  const [orgId, setOrgId] = useState('');
  const [depts, setDepts] = useState<DeptNode[]>([]);
  const [draft, setDraft] = useState<string>('');
  const [loadingOrgs, setLoadingOrgs] = useState(false);
  const [loadingDepts, setLoadingDepts] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setDraft(initialId ?? '');
    setError(null);
    setLoadingOrgs(true);
    void listOrgs()
      .then((list) => {
        setOrgs(list ?? []);
        setOrgId((prev) => prev || (list?.[0] ? String(list[0].id) : ''));
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : '加载组织失败'))
      .finally(() => setLoadingOrgs(false));
  }, [open, initialId]);

  const loadDepts = useCallback(async (oid: string) => {
    if (!oid) {
      setDepts([]);
      return;
    }
    setLoadingDepts(true);
    setError(null);
    try {
      setDepts((await fetchDeptTree(oid)) ?? []);
    } catch (e: unknown) {
      setDepts([]);
      setError(e instanceof Error ? e.message : '加载部门失败');
    } finally {
      setLoadingDepts(false);
    }
  }, []);

  useEffect(() => {
    if (open && orgId) void loadDepts(orgId);
  }, [open, orgId, loadDepts]);

  const selectedName = findDeptName(depts, draft);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>选择部门</DialogTitle>
          <DialogDescription>先选组织，再选部门负责人所在部门（可展开/收起）。</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <div>
            <Label className="mb-1 block text-[12px] text-muted-foreground">组织</Label>
            <select
              aria-label="选择组织"
              value={orgId}
              disabled={loadingOrgs}
              onChange={(e) => {
                setOrgId(e.target.value);
                setDraft('');
              }}
              className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
            >
              <option value="">{loadingOrgs ? '加载组织…' : '选择组织'}</option>
              {orgs.map((o) => (
                <option key={o.id} value={String(o.id)}>
                  {o.name}
                </option>
              ))}
            </select>
          </div>
          <div className="h-64">
            {loadingDepts ? (
              <p className="py-4 text-center text-sm text-muted-foreground">加载部门…</p>
            ) : (
              <DeptTreeList nodes={depts} selectedId={draft} onSelect={setDraft} />
            )}
          </div>
          {error ? <p className="text-xs text-warning">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button type="button" size="sm" variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={!draft}
            onClick={() => onConfirm(draft, selectedName ?? `部门#${draft}`)}
          >
            确定
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// 公司 + 部门 + 岗位（左部门 / 中可选岗位 / 右已选，可多选）
// ---------------------------------------------------------------------------

function formatOrgPostSummary(items: OrgPostValue[]): string | null {
  if (items.length === 0) return null;
  return items
    .map((p) => {
      const org = p.orgName || `组织#${p.orgId}`;
      const dept = p.deptName || `部门#${p.deptId}`;
      const post = p.postName || `岗位#${p.postId}`;
      return `${org} / ${dept} / ${post}`;
    })
    .join('；');
}

function OrgPostPickField({
  value,
  onChangeValue,
}: {
  value: OrgPostValue[];
  onChangeValue: (v: OrgPostValue[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [summary, setSummary] = useState<string | null>(() => formatOrgPostSummary(value));

  useEffect(() => {
    if (value.length === 0) {
      setSummary(null);
      return;
    }
    // 已有展示名则直接用；否则尝试补全
    if (value.every((p) => p.orgName && p.deptName && p.postName)) {
      setSummary(formatOrgPostSummary(value));
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const orgs = await listOrgs();
        if (cancelled) return;
        const enriched = await Promise.all(
          value.map(async (p) => {
            if (p.orgName && p.deptName && p.postName) return p;
            try {
              const posts = await listPosts({ deptIds: [Number(p.deptId)], status: 1 });
              const post = posts.find((x) => String(x.id) === p.postId);
              return {
                ...p,
                orgName: p.orgName ?? orgs.find((o) => String(o.id) === p.orgId)?.name,
                deptName: p.deptName ?? post?.deptName ?? undefined,
                postName: p.postName ?? post?.name,
                postCode: p.postCode ?? post?.code,
              };
            } catch {
              return p;
            }
          }),
        );
        if (!cancelled) setSummary(formatOrgPostSummary(enriched));
      } catch {
        if (!cancelled) setSummary(formatOrgPostSummary(value));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [value]);

  return (
    <>
      <SummaryRow
        label="组织 / 部门 / 岗位"
        summary={summary}
        emptyText="尚未选择岗位"
        buttonText={value.length > 0 ? '修改岗位范围' : '选择岗位范围'}
        onOpen={() => setOpen(true)}
      />
      <OrgPostSelectDialog
        open={open}
        initial={value}
        onOpenChange={setOpen}
        onConfirm={(next) => {
          setSummary(formatOrgPostSummary(next));
          onChangeValue(next);
          setOpen(false);
        }}
      />
    </>
  );
}

function OrgPostSelectDialog({
  open,
  initial,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  initial: OrgPostValue[];
  onOpenChange: (open: boolean) => void;
  onConfirm: (value: OrgPostValue[]) => void;
}) {
  const [orgs, setOrgs] = useState<OrgItem[]>([]);
  const [orgId, setOrgId] = useState('');
  const [depts, setDepts] = useState<DeptNode[]>([]);
  const [deptId, setDeptId] = useState('');
  const [posts, setPosts] = useState<PostItem[]>([]);
  const [draft, setDraft] = useState<OrgPostValue[]>([]);
  const [loadingOrgs, setLoadingOrgs] = useState(false);
  const [loadingDepts, setLoadingDepts] = useState(false);
  const [loadingPosts, setLoadingPosts] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setDraft(initial.map((p) => ({ ...p })));
    setOrgId(initial[0]?.orgId ?? '');
    setDeptId(initial[0]?.deptId ?? '');
    setError(null);
    setLoadingOrgs(true);
    void listOrgs()
      .then((list) => {
        setOrgs(list ?? []);
        if (!initial[0]?.orgId && list?.[0]) setOrgId(String(list[0].id));
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : '加载组织失败'))
      .finally(() => setLoadingOrgs(false));
  }, [open, initial]);

  useEffect(() => {
    if (!open || !orgId) {
      setDepts([]);
      return;
    }
    let cancelled = false;
    setLoadingDepts(true);
    void fetchDeptTree(orgId)
      .then((tree) => {
        if (!cancelled) setDepts(tree ?? []);
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setDepts([]);
          setError(e instanceof Error ? e.message : '加载部门失败');
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingDepts(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, orgId]);

  useEffect(() => {
    if (!open || !deptId) {
      setPosts([]);
      return;
    }
    let cancelled = false;
    setLoadingPosts(true);
    void listPosts({ deptIds: [Number(deptId)], status: 1 })
      .then((list) => {
        if (!cancelled) setPosts(list ?? []);
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setPosts([]);
          setError(e instanceof Error ? e.message : '加载岗位失败');
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingPosts(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, deptId]);

  const orgName = orgs.find((o) => String(o.id) === orgId)?.name;
  const deptName = findDeptName(depts, deptId);
  const selectedKeys = useMemo(() => new Set(draft.map(orgPostKey)), [draft]);

  function addPost(p: PostItem) {
    if (!orgId || !deptId) return;
    const item: OrgPostValue = {
      orgId,
      deptId,
      postId: String(p.id),
      orgName: orgName,
      deptName: deptName ?? p.deptName ?? undefined,
      postName: p.name,
      postCode: p.code,
    };
    const key = orgPostKey(item);
    setDraft((prev) => (prev.some((x) => orgPostKey(x) === key) ? prev : [...prev, item]));
  }

  function removePost(key: string) {
    setDraft((prev) => prev.filter((x) => orgPostKey(x) !== key));
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>选择公司 / 部门 / 岗位</DialogTitle>
          <DialogDescription>
            左侧选公司与部门，中间将岗位「添加」到右侧已选（可多选，可跨部门）；右侧可「删除」。
          </DialogDescription>
        </DialogHeader>
        <div className="grid h-[28rem] grid-cols-3 gap-3">
          <div className="flex min-h-0 flex-col gap-2">
            <div>
              <Label className="mb-1 block text-[12px] text-muted-foreground">公司（组织）</Label>
              <select
                aria-label="选择组织"
                value={orgId}
                disabled={loadingOrgs}
                onChange={(e) => {
                  setOrgId(e.target.value);
                  setDeptId('');
                }}
                className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
              >
                <option value="">{loadingOrgs ? '加载组织…' : '选择组织'}</option>
                {orgs.map((o) => (
                  <option key={o.id} value={String(o.id)}>
                    {o.name}
                  </option>
                ))}
              </select>
            </div>
            <Label className="text-[12px] text-muted-foreground">部门</Label>
            <div className="min-h-0 flex-1">
              {loadingDepts ? (
                <p className="py-3 text-center text-sm text-muted-foreground">加载部门…</p>
              ) : (
                <DeptTreeList
                  nodes={depts}
                  selectedId={deptId}
                  testIdPrefix="org-post-dept"
                  onSelect={setDeptId}
                />
              )}
            </div>
          </div>

          <div className="flex min-h-0 flex-col gap-2">
            <Label className="text-[12px] text-muted-foreground">可选岗位</Label>
            <div className="min-h-0 flex-1 space-y-1 overflow-auto rounded-md border p-1">
              {!deptId ? (
                <p className="py-3 text-center text-sm text-muted-foreground">请先在左侧选择部门</p>
              ) : loadingPosts ? (
                <p className="py-3 text-center text-sm text-muted-foreground">加载岗位…</p>
              ) : posts.length === 0 ? (
                <p className="py-3 text-center text-sm text-muted-foreground">该部门暂无启用岗位</p>
              ) : (
                posts.map((p) => {
                  const key = orgPostKey({ orgId, deptId, postId: String(p.id) });
                  const added = selectedKeys.has(key);
                  return (
                    <div
                      key={p.id}
                      data-testid="org-post-post-option"
                      className="flex items-start gap-2 rounded border border-transparent px-2 py-1.5 text-sm hover:bg-accent"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium">{p.name}</div>
                        <div className="text-[11px] text-muted-foreground">
                          {orgName || '—'} / {deptName || '—'} · {p.code}
                        </div>
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        variant={added ? 'secondary' : 'outline'}
                        className="h-7 shrink-0 px-2 text-xs"
                        disabled={added}
                        aria-label={added ? `已添加 ${p.name}` : `添加 ${p.name}`}
                        onClick={() => addPost(p)}
                      >
                        {added ? '已添加' : '添加'}
                      </Button>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          <div className="flex min-h-0 flex-col gap-2">
            <Label className="text-[12px] text-muted-foreground">
              已选岗位{draft.length > 0 ? `（${draft.length}）` : ''}
            </Label>
            <div className="min-h-0 flex-1 space-y-1 overflow-auto rounded-md border p-1">
              {draft.length === 0 ? (
                <p className="py-3 text-center text-sm text-muted-foreground">尚未选择</p>
              ) : (
                draft.map((item) => {
                  const key = orgPostKey(item);
                  return (
                    <div
                      key={key}
                      data-testid="org-post-selected"
                      className="flex items-start gap-2 rounded border border-transparent px-2 py-1.5 text-sm hover:bg-accent"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium">
                          {item.postName || `岗位#${item.postId}`}
                        </div>
                        <div className="text-[11px] text-muted-foreground">
                          {item.orgName || `组织#${item.orgId}`} /{' '}
                          {item.deptName || `部门#${item.deptId}`}
                          {item.postCode ? ` · ${item.postCode}` : ''}
                        </div>
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-7 shrink-0 px-2 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive"
                        aria-label={`删除 ${item.postName || item.postId}`}
                        onClick={() => removePost(key)}
                      >
                        删除
                      </Button>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
        {error ? <p className="text-xs text-warning">{error}</p> : null}
        <DialogFooter>
          <Button type="button" size="sm" variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={draft.length === 0}
            onClick={() => onConfirm(draft)}
          >
            确定
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default AssigneeRuleEditor;

export type { ParsedAssigneeRule };
