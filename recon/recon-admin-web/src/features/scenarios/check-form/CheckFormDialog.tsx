import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { checksApi } from '@/lib/api/checks';
import { datasourcesApi } from '@/lib/api/datasources';
import { errMsg } from '@/lib/api/client';
import type { MatchRule, ReconCheck } from '@/types/api';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { CheckFormTabA } from './CheckFormTabA';
import { MatchFormTabB } from './MatchFormTabB';
import { CompareFormTabC } from './CompareFormTabC';
import {
  buildTabAPayload,
  buildTabBPayload,
  EMPTY_TAB_A,
  EMPTY_TAB_B,
  EMPTY_TAB_C,
  isJsonObject,
  parseKeySideFields,
  serializeRules,
  serializeSumRules,
  tabAFromCheck,
  tabBFromMatch,
  tabCFromCompare,
  validateJsonText,
  validateSumExpr,
  validateTabA,
} from './types';
import type { KeySide, TabAState, TabBState, TabCState } from './types';

/**
 * 检查配置弹窗（§4.4 三 Tab）：
 * - Tab A：基本信息 + 消费模式（CheckFormTabA）
 * - Tab B：匹配规则（MatchFormTabB，结构化：匹配键模板 / 字段归一 / 同键多行）
 * - Tab C：比较规则（CompareFormTabC，结构化：逐条比较规则）
 * 保存时：consume_json / windowStart / windowEnd / datasets_json 均由 Tab A 派生。
 */
