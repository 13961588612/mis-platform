import { useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DeptTreeSelect } from '@/components/common/dept-tree-select';
import { FilterMultiSelect } from '@/components/common/filter-multi-select';
import { HEADER_ACTION_BTN_CLASS } from '@/components/common/header-action-buttons';
import { StatusBadge } from '@/components/common/list-page-skeleton';
import { listEmployees } from '@/lib/api/employees';
import { listOrgs } from '@/lib/api/orgs';
import { checkEmployeeBinding } from '@/lib/api/users';
import { cn } from '@/lib/utils';
import type { EmployeeItem, OrgItem } from '@/types/api';
import {
  EMPLOYEE_STATUS_ENABLED,
  employeeStatusText,
  employeeStatusTone,
  genderText,
  hasAnyFilterCondition,
  isEmployeeSelectable,
  primaryDeptLabel,
} from './employee-picker-utils';

const fieldLabel = 'mb-1 block text-xs font-medium text-muted-foreground';
const filterControlClass = 'h-9 min-h-9 py-0';

interface EmployeePickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 所属 APP id：用于员工绑定预检（D1，同 APP 内 employeeId 唯一） */
  appId?: number;
  /** 编辑场景传当前用户 id，预检时排除自身 */
  excludeUserId?: string;
  /** 选中员工回调：父组件据此自动填充手机号 / 姓名 / 邮箱 */
  onPicked: (emp: EmployeeItem) => void;
}

interface PickerFilters {
  realName: string;
  phone: string;
  orgIds: (string | number)[];
  deptIds: (string | number)[];
  status: number | '';
}

function emptyFilters(): PickerFilters {
  return {
    realName: '',
    phone: '',
    orgIds: [],
    deptIds: [],
    status: EMPLOYEE_STATUS_ENABLED,
  };
}

/**
 * 员工选择对话框（强制绑定场景下替代原「手机号失焦检测」）。
 *
 * <p>筛选对齐员工管理：姓名 / 手机 / 组织 / 部门 / 状态；结果用表格展示，
 * 选中一行后提交。不自动查询——须输入至少一个查询条件；禁用/锁定员工
 * 可见但不可选（仅启用可绑定）。</p>
 */
