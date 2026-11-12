# 工作流整合设计规范

> **版本**: v1.0 | **日期: 2026-09-30 | **状态: 设计方案

---

## 一、设计目标

为 MIS 平台提供**灵活的工作流集成能力**，满足以下核心需求：

1. **表单可轻易整合工作流**: 一个表单提交后自动触发审批流程
2. **也可不整合工作流**: 简单表单可以直接保存/提交，无需审批环节
3. **统一表单引擎**: 基于现有 a2ui FormSheet 扩展，支持配置化定义表单结构
4. **可视化流程编排**: 审批人规则可按部门/角色/自定义条件动态指定

---

## 二、核心理念：可选工作流

### 2.1 三种业务模式

`
┌───────────────────────────────────────────────────────────┐
│                      业务表单场景                           │
├───────────────┬──────────────────┬────────────────────────┤
│   模式 A       │    模式 B         │    模式 C              │
│  纯信息收集     │  需审批的业务      │  需流转的业务           │
│               │                  │                        │
│  员工请假申请    │  采购订单创建      │  合同签署流程          │
│  访客登记       │  加班申报         │  跨部门协作请求          │
│  设备申领       │  预算变更         │  多级会签                │
├───────────────┼──────────────────┼────────────────────────┤
│  工作流        │  有工作流          │  复杂工作流              │
│               │                  │                        │
│  ✗ 不需要       │  ✓ 单级审批       │  ✓ 多节点会签            │
│               │                  │                        │
│  直接保存       │  审批通过后才生效   │  各节点独立处理         │
└───────────────┴──────────────────┴────────────────────────┘
`

### 2.2 数据流对比

**模式 A: 无工作流**

`
用户填写表单 ──▶ 点击「提交」
                    │
                    ▼
             直接持久化到业务表
                    │
                    ▼
             返回成功 + 生成一条系统通知
                    │
                 (结束)
`

**模式 B: 单级审批**

`
用户填写表单 ──▶ 点击「提交」
                    │
                    ▼
             暂存到草稿态 (PENDING)
                    │
                    ▼
             创建代办任务给审批人  ◄──► 发送通知消息
                    │                   │
                    │              WebSocket 推送
                    │
审批人看到代办 ──▶ 点击「处理」
                    │
              ┌─────┴─────┐
              │  同意      │  驳回
              ▼            ▼
         持久化生效     退回修改态
              │            │
              ▼            ▼
         生成成功通知   重新提交
              │
           (结束)
`

**模式 C: 多节点流转**

`
发起人 ──▶ 主管审批 ──▶ 财务审核 ──▶ 法务会签 ──▶ 归档
                              │              │
                             驳回          修改意见
                              │              │
                    ┌─────────┘    ┌─────────┘
                    ▼              ▼
                  退回           补充说明
                    │              │
                    └──▶ 发起人修订 ──▶ 再次提交
`

---

## 三、核心概念模型

### 3.1 流程定义与实例

`
┌────────────────────────┐         ┌────────────────────────┐
│ WorkflowDefinition      │  1:N    │ WorkflowInstance        │
│ (流程定义 - 模板)         │────────▶│ (流程实例 - 一次执行)     │
│                        │         │                        │
│ • code: PURCHASE_APP   │         │ • instanceId           │
│ • name: 采购审批流程     │         │ • definitionCode       │
│ • version: 2           │         │ • businessType         │
│                        │         │ • businessId           │
│ 节点定义:               │         │ • status               │
│  ├─ node1: 发起         │         │ • currentNode          │
│  ├─ node2: 主管审批      │         │ • currentAssignee      │
│  ├─ node3: 财务审核      │         │                        │
│  └─ node4: 归档         │         │ 当前节点运行中...       │
└────────────────────────┘         └────────────────────────┘
`

### 3.2 流程节点类型

| 节点类型 | 说明 | 示例 |
|---------|------|------|
| START | 开始节点，由发起人触发 | 员工填写请假表并提交 |
| APPROVAL | 审批节点，需指定人员审批 | 直属主管批准请假 |
| ROUTING | 会签节点，多人并行或依次处理 | 法务+财务同时审核合同 |
| CONDITIONAL | 条件分支，按条件分流 | 金额>50000 走总经理审批 |
| AUTOMATION | 自动化动作，自动执行 | 审批通过后自动创建 PO |
| END | 结束节点，流程终结 | 归档通知全员 |

### 3.3 审批人指定方式

