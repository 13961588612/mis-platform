import type { LucideIcon } from 'lucide-react';
import { Bell, LayoutDashboard, ListTodo } from 'lucide-react';
import { useLocation } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { usePortalTabStore, type PortalTabKey } from '@/stores/portal-tab-store';

/**
 * 门户三 Tab 面板的 DOM id。
 *
 * <p>顶栏 tab 的 `aria-controls` 与 `features/portal/portal-page.tsx` 内容区的 `id`
 * 共用此常量——两者虽处在两棵 React 树（一个是 `AppLayout` 的顶栏，一个是
 * `KeepAliveOutlet` 主槽里的页面），但在**同一个 document** 里，IDREF 跨树仍然有效。
 * 单点定义避免两侧字符串字面量漂移。
 */
export const PORTAL_TAB_PANEL_ID = 'portal-tab-panel';

/** 门户页路径：这组 tab **仅**在该路径下渲染。 */
const PORTAL_PATH = '/portal';

/** 三个 tab 的静态定义（键 / 文案 / 图标 / 图标 testid）。 */
const PORTAL_TABS: ReadonlyArray<{
  key: PortalTabKey;
  label: string;
  icon: LucideIcon;
  iconTestId: string;
}> = [
  { key: 'home', label: '首页', icon: LayoutDashboard, iconTestId: 'portal-tab-icon-home' },
  { key: 'todo', label: '待办事项', icon: ListTodo, iconTestId: 'portal-tab-icon-todo' },
  { key: 'message', label: '消息中心', icon: Bell, iconTestId: 'portal-tab-icon-message' },
];

/**
 * 顶栏 tab 条的容器类。
 *
 * <p><b>「与工作区相连」是怎么实现的</b>（选中 tab 要贯穿 header 的 1px `border-b`）：
 * <ul>
 *   <li>header 是 `h-14`（3.5rem × 16px/rem = **56px**）且 Tailwind preflight 把
 *       `box-sizing` 设为 `border-box` ⇒ 56px **含**那条 1px `border-b`；
 *       故 header **内容盒高 = 56 − 1 = 55px**，也就是单行 flex line 的 cross size。</li>
 *   <li>本容器是 header 的 flex item，`height: auto` 且 `align-self: stretch`（`self-stretch`
 *       覆盖 header 的 `items-center`），且交叉轴 margin 都不是 `auto` ⇒ stretch 生效：
 *       used **outer** cross size = line cross size = 55px。
 *       outer = border box + margin-top(0) + margin-bottom(−1px)
 *       ⇒ border box 高 = 55 − (0 + (−1)) = **56px**；
 *       margin box 起始边对齐 line 起始边 ⇒ border box 恰好占 **y = 0…56**。</li>
 *   <li>header 的 `border-b` 占 y = 55…56，正好被这 56px 完整压住。绘制顺序上，
 *       父元素自身边框在**第 1 步**、普通流后代在**第 3 步**（CSS 2.1 Appendix E），
 *       子元素**画在父边框之上**；且 header 无 `overflow: hidden` ⇒ 不裁剪。
 *       于是选中 tab 的 `bg-background` 灰一路盖过 header 边框、接到下方
 *       `<main>` 的 `bg-background` 灰，视觉上连成一体。</li>
 *   <li>顶边不溢出：border box 顶边 = 0，与 header 内容盒顶边齐平，不会探出顶栏上方。</li>
 * </ul>
 *
 * <p>🔴 `-mb-px` 挂在**容器**上（不随选中态变化），而不是像上一轮那样挂在 active tab 上
 * ——「只有 active 带 −1px 外边距」正是当初切换 tab 跳 2px 的根因，这里从结构上排除。
 */
const PORTAL_TAB_LIST_CLASS = 'flex shrink-0 items-stretch self-stretch -mb-px';

