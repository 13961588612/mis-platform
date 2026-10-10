import { Bell, LayoutDashboard, ListTodo } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { PortalHomeTab } from './tabs/portal-home-tab';
import { PortalTodoTab } from './tabs/portal-todo-tab';
import { PortalMessageTab } from './tabs/portal-message-tab';
import { usePortalTabStore, type PortalTabKey } from '@/stores/portal-tab-store';

/**
 * 门户 tab bar：一条**白底通栏**，左对齐托住三枚「图标 + 文字」的 tab，
 * 栏底一条 1px 分隔线（`border-b border-border`）贯通整行。
 *
 * <p>底色用 `bg-card`（纯白）而非 `bg-muted`/50 灰底：`--card` 是 shadcn 的
 * 「浮起表面」白，而 `--background`（本项目 `220 14% 95.5%`）本身是**浅灰**页面底色，
 * 参考图要的是「白底 tab 栏压在浅灰页面上」的层次，故取 `bg-card`；它同时是语义
 * token，暗色模式下自动落到 `--card`（比 `--background` 略亮），无需写死颜色。
 * `justify-start` + `w-fit` ⇒ tab **左对齐**、不随内容拉伸；`gap-2` 给tab 之间留间距。
 *
 * <p><b>`h-auto` 不是多余声明，切勿删除</b>：共享组件 `components/ui/tabs.tsx` 的
 * `TabsList` 基类带 `h-9`（36px 固定高）。`cn()`（tailwind-merge）只在**同类冲突**里
 * 取后者——`items-center` / `justify-start` / `bg-card` / `p-1.5` 都与 `h-9` 不同类，
 * 因此 `h-9` 会**原样保留**（已实测：`twMerge(base, mine)` 产物里仍有 `h-9`）。
 *
 * <p>触发器盒高（rem 基准 =浏览器默认根字号 16px；本项目`tailwind.config.ts`
 * 未覆写 `spacing`/`borderWidth`，故用 Tailwind 默认刻度）：
 * <ul>
 *   <li>内容行高：`text-[13px]` 的 13px × body 继承的 `line-height: 1.6` = **20.8px**</li>
 *   <li>上下内边距：`py-2` = 0.5rem = 8px<strong>每边</strong> ⇒ 上下合计 **16px**</li>
 *   <li>上下边框：`border` 每边 1px ⇒ 合计 **2px**</li>
 * </ul>
 * ⇒ 触发器盒高 = 20.8 + 16 + 2 = **38.8px**。
 * 而 `h-9` 的 36px 扣掉 `TabsList` 自身的 `p-1.5`（0.375rem = 6px×2 = 12px）与
 * `border-b`（1px）后，**留给内容的可用高仅 23px** ⇒ 触发器比可用高多出
 * **15.8px**，不修 `h-auto` 就会**上下溢出**、探出 tab bar 顶/底边。
 * `h-auto` 与 `h-9` 同属 tailwind-merge 的 `h` 组，能正确覆盖，让栏高由内容撑开
 * （实测：加上 `h-auto` 后产物中 `h-9` 消失；栏高 = 38.8 + 12(`p-1.5`) + 1(`border-b`)
 * ≈ **51.8px**，恰好容得下触发器）。
 *
 * <p><b>没有 `-mb-px`</b>：本方案**不要求**选中 tab 与下方内容区无缝相连，选中药丸是
 * 「浮起」的独立圆角块、与内容区之间还隔着 `p-1.5` 的留白，所以不需要用负外边距去
 * 压盖 `TabsList` 的 `border-b`。去掉压盖后不变量更简单，见
 * {@link PORTAL_TAB_TRIGGER_CLASS}。
 */
const PORTAL_TAB_LIST_CLASS =
  'h-auto w-fit shrink-0 items-center justify-start gap-2 rounded-none border-b border-border bg-card p-1.5';

