import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Cable, Plus, RefreshCw, PlugZap, Pencil, Trash2 } from 'lucide-react';
import { connectionsApi } from '@/lib/api/connections';
import { errMsg } from '@/lib/api/client';
import { PermissionGate } from '@/components/auth/permission-gate';
import { P } from '@/lib/permissions';
import type { ReconConnection } from '@/types/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import type { ConnectionType } from '@/types/api';

const CONN_TYPES: ConnectionType[] = ['mysql', 'oracle', 'postgresql'];

const TYPE_LABEL: Record<ConnectionType, string> = {
  mysql: 'MySQL',
  oracle: 'Oracle',
  postgresql: 'PostgreSQL',
};

interface FormState {
  conn_code: string;
  name: string;
  type: ConnectionType;
  jdbc_url: string;
  username: string;
  password: string;
  db_timezone: string;
  fetch_overlap_sec: string;
}

const EMPTY_FORM: FormState = {
  conn_code: '',
  name: '',
  type: 'mysql',
  jdbc_url: '',
  username: '',
  password: '',
  db_timezone: 'Asia/Shanghai',
  fetch_overlap_sec: '300',
};

function toForm(row?: ReconConnection): FormState {
  if (!row) return EMPTY_FORM;
  return {
    conn_code: row.conn_code,
    name: row.name ?? '',
    type: row.type,
    jdbc_url: row.jdbc_url,
    username: row.username,
    password: '',
    db_timezone: row.db_timezone ?? 'Asia/Shanghai',
    fetch_overlap_sec: row.fetch_overlap_sec?.toString() ?? '300',
  };
}

function validate(f: FormState): string | null {
  if (!f.conn_code.trim()) return '连接编码必填';
  if (!f.name.trim()) return '名称必填';
  if (!f.jdbc_url.trim()) return 'JDBC URL 必填';
  if (!f.username.trim()) return '用户名必填';
  if (!f.conn_code.trim().match(/^[a-z][a-z0-9_]{0,63}$/))
    return '连接编码须为小写字母开头，仅含小写字母/数字/下划线，≤64 字符';
  const sec = Number(f.fetch_overlap_sec);
  if (!Number.isFinite(sec) || sec < 0) return '重叠窗口秒数需 ≥0';
  return null;
}

