/**
 * 全局搜索（命令面板 / P0）的统一搜索项定义。
 *
 * <p><b>唯一定义处</b>（设计 §5.4）：跨文件只此一份，避免多处重复定义导致漂移。
 *
 * <p>与设计 §2.3 对齐：`appCode` 为**核心**字段——`null` 表示「平台级」（不属于任何 APP），
 * 与后端 `app_code IS NULL` 语义一致（设计 §5.2 禁止用 `''` / `'0'` 代替）。
 */
export interface SearchItem {
  /** 稳定唯一键：`\`${appCode ?? '_'}:${path ?? title}\``（设计 §5.4）。 */
  id: string;
  /**
   * 搜索项类型。
   *
   * <p>P0 只产出 `'menu'`（`*_NAV` 展平出的页面）与 `'app'`（`AppItem[]`）；
   * 其余取值（message/task/process/form/doc/user/org）为 P1/P2 服务端搜索预留。
   */
  type: 'menu' | 'app' | 'message' | 'task' | 'process' | 'form' | 'doc' | 'user' | 'org';
  title: string;
  /** 可跳转路由；无可跳转路由（如纯信息项）时为 `null`。 */
  path: string | null;
  /** lucide 图标名（经 `resolveNavIcon` 解析；未登记静默回退）。 */
  icon: string | null;
  /** 应用归属（`sys_app.code`）；`null` = 平台级。 */
  appCode: string | null;
  /** 显示用 APP 名（由 `appCode` 映射得到，不落库）。 */
  appName: string | null;
  /** 别名 / 拼音（P2，暂未使用）。 */
  keywords?: string[];
}