`
审批人来源:

┌──────────────────────────────────────────┐
│                                           │
│  ① 固定人员                              │
│     assignee: "张三"                      │
│                                           │
│  ② 角色                                  │
│     role: "采购审批员"                     │
│     → 取当前系统中该角色的所有成员            │
│                                           │
│  ③ 上级主管 (层级)                         │
│     supervisor: true                       │
│     → 自动查找申请人的直属主管               │
│                                           │
│  ④ 部门领导                               │
│     deptLeader: "DEPT_HEAD"                │
│     → 自动取业务所属部门的负责人              │
│                                           │
│  ⑤ 公式计算                                │
│     expression: "" │
│     → 根据表单字段动态决定审批人             │
│                                           │
│  ⑥ 发起人自选                              │
│     allowAppointer: true                   │
│     → 提交时手动选择审批人                   │
└──────────────────────────────────────────┘
`

---

## 四、数据库设计

### 4.1 表结构

#### 表1: wf_definition — 流程定义

| 字段 | 类型 | 说明 |
|------|------|------|
| id | BIGINT | PK |
| tenant_id | BIGINT | 租户隔离 |
| code | VARCHAR(64) | 流程编码，全局唯一 |
| name | VARCHAR(128) | 流程名称 |
| category | VARCHAR(32) | 分类: APPROVAL / TRANSFER / NOTIFICATION |
| description | TEXT | 描述 |
| version | INT | DEFAULT 1, 版本号 |
| status | VARCHAR(16) | DRAFT / ACTIVE / ARCHIVED |
| form_schema | JSONB | 关联的表单结构定义 |
| config | JSONB | 流程配置 {timeoutDays: 7, retryCount: 3} |
| created_by | BIGINT | |
| created_at | TIMESTAMP | |
| updated_at | TIMESTAMP | |

#### 表2: wf_node — 流程节点

| 字段 | 类型 | 说明 |
|------|------|------|
| id | BIGINT | PK |
| definition_id | BIGINT | FK → wf_definition.id |
| node_code | VARCHAR(64) | 节点编码 |
| node_name | VARCHAR(128) | 节点名称 |
| node_type | VARCHAR(32) | APPROVAL / ROUTING / CONDITIONAL / AUTOMATION / END |
| sort_order | INT | 排序顺序 |
| condition_expr | TEXT | 条件表达式 (条件分支节点用) |
| assignee_rule | JSONB | 审批人规则 {type: "ROLE", value: "MANAGER"} |
| timeout_hours | INT | 超时小时数 |
| notify_template_id | BIGINT | 关联消息模板 |
| config | JSONB | 节点配置 |

#### 表3: wf_instance — 流程实例

| 字段 | 类型 | 说明 |
|------|------|------|
| id | BIGINT | PK |
| definition_id | BIGINT | FK → wf_definition.id |
| definition_code | VARCHAR(64) | 冗余 |
| business_type | VARCHAR(64) | 业务类型 |
| business_id | VARCHAR(128) | 业务实例 ID |
| status | VARCHAR(16) | RUNNING / COMPLETED / TERMINATED / SUSPENDED |
| initiator_id | BIGINT | 发起人 |
| initiator_name | VARCHAR(64) | |
| current_node_code | VARCHAR(64) | 当前进行中的节点 |
| form_data | JSONB | 表单原始数据快照 |
| progress | VARCHAR(32) | 进度百分比字符串 |
| completed_at | TIMESTAMP | |
| extra_context | JSONB | 额外上下文 |

#### 表4: wf_task — 流程任务（每个节点产生一个待办）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | BIGINT | PK |
| instance_id | BIGINT | FK → wf_instance.id |
| node_code | VARCHAR(64) | 节点编码 |
| node_name | VARCHAR(128) | 节点名称 |
| task_type | VARCHAR(32) | APPROVE / REVIEW / SIGN / NOTICE |
| assignee_id | BIGINT | 执行人 |
| assignee_name | VARCHAR(64) | |
| status | VARCHAR(16) | PENDING / IN_PROGRESS / COMPLETED / SKIPPED / TIMEOUT |
| due_date | TIMESTAMP | 截止时间 |
| action_result | JSONB | 操作结果 {action: "APPROVE", comment: "...", attachments: [...]} |
| created_at | TIMESTAMP | |
| completed_at | TIMESTAMP | |

#### 表5: wf_history — 流程历史

