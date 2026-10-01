# 统一操作日志体系设计

> **版本**: v1.0 | **日期**: 2026-09-30 | **状态**: 设计方案

---

## 一、现状分析

### 当前问题

MIS 平台现有的 sys_oper_log 表 (com.mis.audit.domain.entity.SysOperLog) 存在以下痛点：

| 问题 | 表现 | 影响 |
|------|------|------|
| **数据格式生硬** | request_params 存原始 JSON，response_code 仅数字码 | 运维/审计人员需读懂程序内部结构 |
| **查询不便** | 只能通过 SQL 或简单列表过滤，无结构化检索能力 | 故障排查效率低 |
| **展示层级缺失** | 只有接口调用轨迹，缺少业务语义表达 | 无法直观理解「谁做了什么」 |
| **性能瓶颈** | 全量记录所有 HTTP 请求参数，数据量大且索引不足 | 分页查询慢，难以支撑长时间跨度查询 |
| **缺乏关联上下文** | 仅记录 HTTP 层信息，不关联具体业务实体变更 | 无法追溯「修改了什么业务数据」 |

### 现有表结构回顾

`java
// SysOperLog.java (现有)
@Entity
@Table(name = "sys_oper_log")
public class SysOperLog {
    private Long id;
    private Long tenantId;
    private Long userId;
    private String username;
    private String module;      // 模块名
    private String operation;   // 操作名
    private String method;      // Java方法名
    private String requestUri;  // 请求URI
    private String requestMethod;
    private String requestParams;     // ★ 原始JSON参数 ★
    private Integer responseCode;     // ★ 仅状态码 ★
    private Integer durationMs;
    private String ip;
    private Instant operTime;
}
`

---

## 二、设计目标

1. **提供易读的查看界面**：不再是搜索程序日志里的 JSON，而是结构化的、人类可读的表格视图
2. **分层记录**：HTTP 层 + 业务层分离记录，互不影响
3. **统一报表展示**：支持按时间线、操作者、模块多维筛选，支持导出 CSV/Excel
4. **兼容现有 sys_oper_log**：保留原表作为底层存储，新增增强字段做上层聚合

---

## 三、核心模型

### 3.1 三层日志架构

`
┌─────────────────────────────────────────────────────┐
│                  应用层 - 操作审计                   │
│  sys_audit_op        (业务语义化操作记录)              │
│  ┌──────────────┬──────────────┬──────────────┐     │
│  │ CRUD操作日志   │ 审批流程日志   │ 权限变更日志   │     │
│  └──────────────┴──────────────┴──────────────┘     │
│                       ▲                             │
├─────────────────────────────────────────────────────┤
│                  网关层 - HTTP 审计                   │
│  sys_http_log        (HTTP 请求追踪)                  │
│  ┌──────────────┬──────────────┬──────────────┐     │
│  │ 请求详情       │ 响应详情       │ 耗时统计       │     │
│  └──────────────┴──────────────┴──────────────┘     │
├─────────────────────────────────────────────────────┤
│                  系统层 - 基础日志                    │
│  sys_login_log     (登录行为)                        │
│  syslog / ELK      (程序运行日志)                     │
└─────────────────────────────────────────────────────┘
`

### 3.2 关系图

`
┌───────────────┐         ┌───────────────┐
│ sys_http_log  │────────▶│ sys_audit_op  │
│               │  1:N    │               │
│ • HTTP 请求    │         │ • 业务操作类型   │
│ • 请求参数     │         │ • 操作前快照     │
│ • 响应结果     │         │ • 操作后快照     │
│ • 耗时        │         │ • 影响行数       │
│ • TraceId     │         │ • 操作结论       │
└───────────────┘         └───────────────┘
         ▲                        │
         │                        ▼
    Gateway Filter           前端审计报表页
                               ├─ 时间线视图
                               ├─ 变更对比视图
                               └─ 统计报表
`

---

## 四、数据库设计

