# MIS 平台标准化表单开发指南 (SOP)

> **版本**: v1.0 | **日期**: 2026-10-08
> **适用范围**: 新建业务单据 / 信息查询页
> **核心原则**: 快速 CRUD + 可选工作流 + 自动审计

---

## 一、 标准开发流程

```text
需求分析 -> 建表(Flyway) -> 后端CRUD -> 前端FormSheet -> 权限挂载
     -> [选配]挂接工作流 -> 联调测试 -> 上线发布
```

---

## 二、 详细实施步骤

### Phase 1: 数据库设计 (Data Layer)

1. **命名规范**: `sys_<模块>_<实体>` 或 `biz_<类型>_xx`
2. **必填字段**: `id`, `tenant_id`, `created_at`, `updated_at`, `deleted` (软删)
3. **索引策略**: 状态、租户ID、外键关联ID必须建索引
4. **脚本提交**: 放置于 `backend/flyway/Migration/VXXX__create_xxx.sql`

### Phase 2: 后端架构 (Spring Boot + JPA)

1. **Entity**: 继承 `BaseEntity`，定义业务字段。若走流程，增加 `process_status`
2. **DTO**: `CreateReq/UpdateReq` (入参校验), `VO` (出参封装)
3. **Repository**: 继承 `JpaRepository`
4. **Service**: 核心逻辑 + `@BusinessOperation` 注解实现自动审计日志
5. **Controller**: RESTful 风格 `/api/v1/<module>/<entity>`, 统一 `Result<T>` 返回

### Phase 3: 前端实现 (React + Shadcn)

1. **路由注册**: `app/router.tsx` 分配页面路径
2. **表单页**: 复用 `<FormSheet fields={schema} />`，配置动态表单组件
3. **列表页**: 使用 `DataTable` 分页展示，右上角新增按钮跳转表单
4. **权限控制**: `PermissionGate` 包裹敏感操作按钮

### Phase 4: 工作流集成 (高级选配)

1. **绑定关系**: 在流程设计器中将 `ProcessCode` 与 `FormCode` 关联到同一个白名单
2. **双向状态机**: 
   - **员工端**: 填写表单 -> `submit` -> 触发 `workflowClient.startProcess()`
   - **领导端**: 查看 `wf_instance.started_form_code` -> 渲染只读预览态 + `ApprovalActionBar`
3. **视觉追踪**: 通过 `wf_history` 数据动态生成流程节点图 (`@xyflow/react`)

---

## 三、 推荐目录结构

```text
src/features/purchase/           # 业务模块根目录
├── pages/                       # 页面入口
|   ├── ListPage.tsx             # 列表页
|   └── FormPage.tsx             # 新增/编辑页
├── components/                  # 专属组件
|   └── ApprovalView.tsx         # 审批专用视图
└── store.ts                     # 局部 Zustand Store
```

---

## 四、 开发 Checklist (验收标准)

- [ ] **DB层**: Flyway 脚本执行无误，非空约束合理
- [ ] **功能层**: 新增、编辑、查看、删除闭环跑通
- [ ] **审计层**: 关键操作已记录至 `sys_audit_op`
- [ ] **流程层**: 工作流 `formCode` 映射正确，待办同步及时
- [ ] **交互层**: Loading/Success/Error 状态完整，必填项双端校验