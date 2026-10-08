/**
 * iqd-scope-page.tsx — 问数范围与表级 ACL 配置页（W2，路径 /iqd/scope）。
 *
 * <p>重构后的交互：
 * <ul>
 *   <li>过滤区：按角色多选、按用户姓名查询；</li>
 *   <li>权限情况表格：一行 = 一个主体 + 一种对象类型；列为 主体类型 / 主体 ID / 主体名 /
 *       权限对象类型（表 · 模型 · Cube）/ 对象名 / 行级范围；</li>
 *   <li>新增弹窗：选择主体（角色 / 用户，用户走弹窗选择）→ 选择权限对象（表 / 模型 / Cube 三个 TAB，
 *       可多选）→ 逐个对象编辑「行级范围 row_scope」。</li>
 * </ul>
 *
 * <p><b>字段级可访问实现说明</b>：后端本期未提供列级 ACL 表，故字段选择以「同一 iqd_scope_policy
 * + 字段级 item_key」落库：一个对象一行、每个勾选字段再一行。列表「字段访问」列展示
 * 「可访问 n · 不可访问 m（共 N）」；仅对象级、无字段子行时视为全部可访问。
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, Pencil, Plus, RefreshCw, ShieldCheck, Trash2, UserPlus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PageHeader } from '@/components/common/page-header';
import { buildAppBreadcrumbs } from '@/components/common/app-breadcrumbs';
import { FilterMultiSelect } from '@/components/common/filter-multi-select';
import {
  deleteIqdAcl,
  deleteIqdScopePolicy,
  deleteIqdScopePoliciesBatch,
  listIqdAcls,
  listIqdScopePolicies,
  saveIqdAcls,
  saveIqdScopePolicies,
  type IqdAcl,
  type IqdAclSavePayload,
  listIqdDimensions,
  type IqdCatalogItem,
  type IqdScopeDimension,
  type IqdScopePolicy,
  type IqdScopePolicySavePayload,
} from '@/lib/api/iqd';
import { pageUsers } from '@/lib/api/users';
import { listEnabledRoles } from '@/lib/api/roles';
import { ProjectSwitcher } from './components/shared/ProjectSwitcher';
import { useActiveProjectId } from './hooks/useActiveProject';
import { resolveTableKey, useCatalogNodes } from './hooks/useCatalogNodes';
import {
  buildRowScope,
  catalogColumnName,
  parseRowScope,
  summarizeRowScope,
} from './components/scope/rowScopeUtils';
import type { RoleItem, UserView } from '@/types/api';

const SUBJECT_TYPE_LABEL: Record<string, string> = {
  global: '全局',
  role: '角色',
  dept: '部门',
  user: '用户',
  store: '门店',
};

type ObjectKind = 'table' | 'model' | 'cube';
type SubjectKind = 'role' | 'user';

const OBJECT_TYPE_LABEL: Record<ObjectKind, string> = {
  table: '表',
  model: '模型',
  cube: 'Cube',
};

export const IQD_SCOPE_PAGE_PATH = '/iqd/scope';

// ================================================================ 类型

interface SubjectDef {
  kind: SubjectKind;
  id: string;
  name: string;
}

interface ObjectField {
  itemKey: string;
  name: string;
}

interface ObjectDef {
  itemKey: string;
  kind: ObjectKind;
  name: string;
  fields: ObjectField[];
}

interface DisplayRow {
  key: string;
  id?: number;
  subjectType: string;
  subjectId: string;
  subjectName: string;
  objectKind: ObjectKind;
  objectKey: string;
  objectName: string;
  /**
   * 已写入策略的可访问字段数；`undefined` 表示仅有对象级行、未配置字段级
   * （展示为「全部可访问」）。
   */
  fieldCount?: number;
  /** 清单中该对象的字段总数（catalog）。 */
  fieldTotal?: number;
  action?: string;
  /** 已存字段级 itemKey（编辑回显用；仅范围策略用）。 */
  rawFieldKeys: string[];
  /** 行级范围 row_scope 原文（仅行级范围行）。 */
  rowScope?: string;
}

/** 范围策略「字段访问」列文案：可访问 / 不可访问 / 共 N，避免模糊的 a/b。 */
function formatFieldAccessSummary(row: DisplayRow): { text: string; title: string; muted?: boolean } {
  const total = row.fieldTotal;
  if (total == null) {
    return { text: '—', title: '清单中尚无该对象的字段元数据', muted: true };
  }
  if (total === 0) {
    return { text: '无字段', title: '该对象在清单中没有可枚举字段', muted: true };
  }
  // 仅对象级策略、无字段级子行 → 视为对象下全部字段可访问
  if (row.fieldCount == null) {
    return {
      text: `全部可访问（共 ${total}）`,
      title: '未单独勾选字段，按对象级授权视为全部可访问',
      muted: true,
    };
  }
  const allowed = Math.min(Math.max(0, row.fieldCount), total);
  const denied = total - allowed;
  if (allowed === 0) {
    return {
      text: `全部不可访问（共 ${total}）`,
      title: `清单共 ${total} 个字段，均未勾选为可访问`,
      muted: true,
    };
  }
  if (denied === 0) {
    return {
      text: `全部可访问（共 ${total}）`,
      title: `清单共 ${total} 个字段，均已勾选为可访问`,
    };
  }
  return {
    text: `可访问 ${allowed} · 不可访问 ${denied}（共 ${total}）`,
    title: `已勾选可访问 ${allowed} 个；未勾选（不可访问）${denied} 个；清单共 ${total} 个字段`,
  };
}

interface FieldSelection {
  [objectKey: string]: Set<string>;
}

// ================================================================ 工具

function objectKindOf(itemKey: string): ObjectKind {
  if (itemKey.startsWith('mdl:model:')) return 'model';
  if (itemKey.startsWith('mdl:cube:')) return 'cube';
  return 'table';
}

function shortName(itemKey: string, displayName?: string | null): string {
  if (displayName && displayName.trim() !== '') return displayName;
  const colonParts = itemKey.split(':');
  if (colonParts.length > 1) return colonParts[colonParts.length - 1];
  const dotParts = itemKey.split('.');
  return dotParts[dotParts.length - 1];
}

function fieldsOfObject(
  object: IqdCatalogItem,
  catalog: IqdCatalogItem[],
  kind: ObjectKind,
): ObjectField[] {
  if (kind === 'cube') {
    return catalog
      .filter(
        (it) =>
          (it.kind === 'measure' || it.kind === 'dimension') &&
          it.parent_key === object.item_key,
      )
      .map((it) => ({ itemKey: it.item_key, name: shortName(it.item_key, it.display_name) }));
  }
  const tableKey =
    kind === 'table' ? object.item_key : resolveTableKey(catalog, object) ?? object.item_key;
  const byParent = catalog.filter(
    (it) => it.kind === 'column' && it.parent_key === tableKey,
  );
  if (byParent.length > 0) {
    return byParent.map((it) => ({
      itemKey: it.item_key,
      name: shortName(it.item_key, it.display_name),
    }));
  }
  return catalog
    .filter((it) => it.kind === 'column' && it.item_key.startsWith(tableKey + '.'))
    .map((it) => ({ itemKey: it.item_key, name: shortName(it.item_key, it.display_name) }));
}