### 4.1 新表: sys_audit_op — 业务操作审计主表

与现有 sys_oper_log **并行存在**，提供更丰富的业务语义记录。

| 字段 | 类型 | 说明 |
|------|------|------|
| id | BIGINT | PK, 雪花ID |
| tenant_id | BIGINT | 租户隔离 |
| user_id | BIGINT | 操作用户ID |
| username | VARCHAR(64) | 操作用户名 |
| module | VARCHAR(64) | 业务模块 (如「采购管理」「组织架构」) |
| operation_type | VARCHAR(32) | 操作类型: CREATE/UPDATE/DELETE/APPROVE/REJECT/ASSIGN/EXPORT |
| business_type | VARCHAR(64) | 业务类型标识 (如 PURCHASE_ORDER, EMPLOYEE_RECORD) |
| business_id | VARCHAR(128) | 业务实例ID |
| description | VARCHAR(512) | 操作描述（人类可读，如「批准了采购单 PO-2026-0012」） |
| before_data | JSONB | 变更前数据快照 |
| after_data | JSONB | 变更后数据快照 |
| diff_summary | JSONB | 变更差异摘要 [{field, old, new}] |
| trace_id | VARCHAR(64) | 关联 http_log 的 traceId |
| http_log_id | BIGINT | FK → sys_http_log.id |
| result_status | VARCHAR(16) | SUCCESS / FAIL / PARTIAL |
| error_msg | TEXT | 失败时错误信息 |
| duration_ms | INTEGER | 业务处理耗时 |
| extra_context | JSONB | 扩展上下文 {approvalChain: [...], changeReason: "..."}' |
| created_at | TIMESTAMP | |

### 4.2 增强现有 sys_http_log

建议对现有 sys_oper_log 加字段做增强，同时新建 sys_http_log 做独立 HTTP 审计：

`sql
-- 方案A: 直接在现有表上加列（推荐，向后兼容）
ALTER TABLE sys_oper_log 
  ADD COLUMN description VARCHAR(512),
  ADD COLUMN business_type VARCHAR(64),
  ADD COLUMN business_id VARCHAR(128),
  ADD COLUMN before_data JSONB DEFAULT '{}',
  ADD COLUMN after_data JSONB DEFAULT '{}',
  ADD COLUMN diff_summary JSONB DEFAULT '[]',
  ADD COLUMN result_status VARCHAR(16) DEFAULT 'SUCCESS';

-- 方案B: 新建独立 http_log 表（更干净，但不改已有 audit 表）
CREATE TABLE sys_http_log (
    id BIGINT PRIMARY KEY,
    tenant_id BIGINT NOT NULL,
    trace_id VARCHAR(64),
    user_id BIGINT,
    username VARCHAR(64),
    method VARCHAR(10),
    uri VARCHAR(512),
    request_headers JSONB DEFAULT '{}',
    request_body JSONB DEFAULT '{}',
    status_code INTEGER,
    response_body JSONB DEFAULT '{}',
    ip VARCHAR(64),
    user_agent VARCHAR(512),
    duration_ms INTEGER,
    created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX idx_http_trace ON sys_http_log(tenant_id, trace_id);
CREATE INDEX idx_http_user_time ON sys_http_log(user_id, created_at DESC);
`

### 4.3 保留并增强现有 sys_oper_log

`sql
-- 给原有表增加便捷查询索引
CREATE INDEX idx_operlog_username_time ON sys_oper_log(username, oper_time DESC);
CREATE INDEX idx_operlog_module ON sys_oper_log(module, oper_time DESC);
`

---

## 五、自动采集机制

### 5.1 AOP 切面自动记录

利用 Spring AOP 自动拦截 Controller 层的写操作：

