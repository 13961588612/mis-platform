# 统一消息中心与代办任务体系设计

> **版本**: v1.0 | **日期**: 2026-09-30 | **状态**: 设计方案

---

## 一、设计目标

为 MIS 平台建立**统一的消息 + 代办事件中心**，满足以下核心需求：

1. **全局搜索**: 全文检索，按类型/状态/来源/时间多维筛选
2. **代办+消息双轨并行**: 消息可以独立存在（纯通知），也可以与代办绑定（需审批/处理）；无关联的纯消息也能正常展示和流转
3. **统一交互界面**: 在管理后台提供一个统一的收件箱入口，支持标记已读、处理、完成等通用操作

---

## 二、核心概念模型

### 2.1 三实体关系

`	ext
┌───────────────┐     ┌──────────────────┐     ┌───────────────┐
│  Message (消息) │     │   BizReference   │     │  Task (代办)   │
│               │────▶│                  │◀────│               │
│ • 接收者        │     │ • message_id     │     │ • 任务类型     │
│ • 标题/摘要     │     │ • task_id        │     │ • 目标实体     │
│ • 内容/附件     │     │ • biz_type       │     │ • 审批人/执行人│
│ • 发送时间      │     │ • biz_ref_id     │     │ • 审批结果     │
│ • 已读状态      │     │ • biz_status     │     │ • 截止时间     │
└───────────────┘     └──────────────────┘     └───────────────┘
`

**关系说明:**

| 场景 | 说明 |
|------|------|
| 消息 → 无关联 Task | 纯通知类消息，如系统公告、审批通过通知、数据变更提醒 |
| 消息 ↔ 关联 Task | 消息是代办的通知载体，Task 是待处理的业务动作延伸 |
| 多个 Message ↔ 一个 Task | 催办链：首次通知 + 逾期提醒 + 紧急催促，共用同一代办 |
| 一个 Message → 多用户 | 群发通知，不产生代办（每人独立阅读状态） |

### 2.2 数据流转

`
业务服务触发              消息服务                    代办服务
    │                       │                           │
    ├──(1) publishMsg───▶   ├──(2) saveMsg──────────▶   │
    │                       │                          │
    ├──(3) createTask───▶   ├──(4) bindRef─────────▶   │
    │                       │                          │
    │                       │◄──(5) notifyReceiver───   │
    │                      │  WebSocket推送             │
    │                      │  Redis队列异步投递         │
    │                       │                          │
接收者打开前台          UI 渲染                    业务处理
    │                       │                          │
    │◄──(6) fetchInbox────   │                         │
    │                       │──(7) markRead─────────▶  │
    │                       │                          │
    │                       │──(8) handleTask───────▶  │ 执行审批/操作
    │                       │                          │
`

---

## 三、数据库设计

### 3.1 表结构

#### 表1: sys_message — 消息主表

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | BIGINT | PK | 雪花ID |
| tenant_id | BIGINT | NOT NULL | 租户隔离（复用现有租户机制） |
| msg_type | VARCHAR(32) | NOT NULL | 枚举: APPROVAL / NOTIFY / REMIND / SYSTEM_ALERT |
| category | VARCHAR(32) | NOT NULL | 分类: TASK / ANNOUNCEMENT / ALERT / FEEDBACK |
| title | VARCHAR(256) | NOT NULL | 消息标题 |
| summary | TEXT | | 摘要（列表页展示，截断至120字符） |
| content | JSONB | | 富文本内容（HTML/MARKDOWN） |
| attachments | JSONB | DEFAULT '[]' | 附件元数据 [{name, url, size}] |
| sender_id | BIGINT | FK REFERENCES(sys_user) | 发送者ID（NULL=系统自动发送） |
| sender_name | VARCHAR(64) | | 发送者姓名（冗余，避免查库） |
| receiver_ids | BIGINT[] | NOT NULL | 接收者IDs数组 |
| read_count | INTEGER | DEFAULT 0 | 已读人数（群发消息用） |
| total_count | INTEGER | DEFAULT 0 | 总接收人数 |
| created_at | TIMESTAMP | NOT NULL | 创建时间 |
| read_by_current | BOOLEAN | DEFAULT FALSE | 当前用户是否已读 |
| viewed_at | TIMESTAMP | NULL | 最后查看时间 |
| deleted | SMALLINT | DEFAULT 0 | 软删除 |
| created_by | BIGINT | | JPA Audit |
| updated_at | TIMESTAMP | | JPA Audit |