/**
 * 单个顶栏 tab 的**基类**：影响盒模型的类**全部**写在这里，两态共享。
 *
 * <p><b>两态盒高推导（可复算）</b>：rem 基准 = 浏览器默认根字号 **16px**
 * （本项目 `tailwind.config.ts` 未覆写 `spacing` / `borderWidth`，用 Tailwind 默认刻度）。
 * <ol>
 *   <li>容器 border box 高 = **56px**（推导见 {@link PORTAL_TAB_LIST_CLASS}：
 *       header 内容盒 55px + `self-stretch` 后 −1px 外边距换来的 1px 压盖）。
 *       容器自身**无 padding、无 border** ⇒ 内容盒高也是 56px。</li>
 *   <li>tab 的 `h-full` = 100% × 56px = **56px**，两态恒等（不随选中态变化）。
 *       又 `box-sizing: border-box` ⇒ padding / border-width **不会**改变这个外框高。</li>
 *   <li>内容行高 C：`text-[13px]` 13px × body 继承的 `line-height: 1.6`
 *       （`src/styles/globals.css` 的 `body`） = **20.8px**。</li>
 *   <li>`py-2` = 0.5rem = 8px <b>每边</b> ⇒ 上下合计 **16px**（不是 8px）。</li>
 *   <li>上下 border-width：`border-x` 只给左右各 1px，上下恒为 **0**（Tailwind preflight
 *       把 `border-width` 归零，本类不开 `border`/`border-y`）⇒ 合计 **0px**。</li>
 *   <li>校验：C 20.8 + py 16 + 上下 border 0 = 36.8px，剩余 56 − 36.8 = **19.2px**
 *       由 `items-center` 上下均分（各 9.6px）。两态数值完全相同。</li>
 * </ol>
 *
 * <p><b>两态零跳动的三条保证</b>：
 * <ul>
 *   <li>高度来源唯一 = `h-full`（父容器确定高），padding/border/字号都不影响外框；</li>
 *   <li>active 变体 {@link PORTAL_TAB_ACTIVE_CLASS} 只含**颜色**类
 *       （`border-x-border` / `bg-background` / `text-foreground`），
 *       不含任何 `margin` / `padding` / `border-*-width` / `h-*` / `text-[*px]`；</li>
 *   <li>压盖用的 `-mb-px` 在容器上，是常量。</li>
 * </ul>
 * ⇒ 切换 tab 时文字与色块上下左右**零位移**（这正是前两轮反复踩的坑）。
 *
 * <p>圆角取 `rounded-t`（= `borderRadius.DEFAULT` = 0.25rem = **4px**，与项目基线一致）：
 * 只圆上方两角、下方保持直角，才能与下方工作区「接得上」。
 *
 * <p>图标（lucide，自身 `fill="none"`、描边取 `currentColor`）自动跟随文字变色，
 * 不单独设色。
 *
 * <p><b>刻意不提供关闭按钮</b>：门户是三 Tab 常驻导航，不是浏览器标签页，无关闭语义。
 *
 * <p>注意：这里<b>不用</b> `components/ui/tabs.tsx` 的 `TabsList`/`TabsTrigger`
 * （共享组件本体一行未改）——Radix 的 `TabsList` 与 `TabsContent` 必须在同一个
 * `Tabs` root 内，而顶栏与门户内容区处在两棵 React 树，上下文无法连通。故改为
 * 普通 `button` + 手写 `role="tab"` 语义，数据源唯一 = {@link usePortalTabStore}。
 */
const PORTAL_TAB_CLASS =
  'inline-flex h-full shrink-0 items-center gap-1.5 rounded-t border-x border-x-transparent px-3.5 py-2 text-[13px] font-medium text-primary transition-colors hover:bg-accent hover:text-foreground';

/**
 * 顶栏 tab 的**选中态**变体：只改颜色，不改任何影响盒模型的声明。
 *
 * <p>`bg-background`（`220 14% 95.5%` 浅灰）与 `<main>` 底色同一个 token ⇒ 选中 tab
 * 与下方工作区同色；**不用** `bg-card`（纯白，接不上）也**不用** `bg-muted`
 * （`220 14% 93%`，比工作区深一档，会露出一条色差）。
 */
const PORTAL_TAB_ACTIVE_CLASS = 'border-x-border bg-background text-foreground';

/**
 * 顶栏的门户三 Tab 切换器（首页 / 待办事项 / 消息中心）。
 *
 * <p><b>为什么放在 `components/layout/`</b>：这是顶栏的一部分，依赖方向必须是
 * layout → stores（← feature）。若塞进 `features/portal/`，等于让全站顶栏去依赖某个
 * 业务 feature 的内部结构；门户改名/搬家时顶栏就得跟着改。两侧只共享
 * `src/stores/portal-tab-store.ts`，依赖方向干净。
 *
 * <p><b>可见性</b>：非 `/portal` 路径**直接返回 null**（不是 `hidden`），
 * 既不占位、也不进无障碍树。
 *
 * <p><b>可访问性</b>：不再复用 Radix `TabsTrigger` 后，手动补齐 tab 语义——
 * 容器 `role="tablist"` + `aria-label`，每个按钮 `role="tab"` + `aria-selected`
 * + `aria-controls`（指向门户内容区的 {@link PORTAL_TAB_PANEL_ID}）+ 稳定 `id`
 * （供面板 `aria-labelledby` 反向引用）。三个 tab 都保持默认 `tabIndex`（可 Tab 聚焦），
 * 不用 roving tabindex——避免键盘用户无法直接 Tab 到相邻 tab。
 *
 * <p>点击只写 store，**不做任何路由跳转**（三 Tab 不进 URL，`/portal` 由
 * `keep-alive-outlet.tsx` 的 `PAGE_MAP` 直挂，见 `portal-tab-store.ts` 的说明）。
 */
export function PortalTabSwitcher() {
  const location = useLocation();
  const activeTab = usePortalTabStore((s) => s.activeTab);
  const setActiveTab = usePortalTabStore((s) => s.setActiveTab);

  // 仅在门户页渲染：其它页面顶栏完全不出现这三个 tab。
  if (location.pathname !== PORTAL_PATH) return null;

  return (
    <div
      role="tablist"
      aria-label="门户视图"
      data-testid="portal-tab-switcher"
      className={PORTAL_TAB_LIST_CLASS}
    >
      {PORTAL_TABS.map(({ key, label, icon: Icon, iconTestId }) => {
        const isActive = activeTab === key;
        return (
          <button
            key={key}
            type="button"
            role="tab"
            id={`portal-tab-${key}`}
            aria-selected={isActive}
            aria-controls={PORTAL_TAB_PANEL_ID}
            data-testid={`portal-header-tab-${key}`}
            className={cn(PORTAL_TAB_CLASS, isActive && PORTAL_TAB_ACTIVE_CLASS)}
            onClick={() => setActiveTab(key)}
          >
            <Icon className="h-4 w-4 shrink-0" data-testid={iconTestId} aria-hidden="true" />
            {label}
          </button>
        );
      })}
    </div>
  );
}