`java
@Aspect
@Component
public class AuditOpLoggingAspect {

    @Autowired private SysAuditOpService auditService;

    /**
     * 拦截标记了 @BusinessOperation 注解的方法
     */
    @Around("@annotation(bizOp)")
    public Object around(ProceedingJoinPoint pjp, BusinessOperation bizOp) throws Throwable {
        long start = System.currentTimeMillis();
        LoginUser user = SecurityContextHolder.getLoginUser();
        
        try {
            Object result = pjp.proceed();
            
            // 成功时记录操作
            SysAuditOp op = buildOp(pjp, bizOp, user, true, null, result);
            auditService.save(op);
            
            return result;
        } catch (Exception e) {
            // 失败时也记录
            SysAuditOp op = buildOp(pjp, bizOp, user, false, e.getMessage(), null);
            auditService.save(op);
            throw e;
        } finally {
            // 更新耗时
            auditService.updateDuration(traceId, System.currentTimeMillis() - start);
        }
    }
}

/**
 * 业务注解定义
 */
@Target(ElementType.METHOD)
@Retention(RetentionPolicy.RUNTIME)
public @interface BusinessOperation {
    String module();           // 模块名称
    String description();      // 操作描述模板 (如「{operationType}了{businessType} 」)
    OperationType type();      // 操作类型
    Class<?> entityClass();    // 实体类，用于取 before/after 快照
    boolean captureBefore();   // 是否记录变更前数据
    boolean captureAfter();    // 是否记录变更后数据
}
`

### 5.2 使用示例

`java
@PutMapping("/orders/{id}")
@BusinessOperation(
    module = "采购管理",
    description = "更新了采购单 #{id}",
    type = UPDATE,
    entityClass = PurchaseOrder.class,
    captureBefore = true,
    captureAfter = true
)
public Result<Void> updateOrder(
    @PathVariable Long id,
    @RequestBody PurchaseOrderDTO dto
) {
    purchaseService.update(id, dto);
    return Result.success();
}
`

输出到前端审计界面即显示为：

| 时间 | 用户 | 模块 | 操作 | 业务 | 描述 | 状态 | 耗时 |
|------|------|------|------|------|------|------|------|
| 2026-09-30 10:30 | 张三 | 采购管理 | UPDATE | PURCHASE_ORDER | 更新了采购单 PO-2026-0012 | ✅成功 | 45ms |

点击查看详情可查看完整的 before/after 数据对比。

### 5.3 JPA EntityListener 集成

对需要持久追踪的数据变更，在 EntityListener 中捕获：

`java
@EntityListeners(AuditDataListener.class)
@Entity
public class SysEmployee { ... }

public class AuditDataListener {

    @PostUpdate
    public void onPostUpdate(SysEmployee entity) {
        LoginUser user = SecurityContextHolder.getLoginUser();
        
        AuditDataSnapshot before = snapshotCache.get(entity.getId());
        if (before != null) {
            AuditDiff diff = computeDiff(before, entity);
            
            SysAuditOp op = new SysAuditOp();
            op.setModule("员工管理");
            op.setOperationType(OperationType.UPDATE);
            op.setBusinessType("EMPLOYEE_RECORD");
            op.setBusinessId(String.valueOf(entity.getId()));
            op.setDescription("更新了员工「" + entity.getRealName() + "」的信息");
            op.setBeforeData(before.toJson());
            op.setAfterData(entityToJson(entity));
            op.setDiffSummary(diff.toJsonArray());
            auditService.save(op);
            
            snapshotCache.remove(entity.getId());
        }
    }

    @PrePersist
    public void onPrePersist(SysEmployee entity) {
        // 存入缓存，等待 PostUpdate 做比对
        snapshotCache.put(entity.getId(), entityToSnapshot(entity));
    }
}
`

---

## 六、前端审计报表设计

### 6.1 目录结构

`
frontend/mis-admin-web/src/features/system/audit/
├── AuditListPage.tsx             # 审计列表主页面
├── components/
│   ├── AuditTimeline.tsx         # 时间线视图
│   ├── AuditDiffViewer.tsx       # 变更对比视图
│   ├── AuditFilterBar.tsx        # 多维筛选器
│   ├── AuditStatisticsPanel.tsx  # 统计面板
│   └── AuditExportButton.tsx     # 导出按钮
├── hooks/
│   ├── useAuditFilters.ts        # 筛选逻辑
│   └── useAuditPagination.ts     # 分页加载
└── stores/
    └── audit-store.ts            # Zustand store
`

