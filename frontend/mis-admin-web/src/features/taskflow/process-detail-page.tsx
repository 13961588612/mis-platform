/**
 * 流程详情页（P7）：包裹 ProcessShell，路由 /task/process/:id。
 *
 * <p>路由 ID 从 `pathname` 尾段解析，**不是** `useParams`：本应用页面由
 * `KeepAliveOutlet` 按路径直挂（渲染 `<Comp />`，不传任何 props），而 Route 只登记了
 * `/task/*` 通配（`router.tsx`）⇒ 页面不在任何 `<Route>` 上下文内，`useParams`
 * 恒返回空对象 ⇒ 本页永远落进「缺少流程实例 ID」分支，点开任何流程都是死页。
 * 范式照抄同仓两处既有做法：知识库详情 `kb-library-detail-page.tsx`（`parsePathId`
 * 数值 ID 校验）+ Agent 详情 `agent-detail-route.tsx`（下方 pathname 冻结）。
 * ⚠️ 新增详情页一律照此办理，勿再引入 `useParams`。
 */
import { useState } from 'react';
import { useLocation } from 'react-router-dom';
import { ProcessShell } from './process-shell';

/** 流程详情路径前缀（与 `keep-alive-outlet.tsx` 的 DYNAMIC_PAGES 登记保持一致）。 */
const PREFIX = '/task/process/';

/** ID 解析结果：`reason` 供页面区分两种失败，避免两种情况共用一句误导文案。 */
export interface ParsedInstancePath {
  /** 合法实例 ID（纯数字串）；失败为 null。 */
  instanceId: string | null;
  /** 失败原因：尾段缺失 / 前缀不符 / ID 非数字。 */
  reason: 'ok' | 'missing' | 'invalid';
}

/**
 * 从 pathname 解析流程实例 ID。
 *
 * <p>健壮性（每条都对应一类手敲URL / 跳转竞态）：
 * - 空尾段 `/task/process/` ⇒ missing（不误把前缀当 ID）
 * - 重复斜杠 `/task/process//128`、`多余尾段 `/128/extra` ⇒ missing
 * - query / hash `/task/process/128?from=x#top` ⇒ 先剥离再取尾段
 * - `URL` 编码 `%31%32%38` ⇒ 解码后校验
 * - 非数字 `abc`、非正数 `0` / `-1` ⇒ invalid，**不拉接口**（与知识库
 *   `parsePathId` 的 `Number.isFinite(n) && n > 0` 同口径）
 */
export function parseInstancePath(pathname: string): ParsedInstancePath {
  // pathname 理论上已由 router 剥离 query/hash，这里再剥一次以防直接传入原始 URL
  const path = pathname.split(/[?#]/, 1)[0];
  if (!path.startsWith(PREFIX)) return { instanceId: null, reason: 'missing' };
  const segments = path.slice(PREFIX.length).split('/').filter(Boolean);
  if (segments.length !== 1) return { instanceId: null, reason: 'missing' };

  let seg: string;
  try {
    seg = decodeURIComponent(segments[0]);
  } catch {
    // 非法百分号编码（如 `%zz`）视为非法 ID，不抛给上层
    return { instanceId: null, reason: 'invalid' };
  }
  // 纯数字且为正整数串（`'01'` 归一为 `'1'`，避免同实例开两个 Tab）
  if (!/^\d+$/.test(seg) || Number(seg) <= 0) return { instanceId: null, reason: 'invalid' };
  return { instanceId: String(Number(seg)), reason: 'ok' };
}

export function ProcessDetailPage() {
  const { pathname } = useLocation();
  /**
   * pathname **挂载时快照一次**：KeepAliveOutlet 让每个已打开 Tab 的页面实例常驻
   * （切Tab 仅显隐不卸载），若直接消费实时 `useLocation()`，切到别的 Tab 时
   * **所有**常驻实例都会跟着新 location 重渲染——表现为「Tab A 里显示的是 Tab B 的流程」。
   * 组件实例与路径 1:1（keep-alive 以 path 为 key），故快照即正解。
   */
  const [frozenPath] = useState(pathname);
  const [{ instanceId, reason }] = useState(() => parseInstancePath(frozenPath));

  if (!instanceId) {
    return (
      <div className="flex h-40 flex-col items-center justify-center gap-1 text-sm text-muted-foreground">
        <span>{reason === 'invalid' ? '流程实例 ID 非法' : '缺少流程实例 ID'}</span>
        {/* 说明当前地址与期望格式，让用户能自己判断是手敲错了还是跳转有问题 */}
        <span className="text-xs">
          {reason === 'invalid'
            ? '流程实例 ID 应为数字，请检查地址栏'
            : '地址应为 /task/process/{实例ID}，请从待办列表重新进入'}
        </span>
      </div>
    );
  }
  return <ProcessShell instanceId={instanceId} />;
}

export default ProcessDetailPage;