# MIS 平台：消息·日志·工作流·UI 综合架构设计 (最终版)

> **版本**: v3.0 | **日期**: 2026-10-08  
> **适用范围**: 统一消息中心、操作日志、工作流集成及前端 UI 交互  
> **核心目标**: 建立稳健、透明且全链路闭环的企业级管理平台

---

## 一、 核心概念与联动模型

### 1. 消息中心与代办体系的精简设计
*   **去中心化桥接**：移除冗余的 sys_biz_reference 表。在 sys_message 表中增加 
eference_task_id 字段：
    *   **纯通知**：关联为 NULL（独立存在）。
    *   **待办通知**：指向具体的 sys_task.id（形成双向引用）。
*   **接收者明细**：主表保留 
eceiver_ids[] 数组用于快速过滤，子表 sys_message_receiver 记录每个用户的已读、处理等精确状态。

### 2. 业务日志的分层记录
*   **网关层 (sys_http_log)**：记录 HTTP 轨迹、耗时、参数 JSON。
*   **应用层 (sys_audit_op)**：通过 @BusinessOperation AOP 注解记录业务语义化操作（如谁修改了什么），提供结构化变更前后对比。

---

## 二、 数据库设计规范

| 表名 | 说明 | 关键字段 |
|------|------|----------|
| sys_task | 代办任务主表 | biz_type, biz_ref_id, assignee_id, status, metadata(JSONB) |
| sys_message | 消息中心表 | receiver_ids[], reference_task_id, read_count |
| sys_message_receiver | 接收者明细表 | user_id, message_id, read(Boolean), task_id |
| wf_definition | 流程定义表 | supported_form_codes(TEXT[]) 存储表单 Code 白名单 |
| wf_instance | 流程实例表 | started_form_code, post_process_status, post_retry_count |
| iz_exec_lock | 分布式锁表 | biz_id, status(RUNNING/SUCCESS/FAILED), operator_service_id |
| iz_execution_task | 本地任务消息表 | action_type, payload, tx_status(WAITING/SUCCESS/FAILED) |

---

## 三、 工作流与表单集成策略 (Workflow Integration)

### 1. 表单白名单机制 (Whitelist Mapping)
一个流程允许绑定多个不同的 ormCode，以适应不同角色或场景的需求：
*   **配置方式**：在流程设计器的属性面板中勾选允许的表单 Code（如 PUR_ORDER_FORM）。
*   **运行时匹配**：用户提交时传入的 started_form_code 必须在流程定义的白名单内。

### 2. 流程外壳模式 (ProcessShell)
引入统一的容器组件 ProcessShell 来接管审批逻辑，表单组件仅负责数据渲染。
*   **决策权在外壳**：外壳根据 wf_instance 状态判断当前是"员工填写态"还是"领导审批态"。
*   **动态按钮注入**：同意/驳回等操作按钮由外壳根据权限动态挂载到页面底部，而非写死在表单代码里。
*   **视觉追踪**：外壳顶部展示基于 wf_history 生成的流程图进度条，直观反映单据流转情况。

---

## 四、 高可用与异常闭环体系 (Robustness Strategy)

为解决跨服务调用的"单边"问题，采用以下三重防线：

### 防线 1：本地消息表 (Outbox Pattern)
所有触发条件（如审批结束）均转化为对 iz_execution_task 表的异步插入。后台定时扫描该表执行真实 API 调用，防止因网络波动导致的指令丢失。

### 防线 2：严格的分布式锁表 (Lock Table)
替代内存锁 synchronized。执行物理动作前，先 INSERT INTO biz_exec_lock。
*   **防竞争机制**：若 INSERT 失败（发生并发竞争），系统进入"状态轮询确认"模式，必须等到查询结果显示对方状态为 SUCCESS 才返回成功，绝不盲目自信。

### 防线 3：人工干预与修复看板 (Manual Override)
*   **重试队列**：记录所有 post_process_status 失败的实例，支持按指数退避算法自动重试。
*   **管理员兜底**：提供【执行监控中心】，支持一键手动重试、强制归档（绕过阻塞逻辑）、以及查看详细报错堆栈。

---

## 五、 前端交互与 UI 规范

| 区域 | 职责 | 数据来源 |
|------|------|----------|
| 顶部 | 面包屑导航 | 路由配置 |
| 上部 | 流程图示 (FlowCanvas) | wf_history 实时计算 |
| 中部 | 业务表单区 (FormSheet) | wf_instance.started_form_code 动态加载 |
| 底部 | 固定式操作栏 (Approval Bar) | 由 ProcessShell 根据节点类型控制显隐 |

### 交互细节
*   **双重锁定**：点击提交后，立即锁定整个页面的 disabled 状态，并显示 Loading 遮罩。
*   **乐观反馈**：审批通过后，立即跳转至 "进度追踪页"，即使底层异步动作还在排队。

---

## 六、 标准化开发实施路线图 (SOP)