### 6.2 页面布局

`
┌──────────────────────────────────────────────────────────┐
│  操作审计                                                    │
│                                                      │
│  [📅 日期范围 ▼]  [👤 用户 ▼]  [📦 模块 ▼]          │
│  [⚙️ 操作类型 ▼]  [🔍 关键词输入框]    [查询] [重置]    │
│                                                      │
│  统计: 今日操作 128 次 | 本周操作 892 次 | 高风险操作 3 次 │
├──────────────────────────────────────────────────────────┤
│                                                          │
│  ┌──────┬──────────┬────────┬────────┬─────┬──────┐    │
│  │选择  │ 时间      │ 用户   │ 模块   │ 操作 │ 状态 │    │
│  ├──────┼──────────┼────────┼────────┼─────┼──────┤    │
│  │ ☐    │ 09:30:15  │ 张三   │ 采购管理 │ 更新 │ ✅   │    │
│  │      │          │        │        │ 订单 │      │    │
│  │      │          │        │        │      │ 45ms │    │
│  │ ☐    │ 09:28:42  │ 李四   │ 组织人事 │ 创建 │ ✅   │    │
│  │      │          │        │        │ 部门 │      │    │
│  │      │          │        │        │      │ 23ms │    │
│  │ ☐    │ 09:15:07  │ 王五   │ 知识管理 │ 删除 │ ❌   │    │
│  │      │          │        │        │ 文档 │      │    │
│  │      │          │        │        │      │ 12ms │    │
│  └──────┴──────────┴────────┴────────┴─────┴──────┘    │
│                                                          │
│  < 1 2 3 ... 20 >                                       │
│                              [导出CSV] [导出Excel]        │
└──────────────────────────────────────────────────────────┘
`

### 6.3 详情弹窗 - 变更对比

`
┌─────────────────────────────────────────────────────┐
│  操作详情 - 更新了采购单 PO-2026-0012                  │
├─────────────────────────────────────────────────────┤
│  📋 基本信息                                         │
│  • 操作用户: 张三                                      │
│  • 操作时间: 2026-09-30 10:30:15                      │
│  • 操作类型: UPDATE                                    │
│  • 耗时: 45ms                                          │
│                                                      │
│  📊 变更对比                                         │
│  ┌────────────┬────────────────┬────────────────┐   │
│  │ 字段名       │ 变更前          │ 变更后          │   │
│  ├────────────┼────────────────┼────────────────┤   │
│  │ 采购金额     │ ¥50,000.00     │ ¥65,000.00     │   │
│  │ 供应商       │ 旧供应商A      │ 新供应商B      │   │
│  │ 备注        │ —              │ 紧急追加采购    │   │
│  └────────────┴────────────────┴────────────────┘   │
│                                                      │
│  🔗 相关操作链                                       │
│  ┃ 10:00:00 创建采购单 (李四)                         │
│  ┣━ 10:30:15 更新采购单 (张三) ← 当前                 │
│  ┗━ 10:45:20 提交审批 (张三)                          │
└─────────────────────────────────────────────────────┘
`

### 6.4 时间线视图

`
审核时间线 - 采购单 PO-2026-0012
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🟢 创建 (10:00:00)
   李四 创建了采购单
   金额: ¥50,000 | 供应商: 供应商A

● 更新 (10:30:15) ← 当前
   张三 更新了采购单
   金额: ¥50,000 → ¥65,000
   供应商: 供应商A → 供应商B
   备注: 紧急追加采购

🟢 提交审批 (10:45:20)
   张三 提交了审批

🟡 审批中 (11:00:00)
   进入主管审批节点
`

---

## 七、API 设计