export function CheckFormDialog({
  open,
  onOpenChange,
  scenarioCode,
  editing,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  scenarioCode: string;
  editing: ReconCheck | null;
}) {
  const qc = useQueryClient();

  /* 数据源下拉选项（Tab A 清单选择用） */
  const { data: dss } = useQuery({
    queryKey: ['datasources-options'],
    queryFn: () => datasourcesApi.list({ page: 1, size: 200 }),
    enabled: open,
  });
  const dsOptions = dss?.list ?? [];

  /* 三 Tab 结构化状态 */
  const [tabA, setTabA] = useState<TabAState>(EMPTY_TAB_A);
  const [tabB, setTabB] = useState<TabBState>(EMPTY_TAB_B);
  const [tabC, setTabC] = useState<TabCState>(EMPTY_TAB_C);

  const [enabled, setEnabled] = useState<number>(1);
  const [err, setErr] = useState<string | null>(null);

  /* 打开时按 新建/编辑 初始化 */
  useEffect(() => {
    if (!open) return;
    if (editing) {
      setTabA(tabAFromCheck(editing));
      setTabB(tabBFromMatch(editing.match_rule));
      setTabC(tabCFromCompare(editing.compare_rule));
      setEnabled(editing.enabled ?? 1);
    } else {
      setTabA({ ...EMPTY_TAB_A });
      setTabB({ ...EMPTY_TAB_B });
      setTabC({ ...EMPTY_TAB_C });
      setEnabled(1);
    }
    setErr(null);
  }, [open, editing]);

  const save = useMutation({
    mutationFn: (body: ReconCheck) =>
      editing ? checksApi.update(scenarioCode, editing.check_name, body) : checksApi.create(body),
    onSuccess: () => {
      toast.success(editing ? '检查已更新' : '检查已创建');
      onOpenChange(false);
      qc.invalidateQueries({ queryKey: ['checks', scenarioCode] });
    },
    onError: (e) => setErr(errMsg(e)),
  });

  function submit() {
    const v = validateTabA(tabA, tabB.strategy);
    if (v) {
      setErr(v);
      return;
    }
    setErr(null);

    const tab = buildTabAPayload(tabA);
    const isSum = tabB.strategy === 'sum_check';
    const isCustom = tabB.strategy === 'custom' || tabB.strategy === 'custom_check';

    /* sum_check：勾稽规则至少 1 条、每条 left/right 必填 + 表达式语法/引用合法 */
    if (isSum) {
      const rows = tabC.sumRules;
      if (!rows.length) {
        setErr('汇总校验 sum_check 至少需要 1 条勾稽规则（Tab C 配置）');
        return;
      }
      const alias = tabBAliases[0] ?? '';
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        if (!r.left_expr.trim() || !r.right_expr.trim()) {
          setErr(`勾稽规则第 ${i + 1} 条 left_expr / right_expr 必填`);
          return;
        }
        const errL = validateSumExpr(r.left_expr, alias, sumFields);
        if (errL) {
          setErr(`勾稽规则第 ${i + 1} 条 left_expr：${errL}`);
          return;
        }
        const errR = validateSumExpr(r.right_expr, alias, sumFields);
        if (errR) {
          setErr(`勾稽规则第 ${i + 1} 条 right_expr：${errR}`);
          return;
        }
      }
    }

    /* custom / custom_check：类名必填 + 参数 JSON 合法（需求 §3.6） */
    if (isCustom) {
      if (!tabB.customClass.trim()) {
        setErr('自定义类名必填');
        return;
      }
      if (validateJsonText(tabB.configJson) || (tabB.configJson.trim() && !isJsonObject(tabB.configJson))) {
        setErr('参数 JSON 格式错误（config_json 须为 JSON 对象）');
        return;
      }
      /* custom 保留比较规则表：custom 行比较器类名必填 + 行级参数 JSON 合法 */
      if (tabB.strategy === 'custom') {
        for (let i = 0; i < tabC.rules.length; i++) {
          const r = tabC.rules[i];
          if (r.compare_mode !== 'custom') continue;
          if (!r.comparator_class.trim()) {
            setErr(`比较规则第 ${i + 1} 行：比较器类名必填`);
            return;
          }
          if (validateJsonText(r.comparator_params) || (r.comparator_params.trim() && !isJsonObject(r.comparator_params))) {
            setErr(`比较规则第 ${i + 1} 行：参数 JSON 格式错误`);
            return;
          }
        }
      }
    }

    /* 落库：sum_check 无匹配键/归一/多行，rules_json 为勾稽表达式；custom/custom_check 整体自定义；两两策略沿用结构化装配 */
    let match: MatchRule;
    let compare: { rules_json: string };
    if (isSum) {
      // sum_check 不产生 key_fields_json（后端 json 列不接受空串，落库 NULL）
      match = { strategy: 'sum_check', datasets_json: tab.datasets_json };
      compare = { rules_json: serializeSumRules(tabC.sumRules) };
    } else if (isCustom) {
      // custom / custom_check：custom_class + config_json 落库；custom_check 无规则表 → rules_json 空数组（需求 §3.7）
      match = buildTabBPayload(tabB, {
        strategy: tabB.strategy,
        datasets_json: tab.datasets_json,
        key_fields_json: '',
      });
      compare = { rules_json: tabB.strategy === 'custom_check' ? '[]' : serializeRules(tabC.rules) };
    } else {
      match = buildTabBPayload(tabB, {
        strategy: tabB.strategy,
        datasets_json: tab.datasets_json,
        key_fields_json: '',
      });
      compare = { rules_json: serializeRules(tabC.rules) };
    }
    const body: ReconCheck = {
      scenario_code: scenarioCode,
      check_name: tab.check_name,
      seq_no: tab.seq_no,
      consume_json: tab.consume_json,
      windowStart: tab.windowStart,
      windowEnd: tab.windowEnd,
      match_rule: match,
      compare_rule: compare,
      enabled,
    };
    save.mutate(body);
  }

  /* Tab B 数据集下拉：参与匹配 = Tab A 消费清单全量（收敛 2.0；别名恒 = ds_code） */
  const tabBAliases = tabA.rows.map((r) => r.ds_code.trim()).filter(Boolean);

  /* Tab B 匹配键配置器两侧：左 = 清单第 1 行，右 = 第 2 行；候选字段取自数据源 fields_json */
  const sideOf = (row: { ds_code: string } | undefined): KeySide | null => {
    if (!row) return null;
    const ds = dsOptions.find((d) => d.ds_code === row.ds_code);
    return {
      alias: row.ds_code,
      label: `${row.ds_code}`,
      fields: parseKeySideFields(ds?.fields_json),
    };
  };
  const leftSide = sideOf(tabA.rows[0]);
  const rightSide = sideOf(tabA.rows[1]);
  /** sum_check 单数据源内部勾稽：字段引用候选 = 清单第 1 行的数据源字段映射 */
  const sumFields = sideOf(tabA.rows[0])?.fields ?? [];

  /** custom_check 整检查无规则表：隐藏 Tab C（需求 §3.3） */
  const hideCompare = tabB.strategy === 'custom_check';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>
            {editing ? `编辑检查 ${editing.check_name}` : '新增检查'}
          </DialogTitle>
          <DialogDescription>
            场景：{scenarioCode} · 消费模式清单为数据源唯一入口，参与匹配清单自动继承（收敛 2.0）
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="consume" className="w-full">
          <TabsList>
            <TabsTrigger value="consume">Tab A · 消费模式</TabsTrigger>
            <TabsTrigger value="match">Tab B · 匹配规则</TabsTrigger>
            {!hideCompare && <TabsTrigger value="compare">Tab C · 比较规则</TabsTrigger>}
          </TabsList>

          <TabsContent value="consume" className="space-y-4">
            <CheckFormTabA
              state={tabA}
              onChange={setTabA}
              dsOptions={dsOptions}
              editing={!!editing}
              strategy={tabB.strategy}
            />
          </TabsContent>

          <TabsContent value="match" className="space-y-4">
            <MatchFormTabB
              state={tabB}
              onChange={setTabB}
              aliases={tabBAliases}
              left={leftSide}
              right={rightSide}
            />
          </TabsContent>

          {!hideCompare && (
            <TabsContent value="compare" className="space-y-4">
              <CompareFormTabC
                state={tabC}
                onChange={setTabC}
                left={leftSide}
                right={rightSide}
                strategy={tabB.strategy}
                alias={tabBAliases[0]}
                fields={sumFields}
              />
            </TabsContent>
          )}
        </Tabs>

        {err && (
          <div className="rounded-md bg-destructive/10 px-3 py-2 text-[13px] text-destructive">
            {err}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={submit} disabled={save.isPending}>
            {save.isPending ? '保存中…' : '保存'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