export function ConnectionsPage() {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<ReconConnection | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['connections', page],
    queryFn: () => connectionsApi.list({ page, size: 20 }),
  });

  const testMutation = useMutation({
    mutationFn: (code: string) => connectionsApi.test(code),
    // 后端 test 接口成功即 code=0（data 为 null），失败会走 onError(BizError)
    onSuccess: () => {
      toast.success('连接测试通过：连通正常');
    },
    onError: (e) => toast.error(errMsg(e)),
  });

  const deleteMutation = useMutation({
    mutationFn: (code: string) => connectionsApi.remove(code),
    onSuccess: () => {
      toast.success('连接已删除');
      qc.invalidateQueries({ queryKey: ['connections'] });
    },
    onError: (e) => toast.error(errMsg(e)),
  });

  const saveMutation = useMutation({
    mutationFn: (body: ReconConnection) =>
      editing ? connectionsApi.update(editing.conn_code, body) : connectionsApi.create(body),
    onSuccess: () => {
      toast.success(editing ? '连接已更新' : '连接已创建');
      setOpen(false);
      setEditing(null);
      qc.invalidateQueries({ queryKey: ['connections'] });
    },
    onError: (e) => setFormError(errMsg(e)),
  });

  function openCreate() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setFormError(null);
    setOpen(true);
  }

  function openEdit(row: ReconConnection) {
    setEditing(row);
    setForm(toForm(row));
    setFormError(null);
    setOpen(true);
  }

  function submit() {
    const err = validate(form);
    if (err) {
      setFormError(err);
      return;
    }
    setFormError(null);
    saveMutation.mutate({
      conn_code: form.conn_code.trim(),
      name: form.name.trim(),
      type: form.type,
      jdbc_url: form.jdbc_url.trim(),
      username: form.username.trim(),
      password: form.password || undefined,
      enabled: 1,
      db_timezone: form.db_timezone || undefined,
      fetch_overlap_sec: Number(form.fetch_overlap_sec),
    });
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Cable className="h-4 w-4 text-primary" />
              连接管理
            </CardTitle>
            <CardDescription>业务库连接（MySQL / Oracle / PostgreSQL），数据源引用连接拉取源数据</CardDescription>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              <RefreshCw className="mr-1 h-3.5 w-3.5" /> 刷新
            </Button>
            <Button size="sm" onClick={openCreate}>
              <Plus className="mr-1 h-3.5 w-3.5" /> 新建连接
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>编码</TableHead>
                <TableHead>名称</TableHead>
                <TableHead>类型</TableHead>
                <TableHead className="max-w-[260px]">JDBC URL</TableHead>
                <TableHead>用户</TableHead>
                <TableHead>状态</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow>
                  <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                    加载中…
                  </TableCell>
                </TableRow>
              )}
              {!isLoading && (data?.list.length ?? 0) === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                    暂无连接，点击「新建连接」创建
                  </TableCell>
                </TableRow>
              )}
              {data?.list.map((row) => (
                <TableRow key={row.conn_code}>
                  <TableCell className="font-medium">{row.conn_code}</TableCell>
                  <TableCell>{row.name}</TableCell>
                  <TableCell>
                    <Badge variant="secondary">{TYPE_LABEL[row.type]}</Badge>
                  </TableCell>
                  <TableCell className="max-w-[260px] truncate font-mono text-xs" title={row.jdbc_url}>
                    {row.jdbc_url}
                  </TableCell>
                  <TableCell>{row.username}</TableCell>
                  <TableCell>
                    {row.enabled === 1 ? (
                      <Badge variant="success">启用</Badge>
                    ) : (
                      <Badge variant="outline">停用</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        title="测试连接"
                        onClick={() => testMutation.mutate(row.conn_code)}
                      >
                        <PlugZap className="h-4 w-4 text-success" />
                      </Button>
                      <Button variant="ghost" size="icon" title="编辑" onClick={() => openEdit(row)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <PermissionGate permission={P.CONNECTION.DELETE}>
                        <Button
                          variant="ghost"
                          size="icon"
                          title="删除"
                          onClick={() => {
                            if (confirm(`确认删除连接 ${row.conn_code}？`)) deleteMutation.mutate(row.conn_code);
                          }}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </PermissionGate>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {(data?.pages ?? 1) > 1 && (
            <div className="mt-3 flex items-center justify-between text-[13px] text-muted-foreground">
              <span>
                共 {data?.total ?? 0} 条 · 第 {page}/{data?.pages ?? 1} 页
              </span>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => p - 1)}
                >
                  上一页
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= (data?.pages ?? 1)}
                  onClick={() => setPage((p) => p + 1)}
                >
                  下一页
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editing ? `编辑连接 ${editing.conn_code}` : '新建连接'}</DialogTitle>
            <DialogDescription>连接用于数据源拉取（只读）。密码留空表示保持不变。</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <Tabs defaultValue="basic">
              <TabsList>
                <TabsTrigger value="basic">基本信息</TabsTrigger>
                <TabsTrigger value="advanced">高级</TabsTrigger>
              </TabsList>
              <TabsContent value="basic" className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>连接编码 *</Label>
                  <Input
                    value={form.conn_code}
                    disabled={!!editing}
                    placeholder="如 mysql_huadi2"
                    onChange={(e) => setForm({ ...form, conn_code: e.target.value })}
                  />
                  <p className="text-xs text-muted-foreground">小写字母开头，仅含小写字母/数字/下划线，≤64 字符（snake_case）</p>
                </div>
                <div className="space-y-1.5">
                  <Label>名称 *</Label>
                  <Input
                    value={form.name}
                    placeholder="如 华迪2库"
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>库型 *</Label>
                  <select
                    className="flex h-9 w-full rounded-md border border-input bg-card px-3 text-sm"
                    value={form.type}
                    onChange={(e) => setForm({ ...form, type: e.target.value as ConnectionType })}
                  >
                    {CONN_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {TYPE_LABEL[t]}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label>用户名 *</Label>
                  <Input
                    value={form.username}
                    placeholder="只读账号"
                    onChange={(e) => setForm({ ...form, username: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>密码{editing ? '（留空不改）' : ' *'}</Label>
                  <Input
                    type="password"
                    value={form.password}
                    onChange={(e) => setForm({ ...form, password: e.target.value })}
                  />
                </div>
                <div className="col-span-2 space-y-1.5">
                  <Label>JDBC URL *</Label>
                  <Input
                    value={form.jdbc_url}
                    placeholder="jdbc:mysql://10.254.16.6:3306/huadi2"
                    className="font-mono text-xs"
                    onChange={(e) => setForm({ ...form, jdbc_url: e.target.value })}
                  />
                </div>
              </TabsContent>
              <TabsContent value="advanced" className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>时区</Label>
                  <Input
                    value={form.db_timezone}
                    onChange={(e) => setForm({ ...form, db_timezone: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>拉取重叠窗口（秒）</Label>
                  <Input
                    value={form.fetch_overlap_sec}
                    onChange={(e) => setForm({ ...form, fetch_overlap_sec: e.target.value })}
                  />
                </div>
              </TabsContent>
            </Tabs>
            {formError && <div className="rounded-md bg-destructive/10 px-3 py-2 text-[13px] text-destructive">{formError}</div>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              取消
            </Button>
            <PermissionGate permission={P.CONNECTION.WRITE}>
              <Button onClick={submit} disabled={saveMutation.isPending}>
                {saveMutation.isPending ? '保存中…' : '保存'}
              </Button>
            </PermissionGate>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
