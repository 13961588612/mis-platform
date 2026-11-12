/**
 * DbProfilePanel.tsx —— 「数据库连接配置」Tab（Tab①，2026-09-29 分层）。
 *
 * 管理业务库连接（= wren profile 的平台登记）：name / datasource / host / port /
 * database / user / password，并支持**连通性测试**（服务端直连业务库只读探测）。
 *
 * 与「项目」的关系：profile（本面板）: project（Tab②） = 1 : N。
 * 密码只经 BFF 转投 ai-platform vault；列表/编辑**恒不回显**（只回 has_password）。
 */
import { useCallback, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Activity, Loader2, Pencil, Plus, RefreshCw, Star, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  createDbProfile,
  deleteDbProfile,
  errorCode,
  errorData,
  listDbProfiles,
  testDbProfile,
  updateDbProfile,
} from '../../api/iqd-modeling';
import { iqdKeys } from '../../queries/iqd-keys';
import { useIqdModelingPermission } from '../shared/usePermission';
import type { DbProfile, DbProfileSaveRequest, DbProfileTestResult } from '../../types/modeling';

const VIEW_PERM = 'iqd:config:view';
const SAVE_PERM = 'iqd:config:save';
const TEST_PERM = 'iqd:config:test';

const DB_TYPE_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'starrocks', label: 'StarRocks / Doris' },
  { value: 'mysql', label: 'MySQL / MariaDB' },
  { value: 'postgres', label: 'PostgreSQL' },
];

interface Draft {
  id: number | null;
  name: string;
  dbType: string;
  dbHost: string;
  dbPort: string;
  dbDatabase: string;
  dbUser: string;
  dbPassword: string;
  description: string;
  enabled: boolean;
  isDefault: boolean;
}

const EMPTY: Draft = {
  id: null, name: '', dbType: 'starrocks', dbHost: '', dbPort: '9030',
  dbDatabase: '', dbUser: '', dbPassword: '', description: '', enabled: true, isDefault: false,
};

function toDraft(p: DbProfile): Draft {
  return {
    id: p.id ?? null,
    name: p.name ?? '',
    dbType: p.db_type ?? 'starrocks',
    dbHost: p.db_host ?? '',
    dbPort: p.db_port != null ? String(p.db_port) : '',
    dbDatabase: p.db_database ?? '',
    dbUser: p.db_user ?? '',
    dbPassword: '',
    description: p.description ?? '',
    enabled: p.enabled !== false,
    isDefault: p.is_default === true,
  };
}

function buildPayload(d: Draft): DbProfileSaveRequest {
  const port = Number.parseInt(d.dbPort.trim(), 10);
  return {
    name: d.name.trim(),
    db_type: d.dbType.trim() || null,
    db_host: d.dbHost.trim() || null,
    db_port: Number.isFinite(port) && port > 0 && port < 65536 ? port : null,
    db_database: d.dbDatabase.trim() || null,
    db_user: d.dbUser.trim() || null,
    db_password: d.dbPassword !== '' ? d.dbPassword : null,
    description: d.description.trim() || null,
    enabled: d.enabled,
    is_default: d.isDefault,
  };
}

function missingFields(d: Draft, isCreate: boolean): string[] {
  const missing: string[] = [];
  if (d.name.trim() === '') missing.push('连接名');
  if (d.dbHost.trim() === '') missing.push('主机 host');
  if (d.dbDatabase.trim() === '') missing.push('数据库 database');
  if (d.dbUser.trim() === '') missing.push('账号 user');
  if (isCreate && d.dbPassword === '') missing.push('密码 password');
  return missing;
}

