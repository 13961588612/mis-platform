/**
 * PropertyPanel.tsx — 右栏属性面板（v1.11 MR-S4，T02b-3；**本批只读**）。
 *
 * <h2>🔴 不再发请求（Q5 单源）</h2>
 * 数据全部来自 {@link useCatalogNodes} 已返回的 `catalog` + store 的 `selectedItemKey`：
 * 同一份缓存，左树/画布/右栏三处一致。**不要**在此再 `useQuery` 一次清单
 * （会多一次请求，且与画布不同步）。
 *
 * <h2>本批范围</h2>
 * 只读展示：选中项的 kind / display_name / item_key / source / 是否纳入问数范围 /
 * 描述 / 表达式，以及（model / table 的）字段列表（含 PK / 计算列 / 脱敏徽标）。
 * **字段描述直编、脱敏直编属 T04（MR-09 / MR-13）**，此处留 TODO 不发写请求。
 */
import { useMemo } from 'react';
import { Badge } from '@/components/ui/badge';
import type { IqdCatalogItem } from '@/lib/api/iqd';
import { useCatalogNodes } from '../../hooks/useCatalogNodes';
import { useModelingStore } from '../../store/modeling-store';

/** `PropertyPanel` Props。 */
export interface PropertyPanelProps {
  /** **数字**连接 id（与画布/左树同一 cache key）。 */
  connectionId: number | null;
}

/** kind → 中文名（只列可能出现在画布/树上的四类）。 */
const KIND_LABEL: Record<string, string> = {
  model: '模型',
  table: '物理表',
  cube: '指标（Cube）',
  relationship: '关系',
  column: '字段',
};

/** 字段徽标（与画布节点卡同口径）。 */
function columnBadges(column: IqdCatalogItem): string[] {
  const badges: string[] = [];
  if (column.is_primary_key) {
    badges.push('PK');
  }
  if (column.expression) {
    badges.push('计算列');
  }
  if ((column.sensitive_level ?? 'none') !== 'none' || column.mask_rule) {
    badges.push('脱敏');
  }
  return badges;
}

/** 右栏属性面板（只读）。 */
export function PropertyPanel({ connectionId }: PropertyPanelProps) {
  const { catalog } = useCatalogNodes(connectionId);
  const selectedItemKey = useModelingStore((state) => state.selectedItemKey);

  /** 选中项。 */
  const selected = useMemo(
    () => catalog.find((item) => item.item_key === selectedItemKey) ?? null,
    [catalog, selectedItemKey],
  );

  /** 选中项的字段（model/table 才有：按其物理表 key 收集列 + 计算列）。 */
  const fields = useMemo(() => {
    if (!selected || (selected.kind !== 'model' && selected.kind !== 'table')) {
      return [] as IqdCatalogItem[];
    }
    const tableName = (selected.display_name ?? selected.item_key).toLowerCase();
    const tableKey =
      selected.kind === 'table'
        ? selected.item_key
        : catalog.find(
            (item) => item.kind === 'table' && item.item_key.toLowerCase().endsWith(`.${tableName}`),
          )?.item_key ?? null;
    return catalog.filter(
      (item) =>
        item.kind === 'column' &&
        ((tableKey != null && item.parent_key === tableKey) || item.parent_key === selected.item_key),
    );
  }, [catalog, selected]);

  if (!selected) {
    return (
      <div className="min-h-0 flex-1 overflow-auto p-2 text-[12px] text-muted-foreground">
        未选中任何节点。在左侧树或画布中点一个模型 / 表 / 指标查看详情。
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-auto">
      {/* 基础信息 */}
      <div className="space-y-2 border-b border-border/60 p-2">
        <div className="flex items-center gap-2">
          <span className="truncate text-[13px] font-medium">
            {selected.display_name ?? selected.item_key}
          </span>
          <Badge variant="outline" className="h-4 shrink-0 px-1 text-[10px]">
            {KIND_LABEL[selected.kind] ?? selected.kind}
          </Badge>
          {selected.source === 'modeling' && (
            <Badge variant="secondary" className="h-4 shrink-0 px-1 text-[10px]">
              建模台
            </Badge>
          )}
        </div>
        <dl className="space-y-1 text-[12px]">
          <Row label="item_key" value={selected.item_key} mono />
          <Row
            label="纳入问数范围"
            value={selected.in_scope ? '是' : '否（可在 /iqd/scope 勾选）'}
          />
          <Row label="来源" value={selected.source ?? '—'} />
          {selected.description && <Row label="描述" value={selected.description} />}
          {selected.expression && <Row label="表达式" value={selected.expression} mono />}
        </dl>
      </div>

      {/* 字段列表（model / table） */}
      {(selected.kind === 'model' || selected.kind === 'table') && (
        <div className="p-2">
          <p className="mb-1 text-[13px] font-medium">字段（{fields.length}）</p>
          <div className="rounded border border-border/60">
            <table className="w-full text-[12px]">
              <thead className="bg-muted/40">
                <tr className="text-left">
                  <th className="px-2 py-1 font-medium">字段</th>
                  <th className="border-l border-border/60 px-2 py-1 font-medium">类型</th>
                  <th className="border-l border-border/60 px-2 py-1 font-medium">标记</th>
                </tr>
              </thead>
              <tbody>
                {fields.map((field) => (
                  <tr key={field.item_key} className="border-t border-border/40">
                    <td className="px-2 py-1">{field.display_name ?? field.item_key}</td>
                    <td className="border-l border-border/60 px-2 py-1 text-muted-foreground">
                      {field.data_type ?? '—'}
                    </td>
                    <td className="border-l border-border/60 px-2 py-1">
                      {columnBadges(field).map((badge) => (
                        <Badge
                          key={badge}
                          variant={badge === 'PK' ? 'default' : 'outline'}
                          className="mr-1 h-4 px-1 text-[10px]"
                        >
                          {badge}
                        </Badge>
                      ))}
                    </td>
                  </tr>
                ))}
                {fields.length === 0 && (
                  <tr>
                    <td colSpan={3} className="px-2 py-3 text-center text-muted-foreground">
                      无字段
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* TODO(T04)：字段描述直编（MR-09）、脱敏规则直编（MR-13）——
              两者都是写操作，须走 PUT /iqd/catalog/node（含 base_revision 乐观并发 + idempotency_key），
              本批不实现，避免在半只读阶段引入未验证的写路径。 */}
          <p className="mt-2 text-[11px] text-muted-foreground">
            字段描述 / 脱敏直编将于 T04 提供（需乐观并发与幂等键配套）。
          </p>
        </div>
      )}

      {/* 指标/关系的补充说明 */}
      {selected.kind === 'cube' && (
        <div className="border-t border-border/60 p-2 text-[12px] text-muted-foreground">
          指标的 measures / dimensions 编辑属 T03（需 `model_ref` 精确挂靠，V89 已补列）。
        </div>
      )}
      {selected.kind === 'relationship' && (
        <div className="border-t border-border/60 p-2 text-[12px] text-muted-foreground">
          关系编辑（join 类型 / 基数 / 条件）属 T03。
        </div>
      )}
    </div>
  );
}

/** 键值行（item_key 等长串用等宽字体便于核对）。 */
function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex gap-2">
      <dt className="w-24 shrink-0 text-muted-foreground">{label}</dt>
      <dd className={mono ? 'min-w-0 break-all font-mono text-[11px]' : 'min-w-0 break-words'}>
        {value}
      </dd>
    </div>
  );
}

export default PropertyPanel;