// ================================================================ 主体选择弹窗

function RoleSelectDialog({
  open,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (subject: SubjectDef) => void;
}) {
  const [keyword, setKeyword] = useState('');
  const [roles, setRoles] = useState<RoleItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<RoleItem | null>(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    listEnabledRoles()
      .then(setRoles)
      .catch(() => setRoles([]))
      .finally(() => setLoading(false));
  }, [open]);

  const filtered = roles.filter(
    (r) =>
      keyword.trim() === '' ||
      r.name.toLowerCase().includes(keyword.trim().toLowerCase()) ||
      r.code.toLowerCase().includes(keyword.trim().toLowerCase()),
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>选择角色</DialogTitle>
          <DialogDescription>按角色名 / 角色码检索，单选。</DialogDescription>
        </DialogHeader>
        <Input
          placeholder="搜索角色名 / 角色码"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
        />
        <div className="max-h-64 space-y-1 overflow-auto rounded-md border p-1">
          {loading ? (
            <p className="py-4 text-center text-sm text-muted-foreground">加载中…</p>
          ) : filtered.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">无匹配角色</p>
          ) : (
            filtered.map((r) => {
              const on = selected?.id === r.id;
              return (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => setSelected(r)}
                  aria-pressed={on}
                  className={cn(
                    'flex w-full items-center gap-2 rounded border px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent',
                    on
                      ? 'border-primary bg-primary/10 font-medium text-primary shadow-sm'
                      : 'border-transparent',
                  )}
                >
                  <span
                    className={cn(
                      'flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border',
                      on ? 'border-primary bg-primary text-primary-foreground' : 'border-muted-foreground/40',
                    )}
                  >
                    {on ? <Check className="h-3 w-3" /> : null}
                  </span>
                  <span className="truncate">{r.name}</span>
                  <span className="text-xs text-muted-foreground">({r.code})</span>
                </button>
              );
            })
          )}
        </div>
        {selected ? (
          <div className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
            已选：<span className="font-medium text-foreground">{selected.name}</span>
            <span className="ml-1">({selected.code})</span>
          </div>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button
            disabled={!selected}
            onClick={() => {
              if (selected) onConfirm({ kind: 'role', id: selected.code, name: selected.name });
            }}
          >
            确定
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function UserSelectDialog({
  open,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (subject: SubjectDef) => void;
}) {
  const [keyword, setKeyword] = useState('');
  const [users, setUsers] = useState<UserView[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<UserView | null>(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    pageUsers({ realName: keyword.trim() || undefined, size: 50 })
      .then((res) => setUsers(res.list))
      .catch(() => setUsers([]))
      .finally(() => setLoading(false));
  }, [open, keyword]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>选择用户</DialogTitle>
          <DialogDescription>按用户姓名检索，单选。</DialogDescription>
        </DialogHeader>
        <Input
          placeholder="输入用户姓名"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
        />
        <div className="max-h-64 space-y-1 overflow-auto rounded-md border p-1">
          {loading ? (
            <p className="py-4 text-center text-sm text-muted-foreground">加载中…</p>
          ) : users.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">无匹配用户</p>
          ) : (
            users.map((u) => {
              const on = selected?.id === u.id;
              return (
                <button
                  key={u.id}
                  type="button"
                  onClick={() => setSelected(u)}
                  aria-pressed={on}
                  className={cn(
                    'flex w-full items-center gap-2 rounded border px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent',
                    on
                      ? 'border-primary bg-primary/10 font-medium text-primary shadow-sm'
                      : 'border-transparent',
                  )}
                >
                  <span
                    className={cn(
                      'flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border',
                      on ? 'border-primary bg-primary text-primary-foreground' : 'border-muted-foreground/40',
                    )}
                  >
                    {on ? <Check className="h-3 w-3" /> : null}
                  </span>
                  <span className="truncate">{u.realName || u.username}</span>
                  <span className="text-xs text-muted-foreground">({u.username})</span>
                </button>
              );
            })
          )}
        </div>
        {selected ? (
          <div className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
            已选：<span className="font-medium text-foreground">{selected.realName || selected.username}</span>
            <span className="ml-1">({selected.username})</span>
          </div>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button
            disabled={!selected}
            onClick={() => {
              if (selected) {
                onConfirm({
                  kind: 'user',
                  id: selected.id,
                  name: selected.realName || selected.username,
                });
              }
            }}
          >
            确定
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ================================================================ 新增权限向导（主体 / 对象 / 字段）

interface WizardPayload {
  subject: SubjectDef;
  objects: Array<{ object: ObjectDef; fields: ObjectField[]; rowScope?: string }>;
}

export interface EditContext {
  subject: SubjectDef;
  objectKey: string;
  objectName: string;
  objectKind: ObjectKind;
  selectedFieldKeys: Set<string>;
  action?: string;
  /** 行级范围编辑回显（仅 target=acl）。 */
  rowScope?: string;
}


// ================================================================ 行级范围结构化编辑器（对象级列覆盖）

/**
 * 结构化行级范围编辑器：为当前对象选择维度 + 覆盖列名（下拉，仅本对象 catalog 字段）。
 *
 * <p>列名默认取维度全局 `column_name`（作为「默认」选项）；也可从该对象的 catalog 字段
 * 下拉选择覆盖列，写回 `row_scope.dimensions[].column`。不选覆盖列 = 维度全局列（零回归）。
 */
function DimensionScopeEditor({
  dimensions,
  fields,
  value,
  onChange,
}: {
  dimensions: IqdScopeDimension[];
  fields: ObjectField[];
  value: string;
  onChange: (next: string) => void;
}) {
  const parsed = useMemo(() => parseRowScope(value), [value]);
  const instances = parsed.instances;

  const columnOptions = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const f of fields) {
      const name = catalogColumnName({ item_key: f.itemKey });
      if (name && !seen.has(name)) {
        seen.add(name);
        out.push(name);
      }
    }
    return out;
  }, [fields]);

  const emit = (next: Array<{ dimension: string; column?: string | null; scope?: string | null }>) => {
    onChange(buildRowScope(next) ?? '');
  };

  const update = (idx: number, patch: Partial<{ dimension: string; column: string }>) => {
    const next = instances.map((inst, i) =>
      i === idx
        ? { dimension: patch.dimension ?? inst.dimension, column: patch.column ?? inst.column, scope: inst.scope }
        : { dimension: inst.dimension, column: inst.column, scope: inst.scope },
    );
    emit(next);
  };

  const remove = (idx: number) => {
    emit(
      instances
        .filter((_, i) => i !== idx)
        .map((inst) => ({ dimension: inst.dimension, column: inst.column, scope: inst.scope })),
    );
  };

  const add = () => {
    const first = dimensions[0];
    if (!first) return;
    emit([
      ...instances.map((inst) => ({ dimension: inst.dimension, column: inst.column, scope: inst.scope })),
      { dimension: first.dimension_code, column: '' },
    ]);
  };

  return (
    <div className="mt-1 flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex items-center justify-between">
        <label className="block shrink-0 text-xs text-muted-foreground">
          {'行级范围（留空=全行可见；列名默认取维度全局列，可被本对象覆盖）'}
        </label>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 px-2"
          onClick={add}
          disabled={dimensions.length === 0}
        >
          <Plus className="h-3.5 w-3.5" />
          添加维度
        </Button>
      </div>
      {parsed.error ? (
        <p className="text-xs text-destructive">
          {parsed.error}（原始值：{parsed.raw}）
        </p>
      ) : null}
      {instances.length === 0 ? (
        <p className="text-xs text-muted-foreground">未配置维度 → 全行可见</p>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-auto">
          {instances.map((inst, idx) => {
            const dim = dimensions.find((d) => d.dimension_code === inst.dimension);
            const defaultColumn = dim?.column_name ?? '';
            const override = (inst.column ?? '').trim();
            const selectValue = override !== '' ? override : '__default__';
            const options = Array.from(new Set([defaultColumn, ...columnOptions].filter(Boolean)));
            return (
              <div key={`${inst.dimension}-${idx}`} className="flex flex-wrap items-center gap-2 rounded border p-2">
                <select
                  className="h-8 rounded border border-input bg-card px-2 text-xs"
                  value={inst.dimension}
                  onChange={(e) => {
                    update(idx, { dimension: e.target.value, column: '' });
                  }}
                >
                  {dimensions.map((d) => (
                    <option key={d.dimension_code} value={d.dimension_code}>
                      {d.dimension_name || d.dimension_code}
                    </option>
                  ))}
                </select>
                <span className="text-xs text-muted-foreground">列名</span>
                <select
                  className="h-8 rounded border border-input bg-card px-2 font-mono text-xs"
                  value={selectValue}
                  onChange={(e) => {
                    const v = e.target.value;
                    update(idx, { column: v === '__default__' ? '' : v });
                  }}
                >
                  <option value="__default__">
                    {defaultColumn ? `默认（${defaultColumn}）` : '默认（维度全局列）'}
                  </option>
                  {options
                    .filter((c) => c !== defaultColumn)
                    .map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                </select>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="ml-auto h-7 px-2 text-destructive"
                  onClick={() => remove(idx)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function AddPermissionWizard({
  open,
  target,
  catalog,
  catalogLoading,
  edit,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  target: 'policy' | 'acl';
  catalog: IqdCatalogItem[];
  catalogLoading: boolean;
  edit?: EditContext | null;
  onOpenChange: (open: boolean) => void;
  onSubmit: (payload: WizardPayload) => Promise<void>;
}) {
  const [step, setStep] = useState<'subject' | 'object' | 'fields'>('subject');
  const [subject, setSubject] = useState<SubjectDef | null>(null);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [fieldSelection, setFieldSelection] = useState<FieldSelection>({});
  const [rowScopeDraft, setRowScopeDraft] = useState<Record<string, string>>({});
  const [aclDimensions, setAclDimensions] = useState<IqdScopeDimension[]>([]);
  const [showRole, setShowRole] = useState(false);
  const [showUser, setShowUser] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open || target !== 'acl') return;
    let cancelled = false;
    void listIqdDimensions()
      .then((dims) => {
        if (!cancelled) setAclDimensions(dims.filter((d) => d.enabled !== false));
      })
      .catch(() => {
        if (!cancelled) setAclDimensions([]);
      });
    return () => {
      cancelled = true;
    };
  }, [open, target]);

  useEffect(() => {
    if (!open) return;
    if (edit) {
      setStep('fields');
      setSubject(edit.subject);
      setSelectedKeys(new Set([edit.objectKey]));
      setFieldSelection({ [edit.objectKey]: new Set(edit.selectedFieldKeys) });
      setRowScopeDraft(edit.rowScope ? { [edit.objectKey]: edit.rowScope } : {});
      return;
    }
    setStep('subject');
    setSubject(null);
    setSelectedKeys(new Set());
    setFieldSelection({});
    setRowScopeDraft({});
  }, [open, edit]);

  const objects = useMemo<ObjectDef[]>(() => {
    const build = (it: IqdCatalogItem, kind: ObjectKind): ObjectDef => ({
      itemKey: it.item_key,
      kind,
      name: shortName(it.item_key, it.display_name),
      fields: fieldsOfObject(it, catalog, kind),
    });
    // 方案 A：行级范围只能作用于「已纳入问数范围」（in_scope）的对象，
    // 避免写出永远不生效的“授权行”（该表已不再参与 grant）。
    const usable = target === 'acl' ? catalog.filter((it) => it.in_scope === true) : catalog;
    return [
      ...usable.filter((it) => it.kind === 'table').map((it) => build(it, 'table')),
      ...usable.filter((it) => it.kind === 'model').map((it) => build(it, 'model')),
      ...usable.filter((it) => it.kind === 'cube').map((it) => build(it, 'cube')),
    ];
  }, [catalog, target]);

  const objectsWithEdit = useMemo<ObjectDef[]>(() => {
    if (!edit) return objects;
    if (objects.some((o) => o.itemKey === edit.objectKey)) return objects;
    // catalog 尚未加载 / 对象已不在清单：用编辑上下文兜底，避免字段步骤空白。
    const fields = catalog
      .filter(
        (it) =>
          (it.kind === 'column' || it.kind === 'measure' || it.kind === 'dimension') &&
          edit.selectedFieldKeys.has(it.item_key),
      )
      .map((it) => ({ itemKey: it.item_key, name: shortName(it.item_key, it.display_name) }));
    return [
      ...objects,
      {
        itemKey: edit.objectKey,
        kind: edit.objectKind,
        name: edit.objectName,
        fields,
      },
    ];
  }, [objects, edit, catalog]);

  const selectedObjects = useMemo(
    () =>
      objectsWithEdit.filter(
        (o) => selectedKeys.has(o.itemKey) || (edit != null && o.itemKey === edit.objectKey),
      ),
    [objectsWithEdit, selectedKeys, edit],
  );

  const tabObjects: Record<ObjectKind, ObjectDef[]> = useMemo(
    () => ({
      table: objectsWithEdit.filter((o) => o.kind === 'table'),
      model: objectsWithEdit.filter((o) => o.kind === 'model'),
      cube: objectsWithEdit.filter((o) => o.kind === 'cube'),
    }),
    [objectsWithEdit],
  );

  useEffect(() => {
    if (step !== 'fields') return;
    // 编辑态已由 edit.selectedFieldKeys 回填；勿在「已清空」时再强制全选。
    if (edit) return;
    setFieldSelection((prev) => {
      const next: FieldSelection = { ...prev };
      for (const obj of selectedObjects) {
        if (!next[obj.itemKey] || next[obj.itemKey].size === 0) {
          next[obj.itemKey] = new Set(obj.fields.map((f) => f.itemKey));
        }
      }
      return next;
    });
  }, [step, selectedObjects, edit]);

  const toggleObject = (key: string) =>
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const toggleField = (objectKey: string, fieldKey: string) =>
    setFieldSelection((prev) => {
      const next: FieldSelection = { ...prev };
      const cur = new Set(next[objectKey] ?? []);
      if (cur.has(fieldKey)) cur.delete(fieldKey);
      else cur.add(fieldKey);
      next[objectKey] = cur;
      return next;
    });

  const setAllFields = (objectKey: string, all: boolean) => {
    const obj = selectedObjects.find((o) => o.itemKey === objectKey);
    if (!obj) return;
    setFieldSelection((prev) => ({
      ...prev,
      [objectKey]: all ? new Set(obj.fields.map((f) => f.itemKey)) : new Set(),
    }));
  };

  const submit = async () => {
    if (!subject) return;
    setSubmitting(true);
    try {
      await onSubmit({
        subject,
        objects: selectedObjects.map((obj) => ({
          object: obj,
          fields:
            target === 'acl'
              ? []
              : obj.fields.filter((f) =>
                  (fieldSelection[obj.itemKey] ?? new Set<string>()).has(f.itemKey),
                ),
          rowScope: (rowScopeDraft[obj.itemKey] ?? '').trim() || undefined,
        })),
      });
      onOpenChange(false);
    } finally {
      setSubmitting(false);
    }
  };

  const title = target === 'policy' ? '新增范围策略' : '新增行级范围';

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          className={cn(
            'flex flex-col sm:max-w-3xl',
            target === 'acl' || step === 'fields' ? 'h-[85vh]' : 'max-h-[90vh]',
          )}
        >
          <DialogHeader>
            <DialogTitle>{edit ? (target === 'policy' ? '修改可访问字段' : '修改行级范围') : title}</DialogTitle>
            <DialogDescription>
              {step === 'subject'
                ? '第一步：选择主体（角色 / 用户）'
                : step === 'object'
                  ? '第二步：选择权限对象（可多选；表 / 模型 / Cube）'
                  : target === 'acl'
                    ? '第三步：配置每个对象的行级范围 row_scope（留空=全行可见）'
                    : '列出该表/模型的全部字段；勾选表示可访问（默认全部选中）'}
            </DialogDescription>
          </DialogHeader>

          <div className="min-h-0 flex-1 overflow-auto py-2">
            {step === 'subject' ? (
              <div className="grid grid-cols-2 gap-4">
                <button
                  type="button"
                  onClick={() => setShowRole(true)}
                  className={cn(
                    'flex h-24 flex-col items-center justify-center gap-2 rounded-lg border p-3 transition hover:border-primary',
                    subject?.kind === 'role' && 'border-primary bg-primary/5',
                  )}
                >
                  <ShieldCheck className="h-7 w-7 text-primary" />
                  <span className="font-medium">角色</span>
                  {subject?.kind === 'role' ? (
                    <span className="text-xs text-muted-foreground">{subject.name}</span>
                  ) : null}
                </button>
                <button
                  type="button"
                  onClick={() => setShowUser(true)}
                  className={cn(
                    'flex h-24 flex-col items-center justify-center gap-2 rounded-lg border p-3 transition hover:border-primary',
                    subject?.kind === 'user' && 'border-primary bg-primary/5',
                  )}
                >
                  <UserPlus className="h-7 w-7 text-primary" />
                  <span className="font-medium">用户</span>
                  {subject?.kind === 'user' ? (
                    <span className="text-xs text-muted-foreground">{subject.name}</span>
                  ) : null}
                </button>
              </div>
            ) : null}

            {step === 'object' ? (
              <Tabs defaultValue="table" className="w-full">
                <TabsList>
                  <TabsTrigger value="table">表 ({tabObjects.table.length})</TabsTrigger>
                  <TabsTrigger value="model">模型 ({tabObjects.model.length})</TabsTrigger>
                  <TabsTrigger value="cube">Cube ({tabObjects.cube.length})</TabsTrigger>
                </TabsList>
                {(['table', 'model', 'cube'] as ObjectKind[]).map((kind) => (
                  <TabsContent key={kind} value={kind}>
                    <div className="max-h-[36rem] space-y-1 overflow-auto rounded-md border p-2">
                      {catalogLoading ? (
                        <p className="py-4 text-center text-sm text-muted-foreground">加载中…</p>
                      ) : tabObjects[kind].length === 0 ? (
                        <p className="py-4 text-center text-sm text-muted-foreground">暂无可选对象</p>
                      ) : (
                        tabObjects[kind].map((o) => {
                          const on = selectedKeys.has(o.itemKey);
                          return (
                            <label
                              key={o.itemKey}
                              className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-sm hover:bg-accent/60"
                            >
                              <input
                                type="checkbox"
                                checked={on}
                                onChange={() => toggleObject(o.itemKey)}
                              />
                              <span className="truncate font-medium">{o.name}</span>
                              <span className="truncate font-mono text-xs text-muted-foreground">
                                {o.itemKey}
                              </span>
                              <Badge variant="outline" className="ml-auto shrink-0 rounded">
                                {o.fields.length} 字段
                              </Badge>
                            </label>
                          );
                        })
                      )}
                    </div>
                  </TabsContent>
                ))}
              </Tabs>
            ) : null}

            {step === 'fields' ? (
              <div
                className={cn(
                  'flex h-full min-h-0 flex-col gap-3',
                )}
              >
                {selectedObjects.length === 0 ? (
                  <p className="py-4 text-center text-sm text-muted-foreground">尚未选择对象</p>
                ) : (
                  selectedObjects.map((obj) => {
                    const selected =
                      fieldSelection[obj.itemKey] ?? new Set(obj.fields.map((f) => f.itemKey));
                    const checkedCount = obj.fields.filter((f) => selected.has(f.itemKey)).length;
                    return (
                      <div
                        key={obj.itemKey}
                        className="flex min-h-0 flex-1 flex-col rounded-md border p-3"
                      >
                        <div className="mb-2 flex shrink-0 items-center gap-2">
                          <Badge variant="secondary" className="rounded">
                            {OBJECT_TYPE_LABEL[obj.kind]}
                          </Badge>
                          <span className="text-sm font-medium">{obj.name}</span>
                          <span className="font-mono text-xs text-muted-foreground">{obj.itemKey}</span>
                          {target === 'policy' ? (
                          <span className="ml-auto flex items-center gap-2 text-xs">
                            <span className="text-muted-foreground">
                              已选 {checkedCount}/{obj.fields.length}
                            </span>
                            <button
                              type="button"
                              className="rounded border border-input px-2 py-0.5 hover:bg-accent"
                              onClick={() => setAllFields(obj.itemKey, true)}
                            >
                              全选
                            </button>
                            <button
                              type="button"
                              className="rounded border border-input px-2 py-0.5 hover:bg-accent"
                              onClick={() => setAllFields(obj.itemKey, false)}
                            >
                              清空
                            </button>
                          </span>
                          ) : null}
                        </div>
                        {target === 'acl' ? (
                          <DimensionScopeEditor
                            dimensions={aclDimensions}
                            fields={obj.fields}
                            value={rowScopeDraft[obj.itemKey] ?? ''}
                            onChange={(next) =>
                              setRowScopeDraft((prev) => ({
                                ...prev,
                                [obj.itemKey]: next,
                              }))
                            }
                          />
                        ) : obj.fields.length === 0 ? (
                          <p className="text-xs text-muted-foreground">该对象暂无可选字段</p>
                        ) : (
                          <div className="min-h-0 flex-1 space-y-0.5 overflow-auto rounded-md border p-1">
                            {obj.fields.map((f) => {
                              const on = selected.has(f.itemKey);
                              return (
                                <label
                                  key={f.itemKey}
                                  className={cn(
                                    'flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm transition-colors hover:bg-accent/60',
                                    on && 'bg-primary/5',
                                  )}
                                >
                                  <input
                                    type="checkbox"
                                    aria-label={f.name}
                                    checked={on}
                                    onChange={() => toggleField(obj.itemKey, f.itemKey)}
                                    className="shrink-0"
                                  />
                                  <span className="min-w-0 flex-1 truncate font-medium">{f.name}</span>
                                  <span className="max-w-[55%] truncate font-mono text-xs text-muted-foreground">
                                    {f.itemKey}
                                  </span>
                                  {on ? (
                                    <Check className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
                                  ) : (
                                    <span className="inline-block h-3.5 w-3.5 shrink-0" aria-hidden />
                                  )}
                                </label>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            ) : null}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                if (edit || step === 'subject') onOpenChange(false);
                else setStep(step === 'fields' ? 'object' : 'subject');
              }}
              disabled={submitting}
            >
              {edit || step === 'subject' ? '取消' : '上一步'}
            </Button>
            {step !== 'fields' ? (
              <Button
                disabled={
                  (step === 'subject' && !subject) ||
                  (step === 'object' && selectedKeys.size === 0)
                }
                onClick={() => setStep(step === 'subject' ? 'object' : 'fields')}
              >
                下一步
              </Button>
            ) : (
              <Button
                onClick={() => void submit()}
                disabled={submitting || selectedObjects.length === 0}
              >
                {submitting ? '保存中…' : '确认创建'}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <RoleSelectDialog
        open={showRole}
        onOpenChange={setShowRole}
        onConfirm={(s) => {
          setSubject(s);
          setShowRole(false);
        }}
      />
      <UserSelectDialog
        open={showUser}
        onOpenChange={setShowUser}
        onConfirm={(s) => {
          setSubject(s);
          setShowUser(false);
        }}
      />
    </>
  );
}

// ================================================================ 页面

export function IqdScopePage() {
  const connectionId = useActiveProjectId();
  const { catalog, isLoading: catalogLoading } = useCatalogNodes(connectionId);

  const [rawPolicies, setRawPolicies] = useState<IqdScopePolicy[]>([]);
  const [rawAcls, setRawAcls] = useState<IqdAcl[]>([]);
  const [selectedPolicyRows, setSelectedPolicyRows] = useState<Set<string>>(new Set());
  const [selectedAclRows, setSelectedAclRows] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [roles, setRoles] = useState<RoleItem[]>([]);
  /** 主体类型过滤：all | global | role | user */
  const [subjectTypeFilter, setSubjectTypeFilter] = useState<'all' | 'global' | 'role' | 'user'>(
    'all',
  );
  const [roleFilter, setRoleFilter] = useState<string[]>([]);
  const [userKeyword, setUserKeyword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [policyWizardOpen, setPolicyWizardOpen] = useState(false);
  const [aclWizardOpen, setAclWizardOpen] = useState(false);
  // 编辑上下文：非空时向导直接进入字段步骤，并启用字段删除清理。
  const [editPolicy, setEditPolicy] = useState<DisplayRow | null>(null);
  const [editAcl, setEditAcl] = useState<DisplayRow | null>(null);

  const openEditPolicy = useCallback((row: DisplayRow) => {
    setPolicyWizardOpen(false);
    setEditPolicy(row);
    setPolicyWizardOpen(true);
  }, []);

  const closePolicyWizard = useCallback((open: boolean) => {
    setPolicyWizardOpen(open);
    if (!open) setEditPolicy(null);
  }, []);

  const closeAclWizard = useCallback((open: boolean) => {
    setAclWizardOpen(open);
    if (!open) setEditAcl(null);
  }, []);

  useEffect(() => {
    listEnabledRoles()
      .then(setRoles)
      .catch(() => setRoles([]));
  }, []);

  const roleByCode = useMemo(() => {
    const m = new Map<string, RoleItem>();
    for (const r of roles) m.set(r.code, r);
    return m;
  }, [roles]);

  const load = useCallback(async () => {
    if (connectionId == null) return;
    setLoading(true);
    setError(null);
    try {
      const [ps, as] = await Promise.all([
        listIqdScopePolicies(connectionId),
        listIqdAcls(connectionId),
      ]);
      setRawPolicies(ps);
      setRawAcls(as);
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [connectionId]);

  useEffect(() => {
    void load();
  }, [load]);

  const subjectName = useCallback(
    (type: string, id: string) => {
      if (type === 'role') return roleByCode.get(id)?.name ?? id;
      return id;
    },
    [roleByCode],
  );

  const fieldKeySet = useMemo(() => {
    const s = new Set<string>();
    for (const it of catalog) {
      if (it.kind === 'column' || it.kind === 'measure' || it.kind === 'dimension') {
        s.add(it.item_key);
      }
    }
    return s;
  }, [catalog]);

  const objectFields = useMemo(() => {
    const m = new Map<string, ObjectDef>();
    for (const it of catalog) {
      let kind: ObjectKind | null = null;
      if (it.kind === 'table') kind = 'table';
      else if (it.kind === 'model') kind = 'model';
      else if (it.kind === 'cube') kind = 'cube';
      if (!kind) continue;
      m.set(it.item_key, {
        itemKey: it.item_key,
        kind,
        name: shortName(it.item_key, it.display_name),
        fields: fieldsOfObject(it, catalog, kind),
      });
    }
    return m;
  }, [catalog]);

  const fieldToObject = useMemo(() => {
    const m = new Map<string, string>();
    for (const obj of objectFields.values()) {
      for (const f of obj.fields) m.set(f.itemKey, obj.itemKey);
    }
    return m;
  }, [objectFields]);

  const openEditAcl = useCallback((row: DisplayRow) => {
    // 方案 A：行级范围行只编辑 row_scope，无字段级子行需扫描。
    setAclWizardOpen(false);
    setEditAcl(row);
    setAclWizardOpen(true);
  }, []);


  const policyRows = useMemo<DisplayRow[]>(() => {
    // 含 global（清单「纳入问数」同步）与角色/用户主体模板；用「主体类型」过滤可只看 global。
    const tops = rawPolicies.filter((p) => !fieldKeySet.has(p.item_key));
    const fieldsByObject = new Map<string, string[]>();
    for (const p of rawPolicies) {
      const owner = fieldToObject.get(p.item_key);
      if (!owner) continue;
      const bucket = `${p.subject_type}:${p.subject_id}:${owner}`;
      const list = fieldsByObject.get(bucket) ?? [];
      list.push(p.item_key);
      fieldsByObject.set(bucket, list);
    }
    return tops.map<DisplayRow>((p, i) => {
      const kind = objectKindOf(p.item_key);
      const obj = objectFields.get(p.item_key);
      const selected = fieldsByObject.get(`${p.subject_type}:${p.subject_id}:${p.item_key}`);
      return {
        key: `pol-${p.id ?? i}`,
        id: p.id,
        subjectType: p.subject_type,
        subjectId: p.subject_id,
        subjectName:
          p.subject_name ||
          (p.subject_type === 'global' ? '全局' : subjectName(p.subject_type, p.subject_id)),
        objectKind: kind,
        objectKey: p.item_key,
        objectName: obj?.name ?? shortName(p.item_key),
        fieldCount: selected?.length,
        fieldTotal: obj?.fields.length,
        rawFieldKeys: selected ?? [],
      };
    });
  }, [rawPolicies, fieldKeySet, fieldToObject, objectFields, subjectName]);

  const aclRows = useMemo<DisplayRow[]>(() => {
    // 方案 A：行级范围只看对象级行（field_key 为空），不再处理字段级子行。
    const tops = rawAcls.filter((a) => !a.field_key);
    return tops.map<DisplayRow>((a, i) => {
      const objectKey = a.object_key || a.item_key;
      const kind = objectKindOf(objectKey);
      const obj = objectFields.get(objectKey);
      return {
        key: `acl-${a.id ?? i}`,
        id: a.id,
        subjectType: a.subject_type,
        subjectId: a.subject_id,
        subjectName: a.subject_name || subjectName(a.subject_type, a.subject_id),
        objectKind: kind,
        objectKey,
        objectName: obj?.name ?? shortName(objectKey),
        rawFieldKeys: [],
        rowScope: a.row_scope ?? '',
      };
    });
  }, [rawAcls, objectFields, subjectName]);

  const matchesFilter = useCallback(
    (row: DisplayRow) => {
      if (subjectTypeFilter !== 'all' && row.subjectType !== subjectTypeFilter) {
        return false;
      }
      // 只看全局时不再套角色/用户条件
      if (subjectTypeFilter === 'global') return true;
      if (roleFilter.length > 0) {
        if (row.subjectType !== 'role') return false;
        if (!roleFilter.includes(row.subjectId)) return false;
      }
      if (userKeyword.trim() !== '') {
        if (row.subjectType !== 'user') return false;
        if (!row.subjectName.toLowerCase().includes(userKeyword.trim().toLowerCase())) return false;
      }
      return true;
    },
    [subjectTypeFilter, roleFilter, userKeyword],
  );

  const filteredPolicyRows = useMemo(
    () => policyRows.filter(matchesFilter),
    [policyRows, matchesFilter],
  );
  const filteredAclRows = useMemo(
    () => aclRows.filter(matchesFilter),
    [aclRows, matchesFilter],
  );

  const submitPolicy = useCallback(
    async ({ subject, objects }: WizardPayload) => {
      if (connectionId == null) return;
      const payload: IqdScopePolicySavePayload[] = [];
      for (const { object, fields } of objects) {
        payload.push({
          subject_type: subject.kind,
          subject_id: subject.id,
          item_key: object.itemKey,
          allow: true,
          effective: true,
        });
        for (const f of fields) {
          payload.push({
            subject_type: subject.kind,
            subject_id: subject.id,
            item_key: f.itemKey,
            allow: true,
            effective: true,
          });
        }
      }
      // 编辑：先清理取消勾选的字段行，避免孤儿
      if (editPolicy) {
        const keep = new Set(payload.map((p) => p.item_key));
        const toRemove = editPolicy.rawFieldKeys.filter((k) => !keep.has(k));
        if (toRemove.length > 0) {
          await deleteIqdScopePoliciesBatch(
            connectionId,
            editPolicy.subjectType,
            editPolicy.subjectId,
            toRemove,
          );
        }
      }
      await saveIqdScopePolicies(connectionId, payload);
      await load();
    },
    [connectionId, load, editPolicy],
  );

  const submitAcl = useCallback(
    async ({ subject, objects }: WizardPayload) => {
      if (connectionId == null) return;
      const payload: IqdAclSavePayload[] = [];
      // 方案 A：行级范围只写对象级行（field_key=null）+ row_scope，不再写字段级 ACL。
      for (const { object, rowScope } of objects) {
        payload.push({
          subject_type: subject.kind,
          subject_id: subject.id,
          object_type: object.kind,
          object_key: object.itemKey,
          field_key: null,
          item_key: object.itemKey,
          action: 'ask',
          row_scope: rowScope ?? null,
        });
      }
      // 方案 A：不再存在字段级行，无需清理孤儿（同一对象按 UK
      // (connection, subject*, item_key, action) 幂等覆盖，row_scope 清空则覆为 null）。
      await saveIqdAcls(connectionId, payload);
      await load();
    },
    [connectionId, load, editAcl],
  );

  const roleOptions = useMemo(
    () => roles.map((r) => ({ label: `${r.name}（${r.code}）`, value: r.code })),
    [roles],
  );

  const editPolicyContext: EditContext | null = useMemo(() => {
    if (!editPolicy) return null;
    const selected = new Set(editPolicy.rawFieldKeys);
    return {
      subject: { kind: editPolicy.subjectType as SubjectKind, id: editPolicy.subjectId, name: editPolicy.subjectName },
      objectKey: editPolicy.objectKey,
      objectName: editPolicy.objectName,
      objectKind: editPolicy.objectKind,
      selectedFieldKeys: selected,
    };
  }, [editPolicy]);

  const editAclContext: EditContext | null = useMemo(() => {
    if (!editAcl) return null;
    const selected = new Set(editAcl.rawFieldKeys);
    return {
      subject: { kind: editAcl.subjectType as SubjectKind, id: editAcl.subjectId, name: editAcl.subjectName },
      objectKey: editAcl.objectKey,
      objectName: editAcl.objectName,
      objectKind: editAcl.objectKind,
      selectedFieldKeys: selected,
      action: 'ask',
      rowScope: editAcl.rowScope ?? '',
    };
  }, [editAcl]);


  const collectPolicyItemKeys = useCallback(
    (row: DisplayRow) => {
      const keys = new Set<string>([row.objectKey, ...row.rawFieldKeys]);
      for (const p of rawPolicies) {
        if (
          p.subject_type === row.subjectType &&
          p.subject_id === row.subjectId &&
          fieldToObject.get(p.item_key) === row.objectKey
        ) {
          keys.add(p.item_key);
        }
      }
      return Array.from(keys);
    },
    [rawPolicies, fieldToObject],
  );

  const togglePolicySelection = useCallback((key: string, checked: boolean) => {
    setSelectedPolicyRows((prev) => {
      const next = new Set(prev);
      if (checked) next.add(key);
      else next.delete(key);
      return next;
    });
  }, []);

  const toggleAclSelection = useCallback((key: string, checked: boolean) => {
    setSelectedAclRows((prev) => {
      const next = new Set(prev);
      if (checked) next.add(key);
      else next.delete(key);
      return next;
    });
  }, []);

  const toggleAllPolicyRows = useCallback(
    (checked: boolean) => {
      setSelectedPolicyRows((prev) => {
        const next = new Set(prev);
        for (const row of filteredPolicyRows) {
          if (checked) next.add(row.key);
          else next.delete(row.key);
        }
        return next;
      });
    },
    [filteredPolicyRows],
  );

  const toggleAllAclRows = useCallback(
    (checked: boolean) => {
      setSelectedAclRows((prev) => {
        const next = new Set(prev);
        for (const row of filteredAclRows) {
          if (checked) next.add(row.key);
          else next.delete(row.key);
        }
        return next;
      });
    },
    [filteredAclRows],
  );

  const removePolicyRows = useCallback(
    async (rows: DisplayRow[]) => {
      if (connectionId == null || rows.length === 0) return;
      setBulkDeleting(true);
      setError(null);
      try {
        for (const row of rows) {
          const itemKeys = collectPolicyItemKeys(row);
          if (row.id != null) await deleteIqdScopePolicy(row.id);
          const extraKeys = itemKeys.filter((key) => key !== row.objectKey);
          if (extraKeys.length > 0) {
            await deleteIqdScopePoliciesBatch(
              connectionId,
              row.subjectType,
              row.subjectId,
              extraKeys,
            );
          }
        }
        setSelectedPolicyRows(new Set());
        await load();
      } catch (e) {
        setError(e instanceof Error ? e.message : '批量删除范围策略失败');
      } finally {
        setBulkDeleting(false);
      }
    },
    [connectionId, load, collectPolicyItemKeys],
  );

  const removeAclRows = useCallback(
    async (rows: DisplayRow[]) => {
      if (rows.length === 0) return;
      setBulkDeleting(true);
      setError(null);
      try {
        for (const row of rows) {
          for (const a of rawAcls) {
            if (
              a.id != null &&
              a.subject_type === row.subjectType &&
              a.subject_id === row.subjectId &&
              ((a.object_key || a.item_key) === row.objectKey || fieldToObject.get(a.field_key || a.item_key) === row.objectKey)
            ) {
              await deleteIqdAcl(a.id);
            }
          }
        }
        setSelectedAclRows(new Set());
        await load();
      } catch (e) {
        setError(e instanceof Error ? e.message : '批量删除 ACL 失败');
      } finally {
        setBulkDeleting(false);
      }
    },
    [rawAcls, fieldToObject, load],
  );

  const renderTable = (
    rows: DisplayRow[],
    empty: string,
    withAction: boolean,
    onEdit?: (row: DisplayRow) => void,
    selected?: Set<string>,
    onToggle?: (key: string, checked: boolean) => void,
    onToggleAll?: (checked: boolean) => void,
    variant: 'policy' | 'acl' = 'policy',
  ) => (
    <div className="min-h-0 flex-1 overflow-auto">
      <table className="w-full border-separate border-spacing-0 text-left text-sm">
        <thead className="sticky top-0 z-10 border-b-2 border-foreground/20 bg-table-header text-[13px] text-muted-foreground">
          <tr>
            {onToggle ? (
              <th className="w-10 px-3 py-2 font-bold">
                <input
                  type="checkbox"
                  aria-label="全选"
                  checked={rows.length > 0 && rows.every((row) => selected?.has(row.key))}
                  onChange={(e) => onToggleAll?.(e.target.checked)}
                />
              </th>
            ) : null}
            <th className="px-3 py-2 font-bold">主体类型</th>
            <th className="border-l border-border/60 px-3 py-2 font-bold">主体 ID</th>
            <th className="border-l border-border/60 px-3 py-2 font-bold">主体名</th>
            <th className="border-l border-border/60 px-3 py-2 font-bold">权限对象类型</th>
            <th className="border-l border-border/60 px-3 py-2 font-bold">对象名</th>
            <th className="border-l border-border/60 px-3 py-2 font-bold">
              {variant === 'acl' ? '行级范围' : '字段访问'}
            </th>
            {withAction ? (
              <th className="border-l border-border/60 px-3 py-2 font-bold">动作</th>
            ) : null}
            {onEdit ? (
              <th className="w-12 border-l border-border/60 px-3 py-2 font-bold" />
            ) : null}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td
                colSpan={(withAction ? 7 : 6) + (onEdit ? 1 : 0) + (onToggle ? 1 : 0)}
                className="px-3 py-8 text-center text-muted-foreground"
              >
                {empty}
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr
                key={row.key}
                className="border-b border-border/50 bg-table-row last:border-0 even:bg-table-stripe"
              >
                {onToggle ? (
                  <td className="px-3 py-1.5">
                    <input
                      type="checkbox"
                      aria-label={`选择 ${row.subjectName} ${row.objectName}`}
                      checked={selected?.has(row.key) ?? false}
                      onChange={(e) => onToggle(row.key, e.target.checked)}
                    />
                  </td>
                ) : null}
                <td className="px-3 py-1.5">
                  <Badge
                    variant={
                      row.subjectType === 'global'
                        ? 'secondary'
                        : row.subjectType === 'role'
                          ? 'default'
                          : 'info'
                    }
                    className="rounded"
                  >
                    {SUBJECT_TYPE_LABEL[row.subjectType] ?? row.subjectType}
                  </Badge>
                </td>
                <td className="border-l border-border/60 px-3 py-1.5 font-mono text-xs text-muted-foreground">
                  {row.subjectId}
                </td>
                <td className="border-l border-border/60 px-3 py-1.5">{row.subjectName}</td>
                <td className="border-l border-border/60 px-3 py-1.5">
                  {OBJECT_TYPE_LABEL[row.objectKind] ?? row.objectKind}
                </td>
                <td className="border-l border-border/60 px-3 py-1.5">
                  <span className="font-medium">{row.objectName}</span>
                  <span className="ml-2 font-mono text-xs text-muted-foreground">
                    {row.objectKey}
                  </span>
                </td>
                <td className="border-l border-border/60 px-3 py-1.5">
                  {variant === 'acl' ? (
                    (() => {
                      const summary = summarizeRowScope(row.rowScope);
                      if (summary.parseError) {
                        return <span className="text-xs text-destructive">row_scope 非法</span>;
                      }
                      if (!summary.hasRowScope) {
                        return <span className="text-xs text-muted-foreground">全行可见</span>;
                      }
                      return (
                        <span className="flex flex-wrap items-center gap-1">
                          {summary.badges.map((b) => (
                            <Badge key={b.code} variant="secondary" className="rounded text-[10px]">
                              {b.label}
                            </Badge>
                          ))}
                          {summary.count > summary.badges.length ? (
                            <span className="text-xs text-muted-foreground">+{summary.count - summary.badges.length}</span>
                          ) : null}
                        </span>
                      );
                    })()
                  ) : (
                    (() => {
                      const summary = formatFieldAccessSummary(row);
                      return (
                        <span
                          className={cn(
                            'text-xs',
                            summary.muted && 'text-muted-foreground',
                          )}
                          title={summary.title}
                        >
                          {summary.text}
                        </span>
                      );
                    })()
                  )}
                </td>
                {withAction ? (
                  <td className="border-l border-border/60 px-3 py-1.5">
                    <Badge variant="secondary" className="rounded">
                      {row.action}
                    </Badge>
                  </td>
                ) : null}
                {onEdit ? (
                  <td className="border-l border-border/60 px-3 py-1.5 text-right">
                    {row.subjectType === 'global' ? (
                      <span
                        className="text-[11px] text-muted-foreground"
                        title="由清单「纳入问数」维护，此处只读"
                      >
                        只读
                      </span>
                    ) : (
                      <div className="inline-flex items-center gap-0.5">
                        <button
                          type="button"
                          title="编辑"
                          onClick={() => onEdit(row)}
                          className="inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    )}
                  </td>
                ) : null}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        title="问数范围与权限"
        description="可问 = 角色/用户范围策略 ∩ 清单「纳入问数」。仅勾纳入不会放行；须在本页为角色或用户配置策略。行级范围另配 row_scope。"
        breadcrumbs={buildAppBreadcrumbs({ app: 'agent', title: '问数范围与权限' })}
        actions={
          <div className="flex items-center gap-2">
            <ProjectSwitcher />
            <Button size="sm" variant="outline" onClick={() => void load()} disabled={loading}>
              <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
              刷新
            </Button>
          </div>
        }
      />

      {error ? (
        <div className="mb-3 rounded border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
          {error}
        </div>
      ) : null}

      <Tabs defaultValue="policy" className="flex min-h-0 flex-1 flex-col">
        <TabsList className="mb-3 grid w-full max-w-md grid-cols-2">
          <TabsTrigger value="policy">范围策略</TabsTrigger>
          <TabsTrigger value="acl">行级范围</TabsTrigger>
        </TabsList>

        <div className="mb-3 flex flex-wrap items-center gap-3 rounded-lg border bg-card p-3">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-muted-foreground">主体类型</span>
            <select
              className="h-9 rounded-md border border-input bg-background px-2 text-sm"
              aria-label="主体类型过滤"
              value={subjectTypeFilter}
              onChange={(e) =>
                setSubjectTypeFilter(e.target.value as 'all' | 'global' | 'role' | 'user')
              }
            >
              <option value="all">全部</option>
              <option value="global">只看全局</option>
              <option value="role">只看角色</option>
              <option value="user">只看用户</option>
            </select>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-muted-foreground">角色</span>
            <div
              className={cn(
                (subjectTypeFilter === 'global' || subjectTypeFilter === 'user') &&
                  'pointer-events-none opacity-50',
              )}
            >
              <FilterMultiSelect
                options={roleOptions}
                value={roleFilter}
                onChange={(v) => setRoleFilter(Array.isArray(v) ? (v as string[]) : [])}
                triggerClassName="w-64"
              />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-muted-foreground">用户姓名</span>
            <Input
              className="h-9 w-56"
              placeholder="按用户姓名过滤"
              value={userKeyword}
              onChange={(e) => setUserKeyword(e.target.value)}
              disabled={subjectTypeFilter === 'global' || subjectTypeFilter === 'role'}
            />
          </div>
          <span className="text-xs text-muted-foreground">
            范围策略 {filteredPolicyRows.length} 条 · 行级范围 {filteredAclRows.length} 条
          </span>
        </div>

        <TabsContent value="policy" className="mt-0 flex min-h-0 flex-1 flex-col">
          <div className="flex min-h-0 flex-1 flex-col rounded border bg-card">
            <div className="flex items-center justify-between border-b px-3 py-2">
              <div className="flex items-center gap-2 text-[13px] font-medium">
                <ShieldCheck className="h-4 w-4 text-primary" />
                范围策略
                {selectedPolicyRows.size > 0 ? (
                  <Badge variant="secondary" className="rounded">
                    已选 {selectedPolicyRows.size}
                  </Badge>
                ) : null}
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={selectedPolicyRows.size === 0 || bulkDeleting}
                  onClick={() =>
                    void removePolicyRows(
                      filteredPolicyRows.filter((row) => selectedPolicyRows.has(row.key)),
                    )
                  }
                >
                  <Trash2 className="h-4 w-4" />
                  删除选中
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setPolicyWizardOpen(true)}
                  disabled={connectionId == null}
                >
                  <Plus className="h-4 w-4" />
                  新增范围策略
                </Button>
              </div>
            </div>
            {renderTable(
              filteredPolicyRows,
              '暂无范围策略',
              false,
              openEditPolicy,
              selectedPolicyRows,
              togglePolicySelection,
              toggleAllPolicyRows,
            )}
          </div>
        </TabsContent>

        <TabsContent value="acl" className="mt-0 flex min-h-0 flex-1 flex-col">
          <div className="flex min-h-0 flex-1 flex-col rounded border bg-card">
            <div className="flex items-center justify-between border-b px-3 py-2">
              <div className="flex items-center gap-2 text-[13px] font-medium">
                <ShieldCheck className="h-4 w-4 text-primary" />
                行级范围
                {selectedAclRows.size > 0 ? (
                  <Badge variant="secondary" className="rounded">
                    已选 {selectedAclRows.size}
                  </Badge>
                ) : null}
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={selectedAclRows.size === 0 || bulkDeleting}
                  onClick={() =>
                    void removeAclRows(filteredAclRows.filter((row) => selectedAclRows.has(row.key)))
                  }
                >
                  <Trash2 className="h-4 w-4" />
                  删除选中
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setAclWizardOpen(true)}
                  disabled={connectionId == null}
                >
                  <Plus className="h-4 w-4" />
                  新增行级范围
                </Button>
              </div>
            </div>
            {renderTable(
              filteredAclRows,
              '暂无行级范围',
              false,
              openEditAcl,
              selectedAclRows,
              toggleAclSelection,
              toggleAllAclRows,
              'acl',
            )}
          </div>
        </TabsContent>
      </Tabs>

      <AddPermissionWizard
        open={policyWizardOpen}
        target="policy"
        catalog={catalog}
        catalogLoading={catalogLoading}
        edit={editPolicyContext}
        onOpenChange={closePolicyWizard}
        onSubmit={submitPolicy}
      />
      <AddPermissionWizard
        open={aclWizardOpen}
        target="acl"
        catalog={catalog}
        catalogLoading={catalogLoading}
        edit={editAclContext}
        onOpenChange={closeAclWizard}
        onSubmit={submitAcl}
      />
    </div>
  );
}

export default IqdScopePage;