`java
/**
 * GET /api/v1/audit-ops
 * 查询操作日志列表
 * ?userId=xxx&module=xxx&type=xxx&startTime=xxx&endTime=xxx&page=1&size=20
 */
@GetMapping
public PageResult<AuditOpVO> listOps(
    @RequestParam(required = false) Long userId,
    @RequestParam(required = false) String module,
    @RequestParam(required = false) String operationType,
    @RequestParam(required = false) String businessType,
    @RequestParam(required = false) String keyword,
    @RequestParam(required = false) LocalDateTime startTime,
    @RequestParam(required = false) LocalDateTime endTime,
    Pageable pageable
);

/**
 * GET /api/v1/audit-ops/{id}
 * 查看详情（含 before/after 快照）
 */
@GetMapping("/{id}")
public AuditOpDetailVO getDetail(@PathVariable Long id);

/**
 * GET /api/v1/audit-ops/{businessType}/{businessId}/timeline
 * 获取某条业务的完整操作时间线
 */
@GetMapping("/timeline/{businessType}/{businessId}")
public List<AuditTimelineItem> getTimeline(
    @PathVariable String businessType,
    @PathVariable String businessId
);

/**
 * GET /api/v1/audit-ops/stats?period=week
 * 统计数据
 */
@GetMapping("/stats")
public AuditStatsVO getStats(
    @RequestParam(defaultValue = "WEEK") String period
);

/**
 * POST /api/v1/audit-ops/export?format=csv
 * 导出
 */
@PostMapping("/export")
public Result<String> exportOps(
    @RequestBody AuditExportRequest request,
    HttpServletResponse response
);
`

---

## 八、部署与迁移

### 8.1 实施步骤

| 阶段 | 内容 | 风险 |
|------|------|------|
| 第1步 | 增加 sys_oper_log 表列（ALTER TABLE）| 低 - 在线DDL，PostgreSQL支持 |
| 第2步 | 部署新后端服务 + Flyway V2 | 低 |
| 第3步 | 发布前端审计页面路由 | 低 |
| 第4步 | 逐步在各 Controller 添加 @BusinessOperation | 中 - 需逐一覆盖 |
| 第5步 | 对关键实体（员工、部门、订单）加 EntityListener | 中 |
| 第6步 | 灰度上线，观察日志写入性能 | 低 |

### 8.2 迁移脚本

`sql
-- V2__enhance_audit_tables.sql
ALTER TABLE sys_oper_log 
  ADD COLUMN IF NOT EXISTS description VARCHAR(512),
  ADD COLUMN IF NOT EXISTS business_type VARCHAR(64),
  ADD COLUMN IF NOT EXISTS business_id VARCHAR(128),
  ADD COLUMN IF NOT EXISTS before_data JSONB DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS after_data JSONB DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS diff_summary JSONB DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS result_status VARCHAR(16) DEFAULT 'SUCCESS';

-- 重建索引
CREATE INDEX IF NOT EXISTS idx_operlog_business ON sys_oper_log(business_type, business_id, oper_time DESC);
CREATE INDEX IF NOT EXISTS idx_operlog_result ON sys_oper_log(result_status, oper_time DESC);
`

---

## 九、验收标准

| # | 验收项 | 说明 |
|---|--------|------|
| 1 | 结构化展示 | 不再需要搜索 JSON，有清晰表格视图 |
| 2 | 变更对比 | 每条 UPDATE/DELETE 操作可查看 before/after 数据 |
| 3 | 多维筛选 | 支持按时间/用户/模块/操作类型组合筛选 |
| 4 | 业务时间线 | 可一键查看某条业务的全部操作历史 |
| 5 | 统计面板 | 首页展示今日/本周操作统计 |
| 6 | 导出功能 | 支持 CSV/Excel 导出 |
| 7 | 兼容现有 | 不影响 sys_oper_log 已有消费方 |
| 8 | 性能可控 | 异步写入，不阻塞主业务流程 |