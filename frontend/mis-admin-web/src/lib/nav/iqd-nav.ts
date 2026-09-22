/**
 * 问数子系统（app.code = 'iqd'）侧栏静态权威清单。
 *
 * <p>与 `V77__iqd_standalone_app.sql` 的 sys_menu 路径/标题/图标/排序 **严格一一对应**：
 * 后端 `/menus/router` 为增量增强来源（见 menus-to-nav.mergeNavWithFallback），
 * 静态清单保证迁移未执行或权限未授予时侧栏结构不出现空洞——与 SYSTEM_NAV / KB_NAV /
 * AGENT_NAV 同口径。
 *
 * <p>本清单形状**照抄** `kb-nav.ts`：全为叶子节点，order 与 V77 的 sys_menu.sort 对齐，
 * 旗舰页（问数 /iqd/data-query）置顶。
 *
 * <p>**新增页面必须三处同改**（与 KB_NAV / AGENT_NAV 约定一致）：
 *   ① 本文件（导航）
 *   ② `components/layout/keep-alive-outlet.tsx` 的 `PAGE_MAP`（精确路径 → 组件）
 *   ③ `V77__iqd_standalone_app.sql` 的 sys_menu seed（菜单与权限码）
 * 少改任何一处都会得到「点得进去但没标题」或「有菜单但页面空白」这类半残状态。
 *
 * <p>icon 取值必须同步登记到 `lib/nav/icons.ts` 的 `ICON_MAP`
 * （Database/Settings/ShieldCheck/Crosshair/History/Sparkles 已存在，复用 agent 段；
 * v1.11 建模台新增 `Workflow`，登记于 V87 段）。
 *
 * <p>架构约束（arch/no-cross-feature）：本文件**只依赖** `@/lib/nav/system-nav`，
 * 不 import 任何 `features/*` 模块；问数页面组件由 keep-alive-outlet 经懒加载引入，
 * 此处只持有路径/标题/图标元数据，避免 nav 层与 feature 层反向耦合。
 */
import type { SystemNavLeaf, SystemNavNode } from '@/lib/nav/system-nav';

export const IQD_NAV: SystemNavNode[] = [
  // 旗舰页置顶（V77: 93040，path=/iqd/data-query，permission=ai:chat:use）
  { kind: 'leaf', path: '/iqd/data-query', title: '问数', icon: 'Database' },
  // v1.11 可视化建模台（V87__iqd_modeling_seed.sql：sys_menu 92600，icon Workflow）
  // 权限码 iqd:modeling:view（V87 授予 role_id=1；前端 PermissionGate，无 view 进页面 40300）
  { kind: 'leaf', path: '/iqd/modeling', title: '可视化建模台', icon: 'Workflow' },
  // W2 问数管理（V73__iqd_w2_menu_api_seed.sql 的 sys_menu 种子：9250x 可见页，path=/iqd/*）
  { kind: 'leaf', path: '/iqd/config', title: '连接配置', icon: 'Settings' },
  { kind: 'leaf', path: '/iqd/catalog', title: '语义模型', icon: 'Database' },
  { kind: 'leaf', path: '/iqd/scope', title: '范围与权限', icon: 'ShieldCheck' },
  { kind: 'leaf', path: '/iqd/test-chat', title: '测试问数', icon: 'Crosshair' },
  { kind: 'leaf', path: '/iqd/traces', title: '问数审计', icon: 'History' },
  { kind: 'leaf', path: '/iqd/enhance', title: '脱敏与维度', icon: 'Sparkles' },
  { kind: 'leaf', path: '/iqd/instruction', title: '指令下发', icon: 'Sparkles' },
];

/** 展平为叶节点列表（IQD_NAV 当前全为叶节点，保留分支处理以兼容后续扩展）。 */
export function flattenIqdNavLeaves(): SystemNavLeaf[] {
  const out: SystemNavLeaf[] = [];
  for (const n of IQD_NAV) {
    if (n.kind === 'leaf') out.push(n);
    else out.push(...n.children);
  }
  return out;
}