| 字段 | 类型 | 说明 |
|------|------|------|
| id | BIGINT | PK |
| instance_id | BIGINT | FK → wf_instance.id |
| node_code | VARCHAR(64) | 节点编码 |
| operator_id | BIGINT | 操作人 |
| operation | VARCHAR(32) | SUBMIT / APPROVE / REJECT / FORWARD / SKIP |
| from_node | VARCHAR(64) | 从哪个节点来 |
| to_node | VARCHAR(64) | 到哪个节点去 |
| comment | TEXT | 操作备注 |
| duration_seconds | DOUBLE | 耗时 |
| created_at | TIMESTAMP | |

### 4.2 索引设计

`sql
-- 我的待办查询
CREATE INDEX idx_wf_task_assignee ON wf_task(assignee_id, status, created_at DESC);

-- 流程实例查询
CREATE INDEX idx_wf_instance_business ON wf_instance(business_type, business_id);
CREATE INDEX idx_wf_instance_initiator ON wf_instance(initiator_id, status);

-- 流程历史查询
CREATE INDEX idx_wf_history_instance ON wf_history(instance_id) INCLUDE (node_code, operation, created_at);
`

---

## 五、API 设计

### 5.1 流程定义管理 API

`java
/**
 * POST /api/v1/workflow/definitions
 * 新建流程定义
 */
@PostMapping
public Result<Long> createDefinition(@RequestBody WorkflowDefRequest request);

/**
 * PUT /api/v1/workflow/definitions/{id}
 * 更新流程定义（仅 DRAFT 状态可改）
 */
@PutMapping("/{id}")
public Result<Void> updateDefinition(
    @PathVariable Long id,
    @RequestBody WorkflowDefUpdateRequest request
);

/**
 * GET /api/v1/workflow/definitions
 * 列出可用流程定义
 */
@GetMapping
public PageResult<WorkflowDefVO> listDefinitions(
    @RequestParam(required = false) String category,
    @RequestParam(defaultValue = "ACTIVE") String status,
    Pageable pageable
);

/**
 * POST /api/v1/workflow/definitions/{id}/activate
 * 发布流程定义
 */
@PostMapping("/{id}/activate")
public Result<Void> activateDefinition(@PathVariable Long id);
`

### 5.2 流程启动 API

`java
/**
 * POST /api/v1/workflow/{defCode}/start?businessType=PURCHASE_ORDER&businessId=123
 * 启动一个流程实例
 */
@PostMapping("/{defCode}/start")
public Result<Long> startProcess(
    @PathVariable String defCode,
    @RequestParam String businessType,
    @RequestParam String businessId,
    @RequestBody StartProcessRequest request  // {formData: {...}, skipNodes: []}
);

/**
 * GET /api/v1/workflow/instances/{instanceId}
 * 获取流程实例详情
 */
@GetMapping("/instances/{instanceId}")
public ProcessDetailVO getProcessDetail(@PathVariable Long instanceId);

/**
 * GET /api/v1/workflow/business/{bizType}/{bizId}/processes
 * 查询某条业务关联的所有流程
 */
@GetMapping("/business/{businessType}/{businessId}/processes")
public List<ProcessSummaryVO> getBusinessProcesses(
    @PathVariable String businessType,
    @PathVariable String businessId
);
`

### 5.3 流程执行 API

`java
/**
 * POST /api/v1/workflow/tasks/{taskId}/complete
 * 完成任务（审批/审核等）
 */
@PostMapping("/tasks/{taskId}/complete")
public Result<Void> completeTask(
    @PathVariable Long taskId,
    @RequestBody CompleteTaskRequest request  // {action: "APPROVE", comment: "..."}
);

/**
 * POST /api/v1/workflow/tasks/{taskId}/forward
 * 转办任务
 */
@PostMapping("/tasks/{taskId}/forward")
public Result<Void> forwardTask(
    @PathVariable Long taskId,
    @RequestParam Long targetUserId,
    @RequestParam(required = false) String comment
);

/**
 * POST /api/v1/workflow/tasks/{taskId}/reject
 * 退回任务（可退回到上一个节点或发起人）
 */
@PostMapping("/tasks/{taskId}/reject")
public Result<Void> rejectTask(
    @PathVariable Long taskId,
    @RequestParam(required = false) Integer rollbackLevel,  // null=退回上一节点, 1=退回发起人
    @RequestBody RejectTaskRequest request
);

/**
 * GET /api/v1/workflow/instances/{instanceId}/timeline
 * 获取流程时间线（历史记录）
 */
@GetMapping("/instances/{instanceId}/timeline")
public List<ProcessTimelineItem> getTimeline(@PathVariable Long instanceId);
`

