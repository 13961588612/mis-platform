import { Bell, LayoutDashboard, ListTodo } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { PortalHomeTab } from './tabs/portal-home-tab';
import { PortalTodoTab } from './tabs/portal-todo-tab';
import { PortalMessageTab } from './tabs/portal-message-tab';
import { usePortalTabStore, type PortalTabKey } from '@/stores/portal-tab-store';

/**
 * tab bar：一条浅底通栏，托住三张「图标 + 文字」卡片。
 *
 * <p>浅底 + `border-b` 是**未选中** tab 的底衬；选中的卡片靠基类上的 `-mb-px`
 * （两态都有）下压 1px、加上 `bg-card` 白底，恰好盖住这条 1px 下边框
 * （见 {@link PORTAL_TAB_TRIGGER_CLASS}），从而与下方内容区无缝相连。
 *
 * <p><b>`h-auto` 不是多余声明，切勿删除</b>：共享组件 `components/ui/tabs.tsx` 的
 * `TabsList` 基类带 `h-9`（36px 固定高）。`cn()`（tailwind-merge）只在**同类冲突**里
 * 取后者——`items-end` / `rounded-none` / `bg-muted/50` / `p-1.5` 都与 `h-9` 不同类，
 * 因此 `h-9` 会**原样保留**（已实测：`twMerge(base, mine)` 产物里仍有 `h-9`）。
 * 而卡片式 tab 的触发器盒高 ≈37.5px（`py-2` 上下 16 + 13px 行高≈19.5 + 上下 border 2），
 * 36px 减去上下 padding 与 border 后**可用高仅 29px** ⇒ 配合 `items-end` 底对齐，
 * 选中的白色卡片会**向上溢出约 8px**、探出 tab bar 顶边（而非像截图那样被托在浅色条内部）。
 * `h-auto` 与 `h-9` 同属 tailwind-merge 的 `h` 组，能正确覆盖，让 bar 高由内容撑开
 * （实测：加上 `h-auto` 后产物中 `h-9` 消失）。
 */
const PORTAL_TAB_LIST_CLASS =
  'h-auto w-fit shrink-0 items-end gap-1 rounded-none border-b border-border bg-muted/50 p-1.5 pb-0';

/**
 * 单个门户 tab 触发器：图标 + 文字的卡片式风格。
 *
 * <p>两态约定（全部由 Radix 的 `data-state` 驱动，无需 JS 判断）：
 * <ul>
 *   <li><b>未选中</b>：透明底 + 透明边框 + 文字/图标同色偏灰（`text-muted-foreground`，
 *       图标继承 `currentColor`）。</li>
 *   <li><b>选中</b>：白卡（`bg-card`）+ 边框转为 `border-border` + `rounded-t` 上圆角
 *       + 主色文字。</li>
 * </ul>
 *
 * <p><b>关键：两态的边框结构必须完全一致</b>（都用 `border-x border-t`，即
 * <u>都没有下边框</u>），且 `-mb-px` 必须挂在<strong>基类</strong>上（两态都有），
 * 只有 `border-border` / `bg-card` / `rounded-t` / `text-primary` 挂在 active 变体上。
 * 原因（盒高数学，设内容行高 C≈19.5、`py-2`=16、边框 1px）：
 * <ul>
 *   <li>若未选中带<strong>下</strong>边框（高 C+16+2）、选中 `border-b-0`（高 C+16+1），
 *       两态盒高差 1px；再叠加「只有 active 有 `-mb-px`」，切换时上边缘会<strong>跳 2px</strong>
 *       ——占位不但没防住跳动，反而制造了跳动。</li>
 *   <li>两态都无下边框（高同为 C+16+1）+ 两态都 `-mb-px` ⇒ 盒高完全相同、顶边差 0、
 *       切换时文字与盒**零位移**；同时 active 的 `bg-card` 下压 1px 恰好盖住
 *       `TabsList` 的 1px `border-b`，实现与内容区无缝相连。</li>
 * </ul>
 * 边框占位的真实作用在**横向**：两态都有 `border-x` ⇒ 盒宽一致，切换时文字不左右位移。
 *
 * <p>注意：这里**只做样式覆盖**，不改 `components/ui/tabs.tsx` 共享组件本体
 * （它被工作台 / 系统管理等所有页面复用，改动会外溢）。
 */
