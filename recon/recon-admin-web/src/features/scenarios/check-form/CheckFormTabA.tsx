import { Plus, Trash2, ChevronDown } from 'lucide-react';
import type { ReconDatasource } from '@/types/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { DateTimeInput } from '@/components/ui/datetime-input';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  deriveWindowExpr,
  EMPTY_SUMMARY,
  nextKey,
  RELATIVE_PRESETS,
} from './types';
import type {
  ConsumeMode,
  ConsumeRow,
  SummaryWindowState,
  TabAState,
} from './types';

/* ---------------- 汇总窗口子组件 ---------------- */

function SummaryWindow({
  value,
  onChange,
}: {
  value: SummaryWindowState;
  onChange: (w: SummaryWindowState) => void;
}) {
  return (
    <div className="space-y-3 rounded-md border border-primary/20 bg-primary/5 p-4">
      <div className="flex items-center justify-between">
        <p className="text-[13px] text-foreground">
          窗口范围在 check 级配置一次，自动应用到所有 time_window 数据源（两侧必须同一窗口）
        </p>
        <div className="flex items-center gap-2">
          <Switch
            checked={value.kind === 'absolute'}
            onCheckedChange={(b) =>
              onChange({ ...value, kind: b ? 'absolute' : 'relative' })
            }
          />
          <span className="text-xs text-muted-foreground">
            {value.kind === 'absolute' ? '绝对窗口（yyyy-MM-dd HH:mm:ss）' : '相对窗口（默认）'}
          </span>
        </div>
      </div>

      {value.kind === 'relative' ? (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {Object.entries(RELATIVE_PRESETS).map(([k, p]) => (
              <Button
                key={k}
                type="button"
                size="sm"
                variant={value.relative.preset === k ? 'default' : 'outline'}
                onClick={() =>
                  onChange({ ...value, relative: { ...value.relative, preset: k as SummaryWindowState['relative']['preset'] } })
                }
              >
                {p.label}
              </Button>
            ))}
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm">自定义</span>
            <Input
              type="number"
              min={1}
              className="w-24"
              placeholder="N"
              value={value.relative.customDays || ''}
              onChange={(e) =>
                onChange({
                  ...value,
                  relative: { ...value.relative, customDays: Number(e.target.value) },
                })
              }
            />
            <span className="text-sm text-muted-foreground">
              天前 ~ 结束（落库 = {'{recon_time}'}-Nd）
            </span>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-end gap-3">
          {(['start', 'end'] as const).map((side) => (
            <DateTimeInput
              key={side}
              label={side === 'start' ? '起始时间' : '结束时间'}
              en={side === 'start' ? 'window_start' : 'window_end'}
              className="w-60"
              value={value.absolute[side]}
              onChange={(v) =>
                onChange({
                  ...value,
                  absolute: { ...value.absolute, [side]: v },
                })
              }
            />
          ))}
          <p className="text-xs text-muted-foreground">保存校验 end &gt; start</p>
        </div>
      )}

      <div className="rounded-md bg-card px-3 py-2 font-mono text-xs">
        预览：start:{' '}
        <span className="text-primary">{value.startExpr || '—'}</span> &nbsp;
        end: <span className="text-primary">{value.endExpr || '—'}</span>
      </div>
    </div>
  );
}

/* ---------------- Tab A 主组件 ---------------- */