#### 表2: sys_task — 代办任务表

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | BIGINT | PK | 雪花ID |
| tenant_id | BIGINT | NOT NULL | 租户隔离 |
| task_type | VARCHAR(32) | NOT NULL | 映射到业务域: PURCHASE_APPROVAL / LEAVE_APPLICATION / CONTRACT_REVIEW |
| biz_type | VARCHAR(64) | NOT NULL | 业务分类标识 |
| biz_ref_id | VARCHAR(128) | NOT NULL | 业务引用ID（源业务表主键） |
| biz_title | VARCHAR(256) | NOT NULL | 业务标题快照（防源数据变更导致丢失上下文） |
| target_entity | VARCHAR(64) | | 目标实体类型 |
| assignee_id | BIGINT | NOT NULL | 当前处理人 |
| assignee_name | VARCHAR(64) | | 冗余字段 |
| status | VARCHAR(16) | DEFAULT 'PENDING' | PENDING/APPROVING/APPROVED/REJECTED/EXPIRED/CANCELLED |
| priority | SMALLINT | DEFAULT 1 | 1=低 2=普通 3=高 4=紧急 |
| due_date | TIMESTAMP | NULL | 截止时间 |
| metadata | JSONB | DEFAULT '{}' | 扩展属性 {formData: {...}, approvalFlow: {steps: []}} |
| result | JSONB | NULL | 审批结果 {comment: "...", attachedFiles: [...]} |
| completed_at | TIMESTAMP | NULL | 完成时间 |
| read | BOOLEAN | DEFAULT FALSE | 代办是否已查看 |
| viewed_at | TIMESTAMP | NULL | |
| deleted | SMALLINT | DEFAULT 0 | 软删除 |

#### 表3: sys_biz_reference — 业务关联桥接表

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | BIGINT | PK | |
| message_id | BIGINT | FK, NULL | 关联消息（可为空，允许消息独立存在） |
| task_id | BIGINT | FK, NULL | 关联任务（可为空，允许代办独立于消息创建） |
| biz_type | VARCHAR(64) | NOT NULL | 业务类型 |
| biz_ref_id | VARCHAR(128) | NOT NULL | 业务实例ID |
| biz_status | VARCHAR(16) | | 业务实例状态快照 |
| created_at | TIMESTAMP | NOT NULL | |

**唯一约束:** uk_biz_ref_message_task ON sys_biz_reference(message_id, task_id)

### 3.2 索引设计

`sql
-- 高频查询：我的收件箱（按类型/状态/时间分页）
CREATE INDEX idx_msg_inbox_receiver ON sys_message(tenant_id, receiver_ids, read, created_at DESC);

-- 模糊搜索：标题+摘要全文检索
CREATE INDEX idx_msg_search ON sys_message USING GIN(to_tsvector('simple', title || ' ' || COALESCE(summary, '')));

-- 代办性能：我的代办列表
CREATE INDEX idx_task_assignee ON sys_task(assignee_id, tenant_id, status, created_at DESC);

-- 代办性能：逾期预警查询
CREATE INDEX idx_task_due_date ON sys_task(due_date, status) WHERE due_date IS NOT NULL AND status IN ('PENDING', 'APPROVING');

-- 联合查询：activity feed
CREATE INDEX idx_msg_type_category ON sys_message(tenant_id, msg_type, category, created_at DESC);
`

### 3.3 与现有审计日志整合