/**
 * 单个门户 tab 触发器：图标 + 文字的**药丸式（pill）**风格。
 *
 * <p>两态约定（全部由 Radix 的 `data-state` 驱动，无需 JS 判断）：
 * <ul>
 *   <li><b>未选中</b>：透明底 + <b>透明边框</b> + <b>主色蓝文字</b>（`text-primary`，
 *       `--primary: 243 75% 59%` ≈ `#4f46e5`，像链接色）；hover 时给一层极浅的
 *       `bg-muted/50` 底并转深色文字，提示可点。</li>
 *   <li><b>选中</b>：<b>浅灰圆角药丸</b>（`bg-muted`）+ `border-border` 浅边框 +
 *       四角圆角（`rounded`，4px）+ <b>深色文字</b>（`text-foreground`）+ `shadow-none`
 *       去掉基类投影。</li>
 * </ul>
 * 刻意<b>不</b>用 `bg-card`白卡：白卡压在白底 tab 栏上等于没有选中态；也刻意
 * <b>不</b>做「与内容区无缝相连」，因此 `rounded` 是四边全圆角而非 `rounded-t`。
 *
 * <p><b>关键不变量：两态盒高/盒宽完全一致 ⇒ 切换 tab 时零跳动。</b>
 * 与上一轮「白卡 + 压盖」方案不同，药丸方案不再需要负外边距技巧，做法更干净：
 * <ul>
 *   <li>基类上写<b>完整的 `border`（四边 1px）</b> + `border-transparent`，
 *       active 变体<b>只把边框颜色</b>换成 `border-border`
 *       （`data-[state=active]:border-border`）——边框的**存在性与宽度两态相同**，
 *       只有颜色不同，盒高贡献恒为 2px。</li>
 *   <li>padding（`px-3.5 py-2`）、字号（`text-[13px]`）、圆角（`rounded`）全部挂在
 *       <strong>基类</strong>上，两态共享。</li>
 *   <li>active 变体上只剩<b>不影响盒模型</b>的声明：边框色、`bg-muted`、`text-foreground`、
 *       `shadow-none`（已实测 `twMerge` 产物：active 变体仅这4 条，无任何
 *       `border-x`/`border-t`/`border-b-0`/`-mb-px`/`rounded-t`）。</li>
 *   <li>盒高数学：内容行高 C = 13 × 1.6 = 20.8（body `line-height: 1.6` 是**数字**，
 *       按元素自身字号重算；`py-2` = 0.5rem = 8px <strong>每边</strong>、上下合计 16）
 *       ⇒ 两态盒高恒为 C + 16(`py-2` 上下) + 2(上下 border) = **38.8px**；
 *       盒宽恒为 文字 + 图标 + `gap-1.5` + `px-3.5`×2 + border 2，两态相等
 *       ⇒ 切换时文字与药丸<b>上下左右都零位移</b>，也不会因「只有 active 带负外边距」
 *       而跳 2px（上一轮踩过的坑）。</li>
 * </ul>
 *
 * <p>图标（lucide，自身 `fill="none"`、描边取`currentColor`）因此<b>自动跟随文字变色</b>：
 * 未选中为主色蓝、选中为深色，不为图标单独设色。
 *
 * <p>参考图里每个 tab 后带`×` 关闭按钮——<b>刻意不实现</b>：门户是三Tab 常驻导航，
 * 不是浏览器标签页，不提供关闭语义。
 *
 * <p>注意：这里**只做样式覆盖**，不改 `components/ui/tabs.tsx` 共享组件本体
 * （它被工作台 / 系统管理等所有页面复用，改动会外溢）。
 */
const PORTAL_TAB_TRIGGER_CLASS =
  'gap-1.5 rounded border border-transparent px-3.5 py-2 text-[13px] font-medium text-primary transition-colors hover:bg-muted/50 hover:text-foreground data-[state=active]:border-border data-[state=active]:bg-muted data-[state=active]:text-foreground data-[state=active]:shadow-none';

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
 * `mt-2`，让内容紧贴 tab 栏下方那条 1px 分隔线（共享组件本体不动，只在此覆盖）。
 * 🔴 tab 栏**顶部不放任何工具栏**（参考图没有「返回门户 / 工作台⌄」那一行），
 * 本组件也不要新增——顶栏由 `AppLayout` 提供，门户页自己再加一条就是重复导航。
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