export function CheckFormTabA({
  state,
  onChange,
  dsOptions,
  editing = false,
  strategy = 'exact_key',
}: {
  state: TabAState;
  onChange: (v: TabAState) => void;
  /** 可用数据源（下拉选项） */
  dsOptions: ReconDatasource[];
  /** 编辑态：锁定 check_name（创建后禁改） */
  editing?: boolean;
  /** 当前匹配策略：sum_check → 恰好 1 源、mode 锁定 incremental、行角色唯一；custom_check → 1~N 源无角色 */
  strategy?: 'exact_key' | 'composite_key' | 'sum_check' | 'custom' | 'custom_check';
}) {
  const isSum = strategy === 'sum_check';
  const isCustomCheck = strategy === 'custom_check';
  const hasTimeWindow = state.rows.some((r) => r.mode === 'time_window');
  const mode: ConsumeMode = state.rows[0]?.mode ?? 'incremental';

  const setRows = (rows: ConsumeRow[]) => onChange({ ...state, rows });

  /** mode 一致性（A-R2-04）：任一行动作，全行同步；离开 time_window 时清空汇总窗口 */
  const syncMode = (m: ConsumeMode) => {
    const rows = state.rows.map((r) => ({ ...r, mode: m }));
    let window = state.window;
    if (m === 'time_window') {
      // 首次进入：默认预设（昨天全天）立即派生表达式，预览不落空
      if (!window) {
        const fresh = { ...EMPTY_SUMMARY };
        const { startExpr, endExpr } = deriveWindowExpr(fresh);
        window = { ...fresh, startExpr, endExpr };
      }
    } else {
      window = null;
    }
    onChange({ ...state, rows, window });
  };

  /** 汇总窗口变更：派生出实时表达式后回填 */
  const applyWindow = (w: SummaryWindowState) => {
    const { startExpr, endExpr } = deriveWindowExpr(w);
    onChange({ ...state, window: { ...w, startExpr, endExpr } });
  };

  const addRow = () => {
    const ds = dsOptions[0];
    setRows([
      ...state.rows,
      {
        key: nextKey(),
        ds_code: ds?.ds_code ?? '',
        mode: 'incremental',
        time_field: ds?.time_field,
      },
    ]);
  };

  const updateRow = (key: string, patch: Partial<ConsumeRow>) => {
    setRows(state.rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  };

  const removeRow = (key: string) => {
    setRows(state.rows.filter((r) => r.key !== key));
  };

  return (
    <div className="space-y-5">
      {/* 基本信息 */}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label>
            检查名称 <span className="en">check_name</span> *
          </Label>
          <Input
            value={state.check_name}
            disabled={editing}
            placeholder="如 微信支付金额核对"
            onChange={(e) => onChange({ ...state, check_name: e.target.value })}
          />
          <p className="f-note">场景内唯一；创建后不可修改</p>
        </div>
        <div className="space-y-1.5">
          <Label>
            序号 <span className="en">seq_no</span>
          </Label>
          <Input
            value={state.seq_no}
            onChange={(e) =>
              onChange({ ...state, seq_no: e.target.value.replace(/\D/g, '') })
            }
          />
          <p className="f-note">决定场景内执行顺序</p>
        </div>
      </div>

      {/* 汇总窗口块（仅存在 time_window 数据源时显示） */}
      {hasTimeWindow && (
        <SummaryWindow
          value={state.window ?? { ...EMPTY_SUMMARY }}
          onChange={applyWindow}
        />
      )}

      {/* 消费模式清单（数据源清单唯一入口） */}
      <div className="space-y-2">
        {/* 头部：标题 + 模式 + 说明 + 新增 */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Label className="text-sm">消费模式 <span className="en">consume</span></Label>
            {isSum ? (
              <div className="flex h-8 items-center gap-2 rounded-md border border-input bg-muted px-3 text-sm">
                <span className="font-medium">增量</span>
                <span className="val">incremental</span>
                <span className="f-note">sum_check 单数据源内部勾稽，锁定增量模式</span>
              </div>
            ) : (
              <Select value={mode} onValueChange={(m) => syncMode(m as ConsumeMode)}>
                <SelectTrigger className="h-8 w-40">
                  <SelectValue />
                  <ChevronDown className="ml-1 h-3.5 w-3.5 opacity-60" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="incremental">
                    增量 <span className="val">incremental</span>
                  </SelectItem>
                  <SelectItem value="time_window">
                    时间窗口 <span className="val">time_window</span>
                  </SelectItem>
                </SelectContent>
              </Select>
            )}
            <span className="f-note">全 check 内必须一致</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-muted-foreground">
              {isSum
                ? '单数据源内部勾稽，清单仅需 1 行（唯一）'
                : isCustomCheck
                  ? '整检查自定义 custom_check：清单 1~N 行，无左右角色'
                  : '左右角色 = 清单顺序（第 1 行 = 左、第 2 行 = 右）'}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isSum ? state.rows.length >= 1 : isCustomCheck ? false : state.rows.length >= 2}
              onClick={addRow}
              title={isSum ? 'sum_check 恰好 1 个数据源' : isCustomCheck ? 'custom_check 1~N 个数据源' : undefined}
            >
              <Plus className="mr-1 h-3.5 w-3.5" /> 新增数据源
            </Button>
          </div>
        </div>

        <div className="space-y-3">
          {state.rows.length === 0 && (
            <div className="rounded-md border border-dashed p-6 text-center text-[13px] text-muted-foreground">
              {isSum
                ? '尚未选择参与数据源，点击「新增数据源」添加（sum_check 恰好 1 个）'
                : isCustomCheck
                  ? '尚未选择参与数据源，点击「新增数据源」添加（custom_check 1~N 个）'
                  : '尚未选择参与数据源，点击「新增数据源」添加（第一批恰好 2 个）'}
            </div>
          )}
          {state.rows.map((row, i) => (
            <div key={row.key} className="rounded-md border bg-card">
              {/* 行头：角色 badge + 别名 + 操作 */}
              <div className="flex items-center justify-between gap-3 border-b px-3 py-2">
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="font-mono text-[10px]">
                    第 {i + 1} 行
                  </Badge>
                  {isSum ? (
                    <Badge variant="secondary" className="text-[10px]">
                      {state.rows.length === 1 ? '唯一 · 第 1 行' : '单源内部勾稽'}
                    </Badge>
                  ) : (
                    <Badge
                      variant={i === 0 ? 'secondary' : 'default'}
                      className="text-[10px]"
                    >
                      {i === 0 ? '左（左侧）' : '右（右侧）'}
                    </Badge>
                  )}
                  <span className="text-xs text-muted-foreground">
                    数据集别名恒 = ds_code，无需配置
                  </span>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  disabled={isSum ? state.rows.length <= 1 : isCustomCheck ? state.rows.length <= 1 : state.rows.length <= 2}
                  onClick={() => removeRow(row.key)}
                  title="移除该行"
                >
                  <Trash2 className="h-3.5 w-3.5 text-destructive" />
                </Button>
              </div>

              {/* 行体：两列栅格对齐 */}
              <div className="grid grid-cols-2 gap-x-4 gap-y-3 px-3 py-3">
                {/* 左侧列 */}
                <div className="space-y-1.5">
                  <Label className="text-xs">
                    数据源 <span className="en">ds_code</span>
                  </Label>
                  <Select
                    value={row.ds_code}
                    onValueChange={(dsCode) => {
                      const ds = dsOptions.find((x) => x.ds_code === dsCode);
                      updateRow(row.key, {
                        ds_code: dsCode,
                        time_field: ds?.time_field,
                      });
                    }}
                  >
                    <SelectTrigger className="w-full max-w-xs overflow-hidden text-ellipsis">
                      <SelectValue placeholder="选择数据源" />
                    </SelectTrigger>
                    <SelectContent>
                      {dsOptions.map((ds) => (
                        <SelectItem key={ds.ds_code} value={ds.ds_code}>
                          {ds.name || ds.ds_code} · {ds.ds_code}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* 时间字段（只读，取自数据源声明） */}
                <div className="space-y-1.5">
                  <Label className="text-xs">
                    时间字段 <span className="en">time_field</span>
                  </Label>
                  <Input
                    className="bg-muted font-mono text-xs"
                    value={row.time_field || '-'}
                    readOnly
                    title="取自数据源声明的 time_field"
                  />
                  <p className="f-note">取自数据源声明，无需配置</p>
                </div>

                {/* 窗口状态说明 */}
                <div className="space-y-1.5">
                  <Label className="text-xs">模式说明</Label>
                  <div className="rounded-md bg-muted px-3 py-2 font-mono text-xs">
                    {row.mode === 'time_window' ? (
                      <span className="text-primary">
                        窗口：继承（自动带入 check 级汇总窗口）
                      </span>
                    ) : (
                      <span className="text-muted-foreground">
                        靠游标增量，无窗口
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