`
当前架构:                              目标架构:
┌────────────────┐                     ┌──────────────────────────┐
│ sys_oper_log   │                     │ sys_message              │
│                │───(聚合视图层)────▶ │ ├─ 消息类                  │
│ • HTTP调用轨迹  │                     │ └─ 代办通知               │
│ • 参数JSON记录  │                     ├─── sys_task               │
│                │                     │ └─ 所有代办任务            │
│ 问题：只能SQL搜 │                     └─── sys_audit_view         │
│        格式生硬 │                     └─ 统一操作日志视图          │
└────────────────┘                     └──────────────────────────┘
`

---

## 四、后端 API 设计

### 4.1 消息相关 API

`java
/**
 * GET /api/v1/messages/inbox?status=read|unread&type=APPROVAL&page=1&size=20
 * 获取我的收件箱
 */
@GetMapping("/inbox")
public PageResult<MessageVO> getInbox(
    @RequestParam(defaultValue = "ALL") List<String> types,
    @RequestParam(defaultValue = "ALL") List<String> statuses,
    @RequestParam(defaultValue = "CREATED_DESC") String sortBy,
    Pageable pageable
);

/**
 * POST /api/v1/messages/read
 * Body: {"ids": [1, 2, 3]}
 * 批量标记已读
 */
@PostMapping("/read")
public Result<Void> batchMarkAsRead(@RequestBody MarkAsReadRequest request);

/**
 * POST /api/v1/messages/clean
 * Body: {"beforeDate": "2026-01-01T00:00:00"}
 * 清理历史过期消息
 */
@PostMapping("/clean")
public Result<Integer> cleanOldMessages(@RequestBody CleanRequest request);

/**
 * GET /api/v1/messages/{id}/detail
 * 查看详情（带联动展示）
 */
@GetMapping("/{id}/detail")
public MessageDetailVO getMessageDetail(@PathVariable Long id);

/**
 * GET /api/v1/messages/search?q=采购&page=1&size=20
 * 全文搜索
 */
@GetMapping("/search")
public PageResult<MessageVO> searchMessages(
    @RequestParam("q") String keyword,
    Pageable pageable
);
`

### 4.2 代办任务 API

`java
/**
 * GET /api/v1/tasks/my?status=PENDING|APPROVING&page=1&size=20
 * 获取我的代办列表
 */
@GetMapping("/my")
public PageResult<TaskVO> getMyTasks(
    @RequestParam(defaultValue = "PENDING") String status,
    Pageable pageable
);

/**
 * GET /api/v1/tasks/stats
 * Response: {"pending": 12, "urgent": 3, "overdue": 5}
 */
@GetMapping("/stats")
public TaskStatsVO getTaskStats();

/**
 * POST /api/v1/tasks/{taskId}/handle
 * Body: {"action": "APPROVE", "comment": "同意", "result": {...}}
 */
@PostMapping("/{taskId}/handle")
public Result<Void> handleTask(
    @PathVariable Long taskId,
    @RequestBody HandleTaskRequest request
);

/**
 * POST /api/v1/tasks/{taskId}/transfer?newAssigneeId=xxx
 */
@PostMapping("/{taskId}/transfer")
public Result<Void> transferTask(
    @PathVariable Long taskId,
    @RequestParam Long newAssigneeId,
    @RequestParam(required = false) String comment
);

/**
 * POST /api/v1/tasks/batch-handle
 * Body: {"taskIds": [1, 2], "action": "APPROVE", "comment": "批量同意"}
 */
@PostMapping("/batch-handle")
public Result<Void> batchHandle(@RequestBody BatchHandleRequest request);
`

### 4.3 联合活动流 API

`java
/**
 * GET /api/v1/activities?category=message|task|all&timeRange=week&page=1&size=50
 * 返回按时间倒序排列的统一活动流
 */
@GetMapping("/activities")
public PageResult<ActivityItem> getUnifiedActivities(
    @RequestParam(defaultValue = "ALL") String category,
    @RequestParam(defaultValue = "WEEK") String timeRange,
    Pageable pageable
);

/** ActivityItem VO:
 * class ActivityItem {
 *     String type;           // MESSAGE | TASK
 *     String subType;        // APPROVAL | REMIND | SYSTEM_ALERT ...
 *     String title;          // 统一标题
 *     String summary;        // 统一摘要
 *     Timestamp createdAt;
 *     Boolean read;
 *     Boolean isUrgent;      // 仅代办有效
 *     String actionUrl;      // 跳转链接(deeplink)
 *     Map<String, Object> metadata;  // 差异化扩展字段
 * }
 */
`