| 阶段 | 重点动作 | 产出物 |
|------|----------|--------|
| P1: 基础设施 | 建库建表 (WF_*, Biz_*) + 注册新模块 mis-taskflow | SQL 迁移脚本、基础 Entity 类 |
| P2: 核心逻辑 | 实现 Outbox 监听器 + 分布式锁表排他逻辑 + 定时修复 Job | Service 层核心代码 |
| P3: 前端交互 | 搭建 ProcessShell 容器 + 审批专用视图 ApprovalView.tsx | 完整的工作流交互组件 |
| P4: 联调测试 | 模拟宕机、断网、并发竞争场景，验证自动重试与恢复能力 | 自动化测试报告 |

---

## 七、 核心业务流程实现代码 (Implementation Logic)

### 1. 流程发起 (Initiate)：事务一致性与异步触发
**场景**：员工提交审批，确保数据落库且任务被记录。

`java
@Service
public class LeaveApplyService {
    
    /**
     * 表单提交主入口
     */
    @Transactional // 保证业务数据与任务日志在同一事务中
    public void submit(SubmitRequest req) {
        // 1. 保存业务实体（状态为 PENDING）
        EmployeeLeave leave = new EmployeeLeave();
        leave.setApplicantId(req.getUserId());
        leave.setStartTime(req.getStartTime());
        leave.setStatus("PENDING"); 
        leaveRepo.save(leave);

        // 2. [Outbox] 写入后置任务表：等待扫描器触发工作流
        BizExecutionTask task = new BizExecutionTask();
        task.setActionType("START_WORKFLOW");
        task.setPayload("{"type": "LEAVE_APPROVAL", "bizId": "" + leave.getId() + ""}");
        task.setTxStatus("WAITING");
        bizExecutionTaskRepo.save(task);
    }
}
`

### 2. 审批节点处理 (Approve / Reject)：权限校验与状态流转
**场景**：主管进行同意或驳回操作。

`java
@Service
@RequiredArgsConstructor
public class LeaveApproveService {
    
    private final LeaveRepo leaveRepo;
    private final WfInstanceRepo wfRepo;
    private final MessagePublisher messagePublisher;

    /**
     * 通用审批入口
     * @param taskId 当前待办 ID
     * @param action APPROVE 或 REJECT
     * @param comment 审批意见
     */
    @Transactional
    public void handleTask(Long taskId, String action, String comment) {
        WfTask task = wfRepo.findById(taskId).orElseThrow(...);
        
        // 1. 校验当前用户是否为该节点的合法审批人
        if (!isAuthorized(task.getAssigneeId(), currentUser)) {
            throw new AccessDeniedException("无权处理此待办");
        }

        // 2. 获取关联的业务单据
        EmployeeLeave leave = leaveRepo.findById(task.getBizId()).orElseThrow(...);
        
        // 3. 执行业务逻辑
        try {
            if ("APPROVE".equals(action)) {
                leave.setStatus("PROCESSING"); // 流程进行中
                // ... 其他审批通过逻辑
            } else {
                leave.setStatus("REJECTED");   // 流程结束
                // ... 驳回逻辑
                messagePublisher.notify(leave.getApplicantId(), "申请已被驳回");
                return; // 驳回直接结束，无需进入后处理阶段
            }
            
            // 4. 标记任务完成，触发下一个节点或后处理机制
            task.setStatus("COMPLETED");
            task.setComment(comment);
            wfRepo.save(task);
            
            // 如果是最后一个节点，触发 Post-Processing 记录插入
            if (task.isLastNode()) {
                triggerPostProcess(leave); 
            }
            
        } catch (Exception e) {
            // 记录异常并更新锁表状态，防止状态卡死
            task.setStatus("ERROR");
            task.setErrorMsg(e.getMessage());
            wfRepo.save(task);
        }
    }

    private void triggerPostProcess(EmployeeLeave leave) {
        // 向本地消息表写入一条归档请求
        BizExecutionTask task = new BizExecutionTask();
        task.setActionType("FINALIZE_LEAVE");
        task.setPayload("{"bizId": "" + leave.getId() + ""}");
        task.setTxStatus("WAITING");
        bizExecutionTaskRepo.save(task);
    }
}
`

---

## 八、 审批界面只读状态设计方案 (Read-Only Rendering Scheme)

在 MIS 平台中，审批视图必须保持**视觉一致性**，同时区分**交互权限**。我们采用 **"组件映射替换法"** 来实现。

### 1. 设计原则
*   **布局不塌陷**：只读模式下的文字高度应与输入框高度一致，避免页面跳动。
*   **可选中复制**：禁止使用 disabled 属性，因为 Disabled 元素通常不可选中文本，也不方便复制。
*   **视觉反馈**：通过背景色或边框样式明确告知用户当前处于“查看态”。

### 2. 字段映射策略 (Mapping Strategy)
在 FormSheet 渲染引擎中，根据 isReadOnly 标志动态选择组件：