---

## 六、前端集成设计

### 6.1 在现有 a2ui FormSheet 上扩展

利用已有的 FormSheet.tsx 组件做增强，添加「是否启用工作流」开关：

`	sx
// frontend/mis-admin-web/src/components/a2ui/components/FormSheet.tsx (扩展)
export function FormSheet(props: FormSheetProps & {
  workflowEnabled?: boolean;      // 是否启用工作流
  workflowDefinitionId?: number;  // 选用的流程定义ID
  onWorkflowSelect?: (definitionId: number) => void;
}) {
  const [submitting, setSubmitting] = useState(false);

  /** 提交逻辑增强 */
  async function handleSubmit(values: Record<string, any>) {
    if (props.workflowEnabled && props.workflowDefinitionId) {
      // 模式 B/C: 走流程
      setSubmitting(true);
      try {
        await startProcess({
          definitionId: props.workflowDefinitionId,
          formData: values,
        });
        toast.success('已提交审批');
      } finally {
        setSubmitting(false);
      }
    } else {
      // 模式 A: 直接保存
      await saveData(values);
      toast.success('提交成功');
    }
  }

  return (
    <div className="space-y-4">
      {/* 表单内容 */}
      <form fields={fields} onSubmit={handleSubmit} />

      {/* 工作流开关（管理员可见） */}
      {isAdmin && (
        <div className="flex items-center gap-2 border-t pt-4">
          <Checkbox
            checked={props.workflowEnabled}
            onChange={(checked) => setWorkflowEnabled(checked)}
          />
          <span>启用审批工作流</span>
          
          {props.workflowEnabled && (
            <Select 
              value={props.workflowDefinitionId}
              onChange={handleDefinitionChange}
            >
              <option value="">请选择审批流程</option>
              {definitions.map(d => (
                <option key={d.id} value={d.id}>{d.name} (v{d.version})</option>
              ))}
            </Select>
          )}
        </div>
      )}
    </div>
  );
}
`

### 6.2 审批中心页面

新增 /agent/approvals 路由下的审批处理页面：

`	sx
// features/agent/approval-center-page.tsx (已有)
// 在此基础上新增流程实例查看功能

export function ApprovalCenterPage() {
  const tabs = ['MY_TASKS', 'MY_SENT', 'ALL_HISTORY'];
  
  return (
    <Tabs defaultValue={tabs[0]}>
      <TabsList>
        <TabsTrigger value={tabs[0]}>待我处理</TabsTrigger>
        <TabsTrigger value={tabs[1]}>我提交的</TabsTrigger>
        <TabsTrigger value={tabs[2]}>全部记录</TabsTrigger>
      </TabsList>
      
      <TabsContent value={tabs[0]}>
        {/* 使用 TaskCard 渲染待办 */}
        <TaskCardList tasks={myPendingTasks} onHandle={handleTask} />
      </TabsContent>
      
      <TabsContent value={tabs[1]}>
        {/* 展示我已发起的流程列表 */}
        <ProcessList processes={myProcesses} onView={viewProcessDetail} />
      </TabsContent>
    </Tabs>
  );
}
`

### 6.3 审批卡片交互

`	sx
// components/a2ui/components/ApprovalCard.tsx (已有)
// 增强为支持流程内审

export function ApprovalCard(props: {
  task: TaskVO;
  processHistory?: ProcessTimelineItem[];
  onApprove?: () => void;
  onReject?: (comment: string) => void;
  onForward?: (userId: number) => void;
}) {
  return (
    <Card className="border-l-4 border-l-primary">
      <CardHeader>
        <CardTitle>{props.task.title}</CardTitle>
        <CardDescription>{props.task.description}</CardDescription>
      </CardHeader>
      
      <CardContent>
        {/* 表单预览 */}
        <DataTable data={props.task.formData} readOnly />
        
        {/* 流程时间线（如有） */}
        {props.processHistory && (
          <ApprovalTimeline items={props.processHistory} />
        )}
      </CardContent>
      
      <CardFooter className="gap-2 justify-end">
        <Button variant="outline" onClick={() => setShowForwardDialog(true)}>
          转办他人
        </Button>
        <Button variant="destructive" onClick={handleReject}>
          驳回
        </Button>
        <Button variant="default" onClick={props.onApprove}>
          同意
        </Button>
      </CardFooter>
    </Card>
  );
}
`