const PORTAL_TAB_TRIGGER_CLASS =
  '-mb-px gap-1.5 rounded-none border-x border-t border-transparent px-3.5 py-2 text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground data-[state=active]:rounded-t data-[state=active]:border-border data-[state=active]:bg-card data-[state=active]:text-primary data-[state=active]:shadow-none';

/**
 * 门户工作台容器（三 Tab 骨架）。
 *
 * <p><b>为什么不用路由 / URL 承载 Tab</b>：`/portal` 由 `keep-alive-outlet.tsx` 的
 * `PAGE_MAP['/portal']` 以 `<Comp/>` 直挂渲染，**不在任何 `<Route>` 上下文内**
 * （`useParams` 恒空）——若把 Tab 做成路由段，会同时撞上 `PAGE_MAP` 精确匹配与
 * `useParams` 恒空两个坑；改成 query 又会踩「切了 URL 但常驻实例不重渲染」。
 * 故三 Tab **不进 URL、不新增路由、不触碰 router/keep-alive**，激活态放在
 * {@link usePortalTabStore} 全局 store 里：容器自身订阅它渲染，顶栏也能从
 * `components/layout/` 侧改它，两侧只依赖 `stores/`，不产生跨 feature 依赖。
 *
 * <p>抽屉/详情态**仍归各 Tab / Board 自持**（组件内 `useState`，关闭即销毁、
 * **不入 URL**）。容器层不持有任何抽屉状态——切 Tab 时非激活面板被 Radix 卸载
 * （`data-[state=inactive]:!hidden` 且默认不挂载），其抽屉随之关闭，这是期望语义。
 *
 * <p>外壳（顶栏 / 命令面板 / Copilot）由 `AppLayout` 提供；`/portal` 下由
 * `AppLayout` 隐藏左栏（见 `app-layout.tsx` 的 `hideSidebar`），主区自然占满宽度。
 *
 * <p>布局：根容器 `flex h-full flex-col`，`Tabs` 撑满剩余高度；页内**不加内层
 * padding**（外距由 AppLayout 主槽 `p-4 md:p-6` 提供），滚动交回各 Tab 内容自持
 * （首页 `overflow-auto` 为门户唯一滚动层）。各 `TabsContent` 去掉共享组件默认的
 * `mt-2`，让选中的 tab 卡片与内容区**无缝相连**（共享组件本体不动，只在此覆盖）。
 */
export function PortalPage() {
  const activeTab = usePortalTabStore((s) => s.activeTab);
  const setActiveTab = usePortalTabStore((s) => s.setActiveTab);

  return (
    <div className="flex h-full flex-col">
      <Tabs
        value={activeTab}
        onValueChange={(v) => setActiveTab(v as PortalTabKey)}
        className="flex h-full min-h-0 flex-col"
      >
        <TabsList className={PORTAL_TAB_LIST_CLASS}>
          <TabsTrigger value="home" className={PORTAL_TAB_TRIGGER_CLASS}>
            <LayoutDashboard className="h-4 w-4 shrink-0" data-testid="portal-tab-icon-home" aria-hidden="true" />
            首页
          </TabsTrigger>
          <TabsTrigger value="todo" className={PORTAL_TAB_TRIGGER_CLASS}>
            <ListTodo className="h-4 w-4 shrink-0" data-testid="portal-tab-icon-todo" aria-hidden="true" />
            待办事项
          </TabsTrigger>
          <TabsTrigger value="message" className={PORTAL_TAB_TRIGGER_CLASS}>
            <Bell className="h-4 w-4 shrink-0" data-testid="portal-tab-icon-message" aria-hidden="true" />
            消息中心
          </TabsTrigger>
        </TabsList>

        <TabsContent value="home" className="mt-0 min-h-0 flex-1">
          <PortalHomeTab />
        </TabsContent>
        <TabsContent value="todo" className="mt-0 min-h-0 flex-1">
          <PortalTodoTab />
        </TabsContent>
        <TabsContent value="message" className="mt-0 min-h-0 flex-1">
          <PortalMessageTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}