export function EmployeePickerDialog({
  open,
  onOpenChange,
  appId,
  excludeUserId,
  onPicked,
}: EmployeePickerDialogProps) {
  const [filters, setFilters] = useState<PickerFilters>(emptyFilters);
  const [orgs, setOrgs] = useState<OrgItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [list, setList] = useState<EmployeeItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [searched, setSearched] = useState(false);

  useEffect(() => {
    if (!open) {
      setFilters(emptyFilters());
      setList([]);
      setSelectedId(null);
      setSearched(false);
      setPicking(false);
      return;
    }
    setFilters(emptyFilters());
    setList([]);
    setSelectedId(null);
    setSearched(false);
    // 不自动查询：须由用户输入至少一个查询条件后再查询
    void listOrgs()
      .then(setOrgs)
      .catch(() => setOrgs([]));
  }, [open]);

  async function doSearch(next: PickerFilters = filters) {
    if (!hasAnyFilterCondition(next)) {
      setList([]);
      setSearched(false);
      toast.warning('请至少输入一个查询条件');
      return;
    }
    setLoading(true);
    setSelectedId(null);
    try {
      const employees = await listEmployees({
        realName: next.realName.trim() || undefined,
        phone: next.phone.trim() || undefined,
        orgIds: next.orgIds,
        deptIds: next.deptIds,
        status: next.status === '' ? undefined : next.status,
      });
      setList(employees);
      setSearched(true);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '查询员工失败');
    } finally {
      setLoading(false);
    }
  }

  function resetFilters() {
    const next = emptyFilters();
    setFilters(next);
    setList([]);
    setSelectedId(null);
    setSearched(false);
  }

  function selectRow(emp: EmployeeItem) {
    if (!isEmployeeSelectable(emp)) {
      toast.warning('只能选择启用状态的员工');
      return;
    }
    setSelectedId(emp.id);
  }

  async function confirmPick() {
    const emp = list.find((e) => e.id === selectedId);
    if (!emp) {
      toast.warning('请先在表格中选中一行');
      return;
    }
    if (!isEmployeeSelectable(emp)) {
      toast.warning('只能选择启用状态的员工');
      return;
    }
    if (!appId) {
      toast.warning('请先在表单选择所属应用');
      return;
    }
    setPicking(true);
    try {
      const check = await checkEmployeeBinding(appId, Number(emp.id), excludeUserId);
      if (check.exists) {
        toast.error('该员工已在当前应用绑定其他账号，请更换');
        return;
      }
      onPicked(emp);
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '校验员工绑定失败');
    } finally {
      setPicking(false);
    }
  }

  const selected = list.find((e) => e.id === selectedId);
  const canSubmit = !!selected && isEmployeeSelectable(selected) && !picking;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[88vh] max-w-5xl flex-col overflow-hidden">
        <DialogHeader className="shrink-0">
          <DialogTitle>选择员工</DialogTitle>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-3">
          <div className="shrink-0 rounded-lg border bg-card">
            <div className="flex flex-wrap items-end gap-2 p-3">
              <div className="w-32 shrink-0">
                <label className={fieldLabel}>姓名</label>
                <Input
                  value={filters.realName}
                  onChange={(e) => setFilters((prev) => ({ ...prev, realName: e.target.value }))}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void doSearch();
                  }}
                  placeholder="姓名"
                  className="h-9"
                />
              </div>
              <div className="w-36 shrink-0">
                <label className={fieldLabel}>手机</label>
                <Input
                  value={filters.phone}
                  onChange={(e) => setFilters((prev) => ({ ...prev, phone: e.target.value }))}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void doSearch();
                  }}
                  placeholder="手机号"
                  className="h-9"
                />
              </div>
              <div className="min-w-[12rem] flex-[1.4]">
                <label className={fieldLabel}>组织</label>
                <FilterMultiSelect
                  options={orgs.map((o) => ({ label: o.name, value: o.id }))}
                  value={filters.orgIds}
                  onChange={(v) =>
                    setFilters((prev) => ({
                      ...prev,
                      orgIds: Array.isArray(v) ? (v as (string | number)[]) : [],
                    }))
                  }
                  triggerClassName={filterControlClass}
                />
              </div>
              <div className="min-w-[12rem] flex-[1.4]">
                <label className={fieldLabel}>部门</label>
                <DeptTreeSelect
                  multiple
                  value={filters.deptIds}
                  onChange={(v) => setFilters((prev) => ({ ...prev, deptIds: v }))}
                  className={filterControlClass}
                />
              </div>
              <div className="w-28 shrink-0">
                <label className={fieldLabel}>状态</label>
                <select
                  className={cn(
                    'w-full rounded-md border border-input bg-card px-3 text-sm text-foreground',
                    filterControlClass,
                  )}
                  value={filters.status === '' ? '' : String(filters.status)}
                  onChange={(e) =>
                    setFilters((prev) => ({
                      ...prev,
                      status: e.target.value === '' ? '' : Number(e.target.value),
                    }))
                  }
                >
                  <option value="">全部</option>
                  <option value="1">启用</option>
                  <option value="0">禁用</option>
                  <option value="2">锁定</option>
                </select>
              </div>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                className={HEADER_ACTION_BTN_CLASS}
                onClick={() => void doSearch()}
                disabled={loading || !hasAnyFilterCondition(filters)}
              >
                <Search className="h-4 w-4" />
                查询
              </Button>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                className={HEADER_ACTION_BTN_CLASS}
                onClick={resetFilters}
                disabled={loading}
              >
                重置
              </Button>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-auto rounded-md border bg-card">
            <table className="w-full border-separate border-spacing-0 text-sm">
              <thead className="sticky top-0 bg-table-header text-left text-muted-foreground">
                <tr>
                  <th className="w-10 px-3 py-2 text-[13px] font-bold" />
                  <th className="whitespace-nowrap px-3 py-2 text-[13px] font-bold">手机</th>
                  <th className="whitespace-nowrap px-3 py-2 text-[13px] font-bold">姓名</th>
                  <th className="whitespace-nowrap px-3 py-2 text-[13px] font-bold">工号</th>
                  <th className="whitespace-nowrap px-3 py-2 text-[13px] font-bold">性别</th>
                  <th className="whitespace-nowrap px-3 py-2 text-[13px] font-bold">主部门</th>
                  <th className="whitespace-nowrap px-3 py-2 text-[13px] font-bold">状态</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={7} className="px-3 py-10 text-center text-muted-foreground">
                      加载中…
                    </td>
                  </tr>
                ) : list.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-3 py-10 text-center text-muted-foreground">
                      {searched ? '暂无数据' : '请至少输入一个查询条件'}
                    </td>
                  </tr>
                ) : (
                  list.map((emp) => {
                    const selectable = isEmployeeSelectable(emp);
                    const checked = selectedId === emp.id;
                    return (
                      <tr
                        key={emp.id}
                        onClick={() => selectRow(emp)}
                        className={cn(
                          'border-b border-border/50 last:border-0 bg-table-row even:bg-table-stripe',
                          selectable ? 'cursor-pointer hover:bg-table-hover' : 'cursor-not-allowed opacity-60',
                          checked && 'bg-primary/10 even:bg-primary/10',
                        )}
                      >
                        <td className="px-3 py-2">
                          <input
                            type="radio"
                            name="employee-picker-row"
                            checked={checked}
                            disabled={!selectable || picking}
                            onChange={() => selectRow(emp)}
                            onClick={(e) => e.stopPropagation()}
                            aria-label={`选择 ${emp.realName}`}
                          />
                        </td>
                        <td className="px-3 py-2">{emp.phone ?? '—'}</td>
                        <td className="px-3 py-2 font-medium">{emp.realName}</td>
                        <td className="px-3 py-2">{emp.employeeNo || '—'}</td>
                        <td className="px-3 py-2">{genderText(emp.gender)}</td>
                        <td className="px-3 py-2">{primaryDeptLabel(emp)}</td>
                        <td className="px-3 py-2">
                          <StatusBadge
                            tone={employeeStatusTone(emp.status)}
                            text={employeeStatusText(emp.status)}
                          />
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
          <p className="shrink-0 text-xs text-muted-foreground">仅可选择启用状态的员工；禁用或锁定行不可提交。</p>
        </div>

        <DialogFooter className="shrink-0">
          <Button type="button" onClick={() => void confirmPick()} disabled={!canSubmit}>
            {picking ? '校验中…' : '确定'}
          </Button>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