| 原始类型 | 编辑态组件 (Edit) | 只读态组件 (View) | 实现细节 |
|----------|------------------|------------------|----------|
| **TEXT** | <input type="text"> | <span class="readonly-text"> | 继承 Input 的 Padding/Height，去除边框，添加浅灰背景 |
| **SELECT** | <select> | <div><Badge /></div> | 渲染 Option 的 label 而非 alue，展示为 Tag 标签 |
| **DATE** | <DatePicker /> | <TimeLineItem /> | 格式化为 YYYY-MM-DD，显示为纯文本段落 |
| **UPLOAD** | <Upload.Dragger /> | <File.ListCard /> | 仅显示文件名和下载图标，不显示上传按钮 |
| **RICH_TEXT**| <Editor /> | <MarkdownViewer /> | 将富文本 HTML 解析为静态 DOM |

### 3. 前端代码实现结构

在 FormSheet 容器中使用工厂模式切换渲染逻辑：

`	sx
// src/components/forms/FormSheet.tsx
const VIEW_MAPPING = {
  TEXT: ReadOnlySpan,
  SELECT: ReadOnlyTag,
  DATE: ReadOnlyText,
  RICH_TEXT: ReadOnlyRichView
};

function renderField(field, readOnly) {
  const Component = readOnly ? VIEW_MAPPING[field.type] : getEditComponent(field.type);
  
  return (
    <div className={readOnly ? "field-read-only-wrapper" : "field-edit-wrapper"}>
      {React.createElement(Component, { value: formData[field.name], ...props })}
    </div>
  );
}
`

### 4. CSS 样式优化建议

为了实现完美的“伪只读”效果，建议针对只读字段编写专门的 Class：

`css
/* 模拟 input 外观但无交互感 */
.field-read-only-wrapper .readonly-text {
  width: 100%;
  min-height: 36px;
  padding: 6px 12px;
  background-color: #f9fafb; /* 浅灰底 */
  color: #111827;             /* 正常黑字 */
  border-radius: 4px;
  border: 1px solid transparent; /* 无边框 */
  font-size: 14px;
  line-height: 1.5;
  cursor: default;
  overflow: hidden;
  white-space: normal;
}
`

---

## 九、 交互细节：代办发起与进程可视化 (Interaction Details)

### 1. 首页代办项点击后的展示与操作流程

当用户在“消息中心”或“首页待办列表”点击某条任务时，不应直接打开表单，而是进入一个名为 **ProcessShell（流程外壳）** 的全功能容器视图。

#### 页面布局结构建议：
`	ext
┌────────────────────────────── ProcessShell ──────────────────────────────┐
│                                                                          │
│ [A区] 顶部：流程进度条 (FlowCanvas)                                      │
│ ○ → ○ → ⬤(蓝色高亮) → ○                                                  │
│ (完成)  (审批中)  (财务核价)                                              │
│                                                                          │
│ [B区] 中部：业务表单区 (ReadOnly Mode)                                   │
│ ┌──────────────────────────────────────────────────────────────────────┐ │
│ │ 申请单号: PO-2026-001 | 状态：流程处理中                               │ │
│ │                                                                      │ │
│ │ [ 采购项目: xxx服务器 ... ]  ← 纯文本展示，无输入框                    │ │
│ │ [ 预算金额: ¥ 50,000.00 ]                                          │ │
│ │ [ 附件: 报价单.pdf                 ]                               │ │
│ └──────────────────────────────────────────────────────────────────────┘ │
│                                                                          │
│ [C区] 底部：固定式审批栏 (由外壳根据身份动态注入)                          │
│                                                                              │
│   [转办他人 ▼]  [备注原因 ▼]  [驳回 ↻]                  [同意 √]       │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
`
**关键原则：**
*   **中间只读**：B区的内容永远保持只读可视状态，防止审批人在处理过程中误改原数据。
*   **底部按钮动态化**：C区的操作按钮不是写死在表单里的，而是由外壳 ProcessShell 根据当前用户角色和节点状态自动渲染的。

### 2. 节点参与人的自动计算与进度图显示

**是的，必须自动计算。** 这样用户既能看到历史轨迹，也能预见未来的责任归属。前端需结合 wf_instance（实例）和 wf_definition（定义）的数据进行实时解析。

#### 参与人展示映射逻辑表：

| 节点阶段 | 视觉表现 | 数据来源 | 示例效果 |
| :--- | :--- | :--- | :--- |
| **已完成节点** | 显示经办人头像 + 姓名<br>(通常带绿色勾) | wf_history 表中取到的 operator_name | ✅ 张经理 (已通过) |
| **当前执行节点** | 头像带旋转动画/高亮边框<br>(表示正在处理) | wf_instance 中取到的 current_assignee | 🔄 财务李四 (处理中) |
| **未来待达节点** | 仅显示职位/部门角色<br>(灰色占位图标) | 解析 ssignee_rule JSON 提取的角色描述 | 💭 采购总监 |

#### 进度条 Tooltip 交互详情：
当鼠标悬停在某个灰色的“未来节点”上时，Tooltip 应显示详细的预计流转信息：
*   **显示内容**：“预计滞留 2h · 审批人：人事专员”
*   **作用**：消除用户“我的单子到底卡在谁手上了”的焦虑。