### 4.4 Service 层接口

`java
/**
 * 业务服务主动发消息（被各微服务调用）
 */
Long publishMessage(String type, List<Long> recipients, String title, String summary, JsonNode content);

/**
 * 创建代办并自动关联消息
 */
Long createTaskWithNotification(String taskType, Long assigneeId, String bizType, String bizRefId, JsonNode metadata);
`

---

## 五、前端组件设计

### 5.1 目录结构

`
frontend/mis-admin-web/src/features/notification/
├── InboxPage.tsx                 # 主收件箱页面
├── components/
│   ├── ActivityFeed.tsx          # 统一活动流（消息+代办混排）
│   ├── MessageCard.tsx           # 消息卡片
│   ├── TaskCard.tsx              # 代办卡片（可一键操作）
│   ├── FilterBar.tsx             # 多维筛选器
│   ├── SearchBox.tsx             # 全局搜索框
│   ├── BadgeCounter.tsx          # 数字角标组件
│   └── NotificationPanel.tsx     # 侧边抽屉式快捷面板
├── hooks/
│   ├── useUnreadCount.ts         # 未读数监听 (WebSocket + SSE)
│   ├── useInboxPaginate.ts       # 分页加载逻辑
│   └── useTaskActions.ts         # 代办操作 Hook
└── stores/
    └── notification-store.ts     # Zustand store
`

### 5.2 Header Toolkit 集成

利用现有的 header-toolkit.tsx 注入消息铃铛图标和数字角标：

`	sx
// src/components/layout/header-toolkit.tsx 扩展
import { BellIcon } from 'lucide-react';
import { BadgeCounter } from '@/features/notification/components/BadgeCounter';

export function HeaderToolkit() {
  const unreadCount = useUnreadCount();
  
  return (
    <div className="flex items-center gap-2">
      {/* 其他工具按钮 */}
      
      {/* 消息通知 */}
      <button onClick={openNotificationPanel}>
        <BellIcon className="h-5 w-5" />
        {unreadCount > 0 && <BadgeCounter count={unreadCount} />}
      </button>
    </div>
  );
}
`

### 5.3 收笳页页面架构

`	sx
// InboxPage.tsx 伪代码
export function InboxPage() {
  const [viewMode, setViewMode] = useState<'combined'|'messages'|'tasks'>('combined');
  const filters = useFilterState();
  
  return (
    <div className="h-full flex flex-col">
      {/* 顶部筛选栏 */}
      <FilterBar 
        mode={viewMode}
        onChangeMode={setViewMode}
        keywords={filters.keyword}
      />
      
      {/* 统一活动流 / 或分视图 */}
      {viewMode === 'combined' ? (
        <ActivityFeed 
          items={unifiedItems}
          onAction={(item, action) => handleUnifiedAction(item, action)}
        />
      ) : viewMode === 'tasks' ? (
        <TaskList 
          items={taskItems}
          onHandle={handleTask}
        />
      ) : (
        <MessageList 
          items={messageItems}
          onOpen={openMessage}
        />
      )}
      
      {/* 底部：一键操作 */}
      <div className="border-t p-3 flex gap-2 justify-end">
        <Button onClick={markAllRead}>全部标为已读</Button>
        <Button onClick={clearOld}>清理历史记录</Button>
      </div>
    </div>
  );
}
`

### 5.4 实时推送

`	ypescript
// src/hooks/useUnreadCount.ts
export function useUnreadCount() {
  const setUnread = useNotificationStore(s => s.setUnread);
  
  useEffect(() => {
    // WebSocket 推送（推荐）
    const ws = new WebSocket('/ws/notifications');
    ws.onmessage = (evt) => {
      const { type, payload } = JSON.parse(evt.data);
      if (type === 'MESSAGE_CREATED' || type === 'TASK_ASSIGNED') {
        setUnread(prev => prev + 1);
        playAlertSound();
      }
    };
    
    // Polling fallback（30秒间隔，简单可靠）
    const timer = setInterval(async () => {
      const count = await fetchUnreadCount();
      setUnread(count);
    }, 30_000);
    
    return () => { clearInterval(timer); ws.close(); };
  }, []);
}
`