export function DbProfilePanel() {
  const queryClient = useQueryClient();
  const { hasPermission } = useIqdModelingPermission();
  const canSave = hasPermission(SAVE_PERM);
  const canTest = hasPermission(TEST_PERM);
  const canView = hasPermission(VIEW_PERM) || hasPermission(SAVE_PERM);

  const listQuery = useQuery({
    queryKey: iqdKeys.dbProfiles(),
    queryFn: listDbProfiles,
    staleTime: 15_000,
    enabled: canView,
  });
  const profiles = useMemo(() => listQuery.data ?? [], [listQuery.data]);

  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [testingId, setTestingId] = useState<number | null>(null);
  const [testResult, setTestResult] = useState<DbProfileTestResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<DbProfile | null>(null);

  const refresh = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: iqdKeys.dbProfiles() });
  }, [queryClient]);

  const runSave = async () => {
    if (!draft) return;
    const missing = missingFields(draft, draft.id == null);
    if (missing.length > 0) {
      setError(`请补全：${missing.join('、')}`);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const payload = buildPayload(draft);
      if (draft.id == null) {
        await createDbProfile(payload);
      } else {
        await updateDbProfile(draft.id, payload);
      }
      setDraft(null);
      await refresh();
    } catch (e) {
      const code = errorCode(e);
      const msg = e instanceof Error ? e.message : String(e);
      setError(code === 40900 ? `[40900] 连接名已存在：${msg}` : msg);
    } finally {
      setSaving(false);
    }
  };

  const runTest = async (p: DbProfile) => {
    if (p.id == null) return;
    setTestingId(p.id);
    setTestResult(null);
    setError(null);
    try {
      const res = await testDbProfile(p.id);
      setTestResult(res);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : '连通测试失败');
    } finally {
      setTestingId(null);
    }
  };

  const runDelete = async (p: DbProfile) => {
    if (p.id == null) return;
    setError(null);
    try {
      await deleteDbProfile(p.id);
      setConfirmDelete(null);
      await refresh();
    } catch (e) {
      const code = errorCode(e);
      const data = errorData(e);
      const deps = Array.isArray(data?.dependents) ? (data!.dependents as Array<{ name?: string }>) : [];
      const msg = e instanceof Error ? e.message : String(e);
      setError(
        code === 42200 && deps.length > 0
          ? `[42200] 被 ${deps.length} 个项目引用（${deps.map((d) => d.name ?? '?').join('、')}），无法删除`
          : msg,
      );
      setConfirmDelete(null);
    }
  };

  if (!canView) {
    return (
      <div className="py-10 text-center text-[13px] text-muted-foreground">
        当前账号无 iqd:config:view 权限，无法查看数据库连接配置。
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-[13px] text-muted-foreground">
          业务库连接（= wren profile）。密码加密存入凭据库、不回显；保存后可测试连通性。
        </p>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => void refresh()} disabled={listQuery.isLoading}>
            <RefreshCw className={listQuery.isLoading ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
            刷新
          </Button>
          {canSave && (
            <Button size="sm" onClick={() => { setError(null); setDraft({ ...EMPTY }); }}>
              <Plus className="h-4 w-4" />
              新建数据库连接
            </Button>
          )}
        </div>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertTitle className="text-[13px]">操作失败</AlertTitle>
          <AlertDescription className="text-[12px]">{error}</AlertDescription>
        </Alert>
      )}

      {testResult && (
        <Alert variant={testResult.ok ? 'default' : 'destructive'}>
          <AlertTitle className="text-[13px]">{testResult.ok ? '连通成功' : '连通失败'}</AlertTitle>
          <AlertDescription className="text-[12px]">
            {testResult.message}
            {testResult.latency_ms != null ? `（${testResult.latency_ms} ms）` : ''}
          </AlertDescription>
        </Alert>
      )}

      <div className="overflow-hidden rounded-lg border bg-card">
        <table className="w-full text-[13px]">
          <thead className="bg-muted/40">
            <tr className="text-left">
              <th className="px-3 py-2 font-medium">名称</th>
              <th className="px-3 py-2 font-medium">类型</th>
              <th className="px-3 py-2 font-medium">host:port</th>
              <th className="px-3 py-2 font-medium">库 / 账号</th>
              <th className="px-3 py-2 font-medium">上次测试</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {profiles.map((p) => (
              <tr key={p.id ?? p.name} className="border-t border-border/60">
                <td className="px-3 py-2">
                  <span className="font-medium">{p.name}</span>
                  {p.is_default && (
                    <Badge variant="secondary" className="ml-2 text-[11px]">
                      <Star className="mr-1 h-3 w-3" /> 默认
                    </Badge>
                  )}
                  {p.enabled === false && (
                    <Badge variant="outline" className="ml-2 text-[11px]">已停用</Badge>
                  )}
                </td>
                <td className="px-3 py-2 text-muted-foreground">{p.db_type ?? '—'}</td>
                <td className="px-3 py-2 text-muted-foreground">
                  {p.db_host ?? '—'}{p.db_port != null ? `:${p.db_port}` : ''}
                </td>
                <td className="px-3 py-2 text-muted-foreground">
                  {p.db_database ?? '—'} / {p.db_user ?? '—'}
                </td>
                <td className="px-3 py-2">
                  {p.last_test_ok == null ? (
                    <span className="text-muted-foreground">未测</span>
                  ) : p.last_test_ok ? (
                    <Badge variant="default" className="text-[11px]">成功</Badge>
                  ) : (
                    <Badge variant="destructive" className="text-[11px]">失败</Badge>
                  )}
                </td>
                <td className="px-3 py-2">
                  <div className="flex items-center justify-end gap-1">
                    {canTest && p.id != null && (
                      <Button
                        size="sm" variant="ghost" className="h-7 px-2 text-[12px]"
                        disabled={testingId === p.id}
                        onClick={() => void runTest(p)}
                      >
                        {testingId === p.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Activity className="h-3.5 w-3.5" />
                        )}
                        测试
                      </Button>
                    )}
                    {canSave && (
                      <Button
                        size="sm" variant="ghost" className="h-7 px-2 text-[12px]"
                        onClick={() => { setError(null); setTestResult(null); setDraft(toDraft(p)); }}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                        编辑
                      </Button>
                    )}
                    {canSave && (
                      <Button
                        size="sm" variant="ghost" className="h-7 px-2 text-[12px] text-destructive"
                        onClick={() => setConfirmDelete(p)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        删除
                      </Button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {!listQuery.isLoading && profiles.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">
                  还没有数据库连接配置。点「新建数据库连接」录入业务库参数（保存后可测试连通性）。
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Dialog open={draft != null} onOpenChange={(next) => { if (!next) setDraft(null); }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="text-[14px]">
              {draft?.id == null ? '新建数据库连接' : `编辑数据库连接「${draft?.name ?? ''}」`}
            </DialogTitle>
            <DialogDescription className="text-[12px]">
              业务库连接参数（= wren profile）。密码只写不读；编辑时留空 = 保留原密码。
            </DialogDescription>
          </DialogHeader>
          {draft && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label className="text-[13px]">连接名 *</Label>
                <Input value={draft.name} disabled={saving}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="如：销售库" />
              </div>
              <div className="space-y-1">
                <Label className="text-[13px]">数据库类型</Label>
                <Select value={draft.dbType} disabled={saving}
                  onValueChange={(v) => setDraft({ ...draft, dbType: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {DB_TYPE_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-[13px]">主机 host *</Label>
                <Input value={draft.dbHost} disabled={saving}
                  onChange={(e) => setDraft({ ...draft, dbHost: e.target.value })} placeholder="10.254.16.217" />
              </div>
              <div className="space-y-1">
                <Label className="text-[13px]">端口 port</Label>
                <Input value={draft.dbPort} disabled={saving}
                  onChange={(e) => setDraft({ ...draft, dbPort: e.target.value })} placeholder="9030" />
              </div>
              <div className="space-y-1">
                <Label className="text-[13px]">数据库 database *</Label>
                <Input value={draft.dbDatabase} disabled={saving}
                  onChange={(e) => setDraft({ ...draft, dbDatabase: e.target.value })} placeholder="adhoc" />
              </div>
              <div className="space-y-1">
                <Label className="text-[13px]">账号 user *</Label>
                <Input value={draft.dbUser} disabled={saving} autoComplete="off"
                  onChange={(e) => setDraft({ ...draft, dbUser: e.target.value })} placeholder="query" />
              </div>
              <div className="space-y-1">
                <Label className="text-[13px]">密码 password {draft.id == null ? '*' : ''}</Label>
                <Input type="password" autoComplete="new-password" value={draft.dbPassword} disabled={saving}
                  onChange={(e) => setDraft({ ...draft, dbPassword: e.target.value })}
                  placeholder={draft.id == null ? '业务库密码' : '留空 = 保留原密码'} />
              </div>
              <div className="space-y-1">
                <Label className="text-[13px]">备注</Label>
                <Input value={draft.description} disabled={saving}
                  onChange={(e) => setDraft({ ...draft, description: e.target.value })} placeholder="可选" />
              </div>
              <label className="flex items-center gap-2 sm:col-span-2">
                <input type="checkbox" className="h-4 w-4" checked={draft.enabled} disabled={saving}
                  onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })} />
                <span className="text-[12px] text-muted-foreground">启用该连接</span>
              </label>
              <label className="flex items-center gap-2 sm:col-span-2">
                <input type="checkbox" className="h-4 w-4" checked={draft.isDefault} disabled={saving}
                  onChange={(e) => setDraft({ ...draft, isDefault: e.target.checked })} />
                <span className="text-[12px] text-muted-foreground">设为新建项目时的默认连接</span>
              </label>
            </div>
          )}
          {error && (
            <Alert variant="destructive">
              <AlertTitle className="text-[13px]">保存失败</AlertTitle>
              <AlertDescription className="text-[12px]">{error}</AlertDescription>
            </Alert>
          )}
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setDraft(null)} disabled={saving}>取消</Button>
            <Button size="sm" onClick={() => void runSave()} disabled={saving}>
              {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmDelete != null} onOpenChange={(next) => { if (!next) setConfirmDelete(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-[14px]">确认删除数据库连接？</DialogTitle>
            <DialogDescription className="text-[12px]">
              将删除「{confirmDelete?.name}」。若仍被项目引用会被拒绝（需先解除引用）。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setConfirmDelete(null)}>取消</Button>
            <Button variant="destructive" size="sm"
              onClick={() => confirmDelete && void runDelete(confirmDelete)}>确认删除</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default DbProfilePanel;
