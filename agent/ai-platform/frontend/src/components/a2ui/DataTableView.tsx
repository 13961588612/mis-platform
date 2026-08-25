/**
 * DataTableView — A2UI `data-table` 组件（只读数据表格）。
 *
 * 渲染后端 ui_render(component="data-table", props={...}) 下发的表格。
 * props.columns 可为字符串数组或 {key,label}；props.rows 为对象数组。
 * 所有单元格文本经 React 转义，绝不使用 dangerouslySetInnerHTML。
 */

import type { A2UIComponentProps } from "./types";

interface ColumnSpec {
  key: string;
  label?: string;
}

interface Row {
  [key: string]: unknown;
}

export function DataTableView({ props }: A2UIComponentProps): JSX.Element {
  const title = typeof props.title === "string" ? props.title : "";
  const columns = Array.isArray(props.columns)
    ? (props.columns as Array<string | ColumnSpec>).map((c) =>
        typeof c === "string" ? { key: c, label: c } : { key: c.key, label: c.label ?? c.key },
      )
    : [];
  const rows = Array.isArray(props.rows) ? (props.rows as Row[]) : [];
  const hasColumns = columns.length > 0;
  const keys = hasColumns
    ? columns.map((c) => c.key)
    : rows.length > 0
      ? Object.keys(rows[0])
      : [];

  return (
    <div className="my-2 mx-auto max-w-[90%] overflow-hidden rounded-lg border border-surface-light bg-white">
      {title && (
        <div className="border-b border-surface-light bg-surface-muted/40 px-3 py-2 text-sm font-medium text-surface-dark">
          {title}
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="bg-surface-muted/30 text-surface-dark/70">
              {keys.map((k) => {
                const label = hasColumns
                  ? (columns.find((c) => c.key === k)?.label ?? k)
                  : k;
                return (
                  <th
                    key={k}
                    className="border-b border-surface-light px-3 py-2 text-left font-medium"
                  >
                    {label}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i} className="odd:bg-white even:bg-surface-muted/20">
                {keys.map((k) => (
                  <td
                    key={k}
                    className="border-b border-surface-light px-3 py-2 text-surface-dark/80"
                  >
                    {String(row[k] ?? "")}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default DataTableView;