### 5.5 Router 注册

在 outer.tsx 中新增路由：

`	sx
<Route element={<AppLayout />}>
  {/* 已有路由... */}
  <Route path="/notification/*" element={null} />
</Route>
`

在侧边栏导航中添加菜单项（对应 mis-system 的 Menu 表配置）。

---

## 六、与其他系统的集成点

### 6.1 现有认证体系

`
LoginUser (com.mis.common.security.context)
    ├── userId → recipientIds / assigneeId
    ├── roles  → 决定消息可见范围 (RBAC 过滤)
    └── tenantId → 租户隔离查询
`

### 6.2 BPM/工作流系统对接

`
PurchaseService.createOrder()
    ├── 1. 创建订单记录
    ├── 2. 调用 WorkflowEngine.startProcess(orderId, flowDefinition)
    ├── 3. 流程引擎在每个节点触发:
    │       ├── triggerNotification(assigneeId, "APPROVAL", {...})
    │       │       └── ▶ 消息服务创建消息+代办
    │       └── 如果审批通过: triggerCallback(orderId, "APPROVED")
    └── 4. 最终状态同步回消息中心: updateBizStatus(taskType, bizRefId, status)
`

### 6.3 AI Agent 扩展（未来）

`python
# agent 服务的智能提醒
class AgentNotificationHandler:
    async def on_new_task(self, task: Task):
        # 基于历史数据判断优先级
        priority = self.predict_urgency(task)
        
        # 生成智能摘要
        summary = await self.generate_summary(task.metadata)
        
        # 发送个性化通知
        await self.send_personalized_notification(
            user_id=task.assignee_id,
            content=summary,
            channels=['websocket', 'email']
        )
`

---

## 七、部署方案

### 7.1 新建模块: mis-notification

`
backend/
├── pom.xml                                    # 添加子模块
├── mis-notification/                         # 新模块
│   ├── pom.xml
│   └── src/main/java/com/mis/notification/
│       ├── domain/
│       │   ├── entity/
│       │   │   ├── SysMessage.java
│       │   │   ├── SysTask.java
│       │   │   └── SysBizReference.java
│       │   └── repository/
│       ├── service/
│       │   ├── MessageService.java
│       │   ├── TaskService.java
│       │   └── NotificationScheduler.java
│       ├── controller/
│       │   ├── MessageController.java
│       │   └── TaskController.java
│       └── dto/
│           ├── MessageVO.java
│           ├── TaskVO.java
│           └── ActivityItem.java
`

### 7.2 BFF 适配层

在 mis-admin-bff 中添加代理端点供前端调用。

### 7.3 Flyway 迁移

`
flyway/Migration/V1__create_notification_tables.sql
`

包含上述所有建表语句及索引。

---

## 八、验收标准

| # | 验收项 | 说明 |
|---|--------|------|
| 1 | 收件箱功能 | 用户可以看到自己的所有消息和代办任务 |
| 2 | 多维筛选 | 支持按类型/状态/时间范围筛选 |
| 3 | 全文搜索 | 支持关键词搜索（标题+摘要） |
| 4 | 消息独立存在 | 消息可以不关联代办，独立展示 |
| 5 | 消息与代办绑定 | 消息可以关联代办，一键跳转处理 |
| 6 | 代办快速处理 | 从收件箱可直接处理代办，无需跳转 |
| 7 | 数字角标 | 未读消息/待办事宜有红色角标显示 |
| 8 | 批量操作 | 支持批量标已读、批量审批同类型代办 |
| 9 | 实时推送 | 新消息到达时实时通知（WebSocket/Polling） |
| 10 | 性能达标 | 10万级消息量下列表查询 < 500ms |