### 6.4 表单设计器（高级功能，可选阶段实施）

为管理员提供可视化表单设计能力：

`
前端目录:
src/features/system/form-designer/
├── DesignerPage.tsx            # 表单设计主页面
├── components/
│   ├── FieldPalette.tsx        # 字段拖拽区
│   ├── Canvas.tsx              # 画布区域
│   ├── PropertyPanel.tsx       # 属性配置面板
│   └── PreviewPane.tsx         # 实时预览
└── schema/
    └── field-types.ts          # 支持的字段类型定义
`

支持的字段类型：
- 文本类：Text, TextArea, RichText, Select, MultiSelect, DatePicker
- 数值类：Number, Currency, Percentage, Range
- 关联类：ForeignKey, SelfReference, TreePicker
- 附件类：FileUpload, ImageUpload
- 公式类：AutoCalc, Concat, Format

---

## 七、部署方案

### 7.1 模块划分

`
backend/
├── pom.xml                              # 添加子模块
├── mis-notification/                    # 第1部分：消息+代办
│   └── ...
└── mis-workflow/                        # 新模块：工作流引擎
    ├── pom.xml
    └── src/main/java/com/mis/workflow/
        ├── domain/
        │   ├── entity/
        │   │   ├── WfDefinition.java
        │   │   ├── WfNode.java
        │   │   ├── WfInstance.java
        │   │   ├── WfTask.java
        │   │   └── WfHistory.java
        │   └── repository/
        ├── service/
        │   ├── DefinitionService.java    # 流程定义CRUD
        │   ├── ProcessService.java       # 流程实例管理
        │   ├── TaskService.java          # 任务执行
        │   └── AssignmentResolver.java   # 审批人解析器
        ├── controller/
        │   ├── DefinitionController.java
        │   └── ProcessController.java
        └── support/
            ├── AssigneeRuleEvaluator.java
            ├── ConditionEvaluator.java
            └── SpelExpressionEngine.java
`

### 7.2 前端路由

`	sx
// router.tsx 新增
<Route element={<AppLayout />}>
  {/* 已有路由 */}
  <Route path="/workflow/*" element={null} />
</Route>
`

### 7.3 Flyway 迁移脚本

`
flyway/Migration/V3__create_workflow_tables.sql
`

包含上述所有建表语句。

---

## 八、渐进式实施建议

### 第一阶段：基础能力（最小可行产品）

| 功能 | 范围 | 预计工作量 |
|------|------|-----------|
| 流程定义管理 | 支持 1-3 个常用审批流程静态定义 | 3 天 |
| 表单集成 | 在采购审批等关键表单上加工作流开关 | 2 天 |
| 审批处理 | 待办列表中可直接审批 | 2 天 |
| 消息联动 | 审批通过/驳回自动生成通知消息 | 1 天 |

### 第二阶段：增强能力

| 功能 | 范围 |
|------|------|
| 多级审批 | 支持链式审批、会签 |
| 条件分支 | 基于表单字段值自动分流 |
| 审批人动态解析 | 按角色/主管/部门自动分配 |
| 流程时间线 | 完整的历史追踪视图 |

### 第三阶段：高级能力

| 功能 | 范围 |
|------|------|
| 可视化表单设计器 | 拖拽式表单构建 |
| 流程编辑器 | 可视化 BPMN 风格流程编排 |
| 统计报表 | 审批效率分析、瓶颈定位 |
| AI 辅助 | 智能提醒、异常检测、建议审批 |

---

## 九、验收标准

| # | 验收项 | 说明 |
|---|--------|------|
| 1 | 表单可配工作流 | 管理员可为不同表单选择不同的审批流程 |
| 2 | 表单可不配工作流 | 简单表单直接保存，无需审批 |
| 3 | 审批人在前端可操作 | 从代办列表直接进入审批界面 |
| 4 | 审批结果联动通知 | 审批通过/驳回自动生成消息通知 |
| 5 | 审批超时预警 | 超期未处理的代办发出催办通知 |
| 6 | 流程可追溯 | 可查看任意业务的完整审批时间线 |
| 7 | 转办功能 | 支持临时转办给同事 |
| 8 | 退回功能 | 支持驳回到上一个节点或发起人 |