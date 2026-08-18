import { useState } from 'react';
import { Search, UserCheck } from 'lucide-react';
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
import { listEmployees } from '@/lib/api/employees';
import { checkEmployeeBinding } from '@/lib/api/users';
import type { EmployeeItem } from '@/types/api';

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

/**
 * 员工选择对话框（强制绑定场景下替代原「手机号失焦检测」）。
 *
 * <p>按姓名搜索员工，选中后调用后端 {@code check-employee-binding} 预检同 APP 重复绑定，
 * 通过后将员工信息回传父组件自动填充，保证手机号 / 姓名 / 邮箱 与员工主数据一致。</p>
 */
export function EmployeePickerDialog({
  open,
  onOpenChange,
  appId,
  excludeUserId,
  onPicked,
}: EmployeePickerDialogProps) {
  const [keyword, setKeyword] = useState('');
  const [loading, setLoading] = useState(false);
  const [list, setList] = useState<EmployeeItem[]>([]);
  const [picking, setPicking] = useState(false);

  async function doSearch() {
    const kw = keyword.trim();
    if (!kw) {
      setList([]);
      return;
    }
    setLoading(true);
    try {
      const employees = await listEmployees({ realName: kw });
      setList(employees);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '查询员工失败');
    } finally {
      setLoading(false);
    }
  }

  async function pick(emp: EmployeeItem) {
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

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          setKeyword('');
          setList([]);
        }
        onOpenChange(o);
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>绑定员工</DialogTitle>
        </DialogHeader>
        <div className="flex items-center gap-2">
          <Input
            value={keyword}
            placeholder="按姓名搜索员工"
            onChange={(e) => setKeyword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void doSearch();
            }}
            className="h-9"
          />
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => void doSearch()}
            disabled={loading}
          >
            <Search className="h-4 w-4" />
            搜索
          </Button>
        </div>
        <div className="max-h-72 space-y-1 overflow-auto rounded-md border p-2">
          {loading ? (
            <p className="py-6 text-center text-sm text-muted-foreground">加载中…</p>
          ) : list.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">输入姓名搜索员工</p>
          ) : (
            list.map((emp) => (
              <button
                type="button"
                key={emp.id}
                disabled={picking}
                onClick={() => void pick(emp)}
                className="flex w-full items-center justify-between gap-2 rounded-md border border-border/60 bg-background px-3 py-2 text-left text-sm hover:bg-accent"
              >
                <span className="font-medium">{emp.realName}</span>
                <span className="text-xs text-muted-foreground">{emp.phone ?? '—'}</span>
                <span className="text-xs text-muted-foreground">{emp.employeeNo}</span>
                <UserCheck className="h-4 w-4 shrink-0 text-muted-foreground" />
              </button>
            ))
          )}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
