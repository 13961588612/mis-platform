# AI Skill 表单填充引擎 — 详细设计文档

> 版本: v1.0 · 2026-07-30  
> 状态: P0 MVP 已交付 · 5/5 任务完成

---

## 目录

1. [架构总览](#1-架构总览)
2. [核心概念](#2-核心概念)
3. [DTO 数据契约](#3-dto-数据契约)
4. [后端分层架构](#4-后端分层架构)
5. [核心引擎详解](#5-核心引擎详解)
6. [参数解析器详解](#6-参数解析器详解)
7. [DAG 构建器详解](#7-dag-构建器详解)
8. [MCP 层详解](#8-mcp-层详解)
9. [微服务 MCP 端点](#9-微服务-mcp-端点)
10. [前端 HITL 集成](#10-前端-hitl-集成)
11. [完整调用路线](#11-完整调用路线)
12. [配置与部署](#12-配置与部署)
13. [扩展指南](#13-扩展指南)

---

## 1. 架构总览

### 1.1 设计理念

**Skill = JSON 配置，非代码定制。** 每个单据页面通过一份 JSON 声明其可填充的字段、依赖关系、可调用的 MCP 工具。引擎按依赖图确定性编排，非 LLM 运行时规划。

### 1.2 系统架构图

```
┌─────────────┐     POST /ai/skill/execute      ┌──────────────────────────┐
│   前端 React │ ──────────────────────────────▶ │   BFF (mis-admin-bff)    │
│  (HITL 弹窗) │ ◀────── success / hitl / error  │                          │
└─────────────┘                                 │  ┌────────────────────┐  │
                                                │  │ AiProxyController  │  │
                                                │  │ POST /skill/execute│  │
                                                │  └─────────┬──────────┘  │
                                                │            │             │
                                                │  ┌─────────▼──────────┐  │
                                                │  │ SkillExecution     │  │
                                                │  │ Engine             │  │
                                                │  │                    │  │
                                                │  │ ① SkillLoader      │  │
                                                │  │ ② DagBuilder       │  │
                                                │  │ ③ ParameterResolver│  │
                                                │  │ ④ McpClient        │  │
                                                │  └────┬───────────┬───┘  │
                                                │       │           │       │
                                                │       │ JSON-RPC  │       │
                                                └───────┼───────────┼───────┘
                                                        │           │
                                              ┌─────────▼──┐  ┌────▼──────┐
                                              │ mis-org    │  │  mis-iam  │
                                              │ :8103      │  │  :8102    │
                                              │            │  │           │
                                              │OrgMcpCtrl  │  │ (未来)    │
                                              └────────────┘  └───────────┘
```

### 1.3 四种执行状态

| 状态 | 含义 | 前端行为 |
|------|------|----------|
| `success` | 所有字段填充成功 | 直接回填表单 |
| `hitl_required` | 实体多匹配 | 弹出 HITL 对话框让用户选择 |
| `manual_required` | 无匹配实体 | 提示手动填写 |
| `error` | Skill 不存在/循环依赖/MCP 报错 | 显示错误提示 |

---

## 2. 核心概念

### 2.1 Skill（技能）

一份 JSON 配置文件，定义：

- **id**: 唯一标识（如 `user-fill`）
- **trigger**: 触发模板（如 `把 {person} 调到 {dept}`）
- **outputSchema**: 输出字段定义（key=字段名, value=字段描述）

### 2.2 FieldDef（字段定义）

outputSchema 中每个字段的结构：

| 属性 | 类型 | 说明 |
|------|------|------|
| `type` | string | 数据类型（integer, string 等） |
| `entityRef` | string \| null | 实体引用标识（org, dept, employee），null 表示非实体 |
| `tool` | string | 调用的 MCP 工具名称 |
| `params` | Map\<string, string> | 工具参数模板，支持 `${xxx}` 占位符 |

### 2.3 `${xxx}` 占位符

参数模板中的引用语法：

- `${orgId}` → 从 `outputSchema` 中找 `orgId` 字段的结果
- `${deptName}` → 从 `userInput` 经 LLM 抽取
- `${pageContextValue}` → 从表单已填值取

### 2.4 HITL（Human-in-the-Loop）

人机协同机制：当实体查询返回多个候选时，中断自动流程，将候选列表返回前端弹窗，用户选择后回填。

### 2.5 MCP（Model Context Protocol）

标准化的工具调用协议，JSON-RPC 2.0 over HTTP POST。BFF 侧通过 `McpClient` 发起调用，各微服务通过 `/internal/v1/mcp/tools/call` 暴露工具端点。

---

## 3. DTO 数据契约

### 3.1 SkillDefinition

**文件**: `backend/mis-admin-bff/src/main/java/com/mis/adminbff/dto/ai/SkillDefinition.java`

```java
public class SkillDefinition {
    private String id;                // "user-fill"
    private String name;              // "人员调动填充"
    private String version;           // "1.0"
    private String trigger;           // "把 {person} 调到 {dept}"
    private Map<String, FieldDef> outputSchema;  // 字段定义 map
}
```

**职责**: JSON 反序列化的根节点，对应一份 Skill 配置文件。

### 3.2 FieldDef

**文件**: `backend/mis-admin-bff/src/main/java/com/mis/adminbff/dto/ai/FieldDef.java`

```java
public class FieldDef {
    private String type;                     // "integer"
    private String entityRef;                // "org" / "dept" / "employee" / null
    private String tool;                     // "queryOrgByName"
    private Map<String, String> params;      // {"name": "${orgName}"}
}
```

**职责**: 描述单个字段的获取方式——类型、实体引用、MCP 工具、参数模板。

### 3.3 SkillExecuteRequest

**文件**: `backend/mis-admin-bff/src/main/java/com/mis/adminbff/dto/ai/SkillExecuteRequest.java`

```java
public class SkillExecuteRequest {
    private String skillId;                   // "user-fill"
    private String userInput;                 // "把张三调到财务部"
    private Map<String, Object> pageContext;  // {"orgId": 3}
    private String resumeToken;               // HITL resume 用
    private String selectedCandidate;         // HITL 用户选择的候选 ID
}
```

**职责**: 前端发起执行请求的入参。

### 3.4 SkillExecuteResponse

**文件**: `backend/mis-admin-bff/src/main/java/com/mis/adminbff/dto/ai/SkillExecuteResponse.java`

```java
public class SkillExecuteResponse {
    private String status;              // "success" | "hitl_required" | "manual_required" | "error"
    private Map<String, Object> fields; // {"deptId": 12, "orgId": 3}
    private HitlPayload hitl;           // 仅 hitl_required 时有值
    private String message;             // 错误提示或成功消息
    private String resumeToken;         // 用于 resume 的临时 token
}
```

**职责**: 执行结果返回体，通过 status 字段驱动前端路由。

### 3.5 EntityCandidate

**文件**: `backend/mis-admin-bff/src/main/java/com/mis/adminbff/dto/ai/EntityCandidate.java`

```java
public class EntityCandidate {
    private Object id;              // 实体 ID（Long 或 String）
    private String name;            // "八佰伴宜兴店"
    private List<String> aliases;   // 别名列表（P1 实现）
    private String context;         // "code=BBY-YX"
}
```

**职责**: 单个候选实体，HITL 弹窗中展示给用户选择。

### 3.6 HitlPayload

**文件**: `backend/mis-admin-bff/src/main/java/com/mis/adminbff/dto/ai/HitlPayload.java`

```java
public class HitlPayload {
    private String field;                        // "deptId"
    private String originalValue;                // "财务部"
    private List<EntityCandidate> candidates;    // 候选列表
}
```

**职责**: 携带 HITL 交互所需的全部信息——字段名、原始输入、候选实体。

---

## 4. 后端分层架构

```
AiProxyController (Controller 层)
    │
    ├── POST /ai/skill/execute
    │       获取 userId / tenantId → 调 SkillExecutionEngine
    │
    ▼
SkillExecutionEngine (Service 层 — 核心引擎)
    │
    ├── SkillLoader      → 加载 classpath:skills/*.json
    ├── DagBuilder       → 构建 DAG + 拓扑排序（Kahn 算法）
    ├── ParameterResolver → 解析每个字段的参数（三级降级）
    ├── McpToolRegistry  → 白名单校验
    └── McpClient        → JSON-RPC 调用微服务
    │
    ▼
McpClient (Service 层 — MCP 客户端)
    │
    ├── WebClient POST → {baseUrl}/internal/v1/mcp/tools/call
    ├── 构建 JSON-RPC 2.0 请求
    └── 解析 JSON-RPC 响应
    │
    ▼
微服务 MCP 端点 (Org / IAM / System)
    │
    ├── OrgMcpController     → POST /internal/v1/mcp/tools/call
    ├── OrgMcpService        → queryOrgByName（权限过滤 + 分页）
    └── OrgMcpRepository     → native SQL（JOIN sys_user_org）
```

---

## 5. 核心引擎详解

### 5.1 SkillExecutionEngine

**文件**: `backend/mis-admin-bff/src/main/java/com/mis/adminbff/service/skill/SkillExecutionEngine.java`

**职责**: 串联 Skill 加载 → DAG 排序 → 参数解析 → MCP 调用 → 结果组装的完整流程。

#### 5.1.1 构造函数注入

```java
public SkillExecutionEngine(
    SkillLoader skillLoader,          // 配置加载器
    DagBuilder dagBuilder,            // DAG 构建器
    ParameterResolver paramResolver,  // 参数解析器
    McpClient mcpClient,              // MCP 客户端
    McpToolRegistry toolRegistry,     // 白名单
    ObjectMapper objectMapper         // JSON 解析
)
```

#### 5.1.2 execute() 方法 — 核心入口

```java
public SkillExecuteResponse execute(
    String skillId,           // "user-fill"
    String userInput,         // "把张三调到财务部"
    Map<String, Object> pageContext,  // {"orgId": 3}
    Long userId,              // 当前用户
    Long tenantId             // 租户
)
```

**执行流程**（共 4 步）:

```
步骤 1: 加载 Skill
    └─ skillLoader.loadSkill(skillId)
    └─ 找不到 → return error("Skill not found")

步骤 2: 构建 DAG + 拓扑排序
    └─ dagBuilder.topologicalSort(skill.getOutputSchema())
    └─ 循环依赖 → return error("Circular dependency...")

步骤 3: 按拓扑序遍历每个字段
    └─ 对每个 FieldDef:
       │
       ├─ 非实体字段（entityRef == null）
       │  └─ paramResolver.resolveNonEntity() → 直接放入 results
       │
       └─ 实体字段（entityRef != null）
          │
          ├─ ① 解析参数 → paramResolver.resolve()
          ├─ ② 白名单校验 → toolRegistry.isAllowed(tool)
          ├─ ③ 调用 MCP → mcpClient.callTool()
          │
          └─ ④ 处理 MCP 结果:
             ├─ 候选为空 → return manualRequired()
             ├─ 唯一匹配 → results.put(field, candidate.id)
             └─ 多匹配 → return hitlRequired()

步骤 4: 所有字段完成
    └─ return success(results)
```

#### 5.1.3 getServerKey() — 实体→MCP 服务器映射

```java
private String getServerKey(String entityRef) {
    return switch (entityRef) {
        case "org", "dept" -> "org";        // 走 mis-org:8103
        case "employee", "user" -> "iam";   // 走 mis-iam:8102
        default -> "system";
    };
}
```

#### 5.1.4 parseCandidates() — 解析 MCP 结果

MCP 标准格式：
```json
{
  "content": [{
    "type": "resource",
    "resource": {
      "uri": "...",
      "text": "[{\"id\":1,\"name\":\"八佰伴宜兴店\",\"aliases\":[],\"context\":\"code=BBY-YX\"}]"
    }
  }]
}
```

解析逻辑：`content[0].resource.text` → JSON 数组 → List\<EntityCandidate>

#### 5.1.5 工厂方法 — 构造四种状态响应

| 方法 | status | 说明 |
|------|--------|------|
| `success(fields)` | `success` | 所有字段填充完毕 |
| `error(message)` | `error` | Skill 不存在/循环依赖/工具未授权/MCP 报错 |
| `manualRequired(field, fieldDef, name)` | `manual_required` | MCP 返回空候选列表 |
| `hitlRequired(field, fieldDef, name, candidates)` | `hitl_required` | MCP 返回 2+ 候选 |

---

## 6. 参数解析器详解

### 6.1 ParameterResolver

**文件**: `backend/mis-admin-bff/src/main/java/com/mis/adminbff/service/skill/ParameterResolver.java`

**职责**: 解析 FieldDef.params 中的 `${xxx}` 占位符和字面量值。

#### 6.1.1 resolve() — 实体字段参数解析

**三级降级策略**:

```
参数值 "xxx"
    │
    ├─ ① 是否为 ${xxx} 模式？
    │   ├─ YES → 从 prevResults 取
    │   │        └─ 未找到 → 从 pageContext 取
    │   └─ NO → 继续 ↓
    │
    ├─ ② 是否为 name 参数且是实体字段？
    │   ├─ YES → extractFromLLM(userInput)
    │   │        └─ P0: 直通（整个 userInput 作为名称）
    │   │        └─ P1: 接入 AiCapabilityTranslator 做精确抽取
    │   └─ NO → 继续 ↓
    │
    ├─ ③ 从 pageContext 取
    │
    └─ ④ 直接用原始参数值（字面量兜底）
```

**示例**: 用户输入 `把张三调到财务部`

```json
// FieldDef for "deptId"
{
  "params": {
    "name": "${deptName}",     // ② LLM 抽取 → "财务部"
    "orgId": "${orgId}"        // ① prevResults → 3（来自 orgId 字段的结果）
  }
}
```

#### 6.1.2 resolveNonEntity() — 非实体字段解析

无需调 MCP 的字段（如标记、备注等纯文本字段）。从 prevResults → pageContext → LLM 抽取 → 字面量兜底。

#### 6.1.3 extractFromLLM() — P0 直通实现

```java
private String extractFromLLM(String userInput, FieldDef fieldDef) {
    // P0: 整个 userInput 直接作为实体名
    // 用户说 "把张三调到财务部" → entityName = "把张三调到财务部"
    // 微服务侧做模糊匹配（LIKE '%把张三调到财务部%'）
    // P1: 接入 AiCapabilityTranslator 做 NER 精确抽取
    return userInput;
}
```

---

## 7. DAG 构建器详解

### 7.1 DagBuilder

**文件**: `backend/mis-admin-bff/src/main/java/com/mis/adminbff/service/skill/DagBuilder.java`

**职责**: 从 outputSchema 构建依赖图，返回拓扑排序结果。

#### 7.1.1 依赖识别规则

扫描每个 FieldDef 的 params 值，匹配正则 `\$\{(\w+)\}`：

```java
private static final Pattern PARAM_REF = Pattern.compile("\\$\\{(\\w+)\\}");
```

- 如果 field A 的 params 引用 `${B}` → **A 依赖 B**（B → A 有向边）
- 无 `${}` 引用的字段 → 入度为 0 的**根节点**
- 引用不存在的字段 → **忽略**（不视为依赖）

#### 7.1.2 topologicalSort() — Kahn 算法

```
输入: Map<String, FieldDef> schema

步骤 1: 构建邻接表 + 入度表
    └─ 遍历 schema 的每个字段
    └─ 对每个 FieldDef 的每个 paramValue:
       └─ 匹配 ${xxx} → dependency = xxx
       └─ 如果 dependency 在 schema 中:
          └─ graph.get(dependency).add(field)  // dependency → field
          └─ inDegree.put(field, +1)

步骤 2: Kahn 拓扑排序
    └─ 队列初始化为所有入度 = 0 的节点
    └─ while 队列非空:
       ├─ node = queue.poll()
       ├─ result.add(node)
       └─ 对 node 的每个邻居:
          ├─ inDegree[neighbor]--
          └─ 如果 == 0 → queue.offer(neighbor)

步骤 3: 循环依赖检测
    └─ 如果 result.size() < schema.size():
       └─ throw IllegalArgumentException("Circular dependency...")
    └─ 返回 result
```

#### 7.1.3 示例 DAG 推导

以 `user-fill.json` 为例：

```json
{
  "personId": { "params": { "name": "${personName}" } },
  "deptId":   { "params": { "name": "${deptName}", "orgId": "${orgId}" } },
  "orgId":    { "params": { "name": "${orgName}" } }
}
```

依赖分析：

| 字段 | params | 依赖谁 | 入度 |
|------|--------|--------|------|
| personId | `${personName}` | 无（personName 不在 schema 中） | 0 |
| deptId | `${deptName}`, `${orgId}` | orgId | 1 |
| orgId | `${orgName}` | 无（orgName 不在 schema 中） | 0 |

拓扑排序结果（可能的顺序）:

```
1. personId 或 orgId（入度 0，顺序不确定）
2. orgId 或 personId
3. deptId（依赖 orgId 完成后才入队）
```

**确定性保证**: deptId 一定在 orgId 之后，因为 deptId 的 params 引用了 `${orgId}`。

---

## 8. MCP 层详解

### 8.1 McpClient

**文件**: `backend/mis-admin-bff/src/main/java/com/mis/adminbff/service/McpClient.java`

**职责**: 通用 JSON-RPC 2.0 客户端，发起工具调用并解析结果。

#### 8.1.1 JSON-RPC 请求构建

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "queryOrgByName",
    "arguments": {
      "name": "八佰伴",
      "userId": 1001,
      "tenantId": 1
    }
  }
}
```

- `id` 自增计数器（AtomicLong）
- `arguments` 自动注入 `userId` 和 `tenantId`（用于权限过滤）

#### 8.1.2 调用流程

```
callTool(serverKey, toolName, args, userId, tenantId)
    │
    ├─ 1. 从 McpProperties 获取 baseUrl
    │      servers.get("org") → "http://mis-org:8103"
    │
    ├─ 2. 构建 JSON-RPC 请求
    │
    ├─ 3. WebClient POST → {baseUrl}/internal/v1/mcp/tools/call
    │
    └─ 4. 解析响应
       ├─ error 节点存在 → throw McpException
       └─ 返回 result 节点
```

### 8.2 McpToolRegistry

**文件**: `backend/mis-admin-bff/src/main/java/com/mis/adminbff/service/McpToolRegistry.java`

```java
private static final Set<String> ALLOWED_TOOLS = Set.of(
    "queryOrgByName",
    "queryDeptByName",
    "queryEmployeeByName"
);
```

**职责**: 安全白名单，防止 Skill 配置调用未授权的工具。在 `SkillExecutionEngine` 调用 MCP 之前执行。

### 8.3 McpProperties

**文件**: `backend/mis-admin-bff/src/main/java/com/mis/adminbff/resource/McpProperties.java`

```yaml
# application.yml 中的配置
mis:
  mcp:
    servers:
      org: http://mis-org:8103
      iam: http://mis-iam:8102
      system: http://mis-system:8105
```

---

## 9. 微服务 MCP 端点

### 9.1 OrgMcpController

**文件**: `backend/mis-org/src/main/java/com/mis/org/controller/OrgMcpController.java`

**端点**: `POST /internal/v1/mcp/tools/call`

#### 9.1.1 请求处理流程

```
收到 JSON-RPC 请求
    │
    ├─ 1. 校验 method == "tools/call"
    │
    ├─ 2. 提取 arguments.name（实体名称关键词）
    │
    ├─ 3. 安全转换 userId / tenantId（instanceof Number）
    │
    ├─ 4. 调用 orgMcpService.queryOrgByName(name, userId, tenantId)
    │
    └─ 5. 序列化为 MCP 标准格式返回
       └─ 成功 → McpJsonRpcResponse.success(id, text)
       └─ 失败 → McpJsonRpcResponse.error(id, code, message)
```

#### 9.1.2 MCP 请求/响应 DTO

```java
// 请求
public class McpJsonRpcRequest {
    private String jsonrpc;   // "2.0"
    private Object id;        // 1, 2, 3...
    private String method;    // "tools/call"
    private McpParams params; // { "name": "...", "arguments": {...} }
}

// 响应
public class McpJsonRpcResponse {
    private String jsonrpc;   // "2.0"
    private Object id;        // 对应请求的 id
    private Object result;    // 成功时的 JSON 字符串
    private McpError error;   // 失败时
}
```

### 9.2 OrgMcpService

**文件**: `backend/mis-org/src/main/java/com/mis/org/service/OrgMcpService.java`

```java
@Transactional(readOnly = true)
public List<OrgCandidate> queryOrgByName(String name, Long userId, Long tenantId) {
    // 1. 权限过滤 SQL
    List<SysOrg> orgs = orgMcpRepository.findByNameLikeWithUserScope(name, userId, tenantId);

    // 2. 转换为 OrgCandidate
    for (SysOrg org : orgs) {
        candidate.setId(org.getId());
        candidate.setName(org.getName());
        candidate.setAliases(Collections.emptyList());  // P0 为空，P1 实现
        candidate.setContext("code=" + org.getCode());
    }
    return result;
}
```

### 9.3 OrgMcpRepository

**文件**: `backend/mis-org/src/main/java/com/mis/org/domain/repository/OrgMcpRepository.java`

```sql
-- native query（示意）
SELECT o.* FROM sys_org o
INNER JOIN sys_user_org uo ON o.id = uo.org_id
WHERE uo.user_id = :userId
  AND o.name LIKE CONCAT('%', :name, '%')
ORDER BY LENGTH(o.name) ASC
LIMIT 5
```

**权限过滤**: 通过 `JOIN sys_user_org` 确保只返回用户有权限查看的组织。

---

## 10. 前端 HITL 集成

### 10.1 文件结构

```
frontend/mis-admin-web/src/features/ai/
├── types/
│   └── skill-fill.types.ts          # TS 类型定义
├── services/
│   └── skill-api.ts                 # BFF API 调用封装
├── hooks/
│   ├── useSkillFill.ts              # Skill 填充主 Hook
│   └── useEntityMapping.ts          # localStorage 映射学习 Hook
└── components/
    ├── HitlDialog.tsx               # HITL 多选弹窗
    └── EntitySelector.tsx           # 无匹配手动入口弹窗
```

### 10.2 skill-fill.types.ts

```typescript
export interface SkillExecuteRequest {
  skillId: string;
  userInput: string;
  pageContext?: Record<string, unknown>;
  resumeToken?: string;
  selectedCandidate?: string;
}

export interface SkillExecuteResponse {
  status: 'success' | 'hitl_required' | 'manual_required' | 'error';
  fields: Record<string, unknown>;
  hitl?: HitlPayload;
  message?: string;
  resumeToken?: string;
}

export interface HitlPayload {
  field: string;
  originalValue: string;
  candidates: EntityCandidate[];
}

export interface EntityCandidate {
  id: number | string;
  name: string;
  aliases: string[];
  context: string;
}
```

### 10.3 skill-api.ts

```typescript
export async function executeSkillFill(
  request: SkillExecuteRequest,
): Promise<SkillExecuteResponse> {
  const res = await api.post('/ai/skill/execute', request);
  // 解包 Result<SkillExecuteResponse> → { code: 0, data: {...} }
  return payload.data as SkillExecuteResponse;
}
```

### 10.4 useEntityMapping.ts — localStorage 映射学习

```
存储结构:
└─ "ai-entity-mapping-{userId}-deptId"
   └─ { "财务部": "12", "人力资源部": "8" }

读取: getMapping("deptId", "财务部") → "12"
写入: saveMapping("deptId", "财务部", "12")
```

**职责**: 记录用户 HITL 选择，下次相同输入直接跳过弹窗，自动回填。

### 10.5 useSkillFill.ts — 主 Hook

```
状态:
├─ loading: boolean          // 执行中
├─ error: string | null      // 错误提示
├─ hitlOpen: boolean         // HITL 弹窗是否打开
├─ hitlPayload: HitlPayload  // HITL 载荷
├─ manualOpen: boolean       // 手动选择弹窗是否打开

方法:
├─ execute(request)          // 发起 Skill 执行
├─ handleHitlConfirm(candidate)  // 用户确认选择 → 保存映射 + 回填
├─ handleHitlCancel()        // 取消 HITL
└─ handleManualSelect()      // 转为手动填写
```

**状态机流程**:

```
execute() 发起请求
    │
    ├─ status === 'success'
    │  └─ onFillComplete(response.fields) → 直接回填表单
    │
    ├─ status === 'hitl_required'
    │  ├─ 先查 localStorage → 有映射 → 直接回填
    │  └─ 无映射 → setHitlOpen(true) → 弹窗
    │
    ├─ status === 'manual_required'
    │  └─ setManualOpen(true) → 提示手动
    │
    └─ status === 'error'
       └─ setError(message) → 显示错误
```

### 10.6 HitlDialog.tsx — HITL 弹窗

**UI 布局**:
- 顶部标题：`AI 填充 — 请选择正确的{字段}`
- 中间：候选列表（单选 radio + 名称 + 上下文）
- 底部按钮：手动查找 | 取消 | 确认选择

### 10.7 EntitySelector.tsx — 无匹配入口

当 MCP 返回空候选列表时弹出，提示可能原因：
- 名称与系统记录不一致
- 没有查看权限

---

## 11. 完整调用路线

### 11.1 成功路径（happy path）

```
用户在表单中点击 "AI 填充" 按钮，输入 "把张三调到财务部"
    │
    │ POST /api/v1/ai/skill/execute
    │ Body: { skillId: "user-fill", userInput: "把张三调到财务部", pageContext: {orgId: 3} }
    ▼
AiProxyController.skillExecute()
    │
    ├─ 获取 userId (from RequestContext)
    ├─ 获取 tenantId (from RequestContext)
    │
    ▼
SkillExecutionEngine.execute()
    │
    ├─ ① SkillLoader.loadSkill("user-fill")
    │     └─ 从 ConcurrentHashMap 缓存中取
    │     └─ 返回 SkillDefinition
    │
    ├─ ② DagBuilder.topologicalSort(schema)
    │     └─ 扫描 ${} 引用 → 建图 → Kahn 算法
    │     └─ 返回 ["personId", "orgId", "deptId"] (deptId 在 orgId 之后)
    │
    ├─ ③ 遍历执行:
    │     │
    │     ├─ personId (非依赖字段):
    │     │  ├─ ParameterResolver.resolve()
    │     │  │  └─ params.name = "${personName}" → personName 不在 schema → 忽略
    │     │  │  → P0 直通: name = "把张三调到财务部"
    │     │  ├─ McpClient.callTool("iam", "queryEmployeeByName", {name: "...", userId, tenantId})
    │     │  │  ├─ POST http://mis-iam:8102/internal/v1/mcp/tools/call
    │     │  │  └─ 返回 [{id: 1001, name: "张三"}]
    │     │  └─ 唯一匹配 → results.put("personId", 1001)
    │     │
    │     ├─ orgId (非依赖字段):
    │     │  ├─ ParameterResolver.resolve()
    │     │  │  └─ name = "把张三调到财务部" (P0 直通)
    │     │  ├─ McpClient.callTool("org", "queryOrgByName", {...})
    │     │  │  ├─ POST http://mis-org:8103/internal/v1/mcp/tools/call
    │     │  │  └─ 返回 [{id: 3, name: "八佰伴", context: "code=BBY"}]
    │     │  └─ 唯一匹配 → results.put("orgId", 3)
    │     │
    │     └─ deptId (依赖 orgId):
    │        ├─ ParameterResolver.resolve()
    │        │  ├─ params.name = "${deptName}" → P0 直通 = "把张三调到财务部"
    │        │  └─ params.orgId = "${orgId}" → prevResults.get("orgId") = 3 ✓
    │        ├─ McpClient.callTool("org", "queryDeptByName", {name: "...", orgId: 3, userId, tenantId})
    │        │  └─ 返回 [{id: 12, name: "财务部", context: "..."}]
    │        └─ 唯一匹配 → results.put("deptId", 12)
    │
    └─ ④ 全部完成 → return success({personId: 1001, orgId: 3, deptId: 12})
    │
    ▼
AiProxyController → Result.ok(response) → 返回前端
    │
    ▼
useSkillFill → onFillComplete({personId: 1001, orgId: 3, deptId: 12}) → 表单回填
```

### 11.2 HITL 路径（多匹配）

```
... 前面相同 ...
    │
    └─ deptId 执行:
       ├─ McpClient.callTool("org", "queryDeptByName", {...})
       └─ 返回 [{id: 12, name: "财务部"}, {id: 13, name: "财务共享中心"}]
       │
       └─ 多匹配 → return hitlRequired("deptId", fieldDef, "财务部", candidates)
    │
    ▼
前端收到 status: "hitl_required", hitl: {field: "deptId", originalValue: "财务部", candidates: [...]}
    │
    ├─ getMapping("deptId", "财务部") → undefined（无历史映射）
    └─ setHitlOpen(true) → 弹出 HitlDialog
       │
       ├─ 用户选择 "财务部" → handleHitlConfirm(candidate)
       │  ├─ saveMapping("deptId", "财务部", "12") → 写入 localStorage
       │  └─ onFillComplete({deptId: 12}) → 表单回填
       │
       └─ 下次同样输入时直接跳过弹窗（localStorage 命中）
```

### 11.3 无匹配路径

```
... 前面相同 ...
    │
    └─ deptId 执行:
       ├─ McpClient.callTool("org", "queryDeptByName", {...})
       └─ 返回 [] (空)
       │
       └─ 无匹配 → return manualRequired("deptId", fieldDef, "财务部")
    │
    ▼
前端收到 status: "manual_required", message: "未匹配的实体：财务部"
    │
    └─ setManualOpen(true) → 弹出 EntitySelector → 用户手动填写
```

### 11.4 错误路径

```
AiProxyController.skillExecute()
    │
    └─ SkillExecutionEngine.execute()
       │
       ├─ Skill 不存在 → error("Skill not found: xxx")
       ├─ 循环依赖 → error("Circular dependency in skill schema...")
       ├─ 工具未授权 → error("Tool not allowed: xxx")
       └─ MCP 报错 → error("MCP call failed: xxx")
    │
    ▼
前端收到 status: "error", message: "..." → setError(message) → 显示错误提示
```

---

## 12. 配置与部署

### 12.1 Skill 配置示例

**文件**: `backend/mis-admin-bff/src/main/resources/skills/user-fill.json`

```json
{
  "id": "user-fill",
  "name": "人员调动填充",
  "version": "1.0",
  "trigger": "把 {person} 调到 {dept}",
  "outputSchema": {
    "personId": {
      "type": "integer",
      "entityRef": "employee",
      "tool": "queryEmployeeByName",
      "params": { "name": "${personName}" }
    },
    "deptId": {
      "type": "integer",
      "entityRef": "dept",
      "tool": "queryDeptByName",
      "params": { "name": "${deptName}", "orgId": "${orgId}" }
    },
    "orgId": {
      "type": "integer",
      "entityRef": "org",
      "tool": "queryOrgByName",
      "params": { "name": "${orgName}" }
    }
  }
}
```

### 12.2 application.yml 配置

```yaml
mis:
  mcp:
    servers:
      org: http://mis-org:8103
      iam: http://mis-iam:8102
      system: http://mis-system:8105
```

### 12.3 新增 Skill 部署

1. 在 `backend/mis-admin-bff/src/main/resources/skills/` 下新建 JSON 文件
2. 重启 BFF 服务（`SkillLoader` 在 `@PostConstruct` 自动扫描加载）
3. 在 `McpToolRegistry` 白名单中添加工具名（P0 阶段硬编码）

---

## 13. 扩展指南

### 13.1 新增一个 Skill

```json
// 新建 skills/order-fill.json
{
  "id": "order-fill",
  "name": "订单信息填充",
  "version": "1.0",
  "trigger": "查询订单 {orderId}",
  "outputSchema": {
    "orderId": {
      "type": "string",
      "entityRef": null,
      "tool": "",
      "params": { "name": "${orderNo}" }
    },
    "customerId": {
      "type": "integer",
      "entityRef": "customer",
      "tool": "queryCustomerByOrder",
      "params": { "orderId": "${orderId}" }
    }
  }
}
```

**步骤**:
1. 创建 JSON 文件
2. 在 `McpToolRegistry` 添加 `"queryCustomerByOrder"`
3. 在对应微服务添加 MCP 端点

### 13.2 新增 MCP 工具

**在微服务侧（如 mis-org）**:

1. 在 `OrgMcpController.handleJsonRpc()` 的 switch 中添加新 case
2. 在 `OrgMcpService` 中添加查询方法
3. 在 `OrgMcpRepository` 中添加 SQL（如有权限过滤需求，JOIN `sys_user_org`）

**在 BFF 侧**:

1. 在 `McpToolRegistry.ALLOWED_TOOLS` 中添加工具名
2. （可选）在 `SkillExecutionEngine.getServerKey()` 中添加 entityRef → serverKey 映射

### 13.3 前端集成到业务表单

```tsx
// 业务表单组件
import { useSkillFill } from '@/features/ai/hooks/useSkillFill';
import { HitlDialog } from '@/features/ai/components/HitlDialog';

function MyForm() {
  const {
    loading, hitlOpen, hitlPayload, hitlDialog,
    execute, handleHitlConfirm, handleHitlCancel, handleManualSelect
  } = useSkillFill({
    userId: currentUser.id,
    onFillComplete: (fields) => {
      // 将填充结果设置到表单状态
      form.setFieldsValue(fields);
    },
    onManualSelect: (field) => {
      // 打开手动选择弹窗
      openManualSelector(field);
    },
  });

  const handleAiFill = async () => {
    await execute({
      skillId: 'user-fill',
      userInput: userInputValue,
      pageContext: { orgId: selectedOrgId },
    });
  };

  return (
    <>
      <Form {...form} />
      <Button onClick={handleAiFill} loading={loading}>AI 填充</Button>
      {hitlDialog && (
        <HitlDialog
          open={hitlOpen}
          field={hitlDialog.field}
          originalValue={hitlDialog.originalValue}
          candidates={hitlDialog.candidates}
          onConfirm={handleHitlConfirm}
          onCancel={handleHitlCancel}
          onManual={handleManualSelect}
        />
      )}
    </>
  );
}
```

### 13.4 P1 规划清单

| 优先级 | 功能 | 说明 |
|--------|------|------|
| P1 | queryDeptByName 端点 | 在 mis-org 新增部门查询 MCP 工具 |
| P1 | queryRoleByName 端点 | 在 mis-system 新增角色查询 MCP 工具 |
| P1 | 别名管理 | 支持别名映射表的维护（DB + API） |
| P1 | 用户映射学习迁后端 | localStorage → 后端持久化（跨设备同步） |
| P1 | LLM 精确抽取 | ParameterResolver 接入 AiCapabilityTranslator |
| P1 | Skill 管理后台 | CRUD Skill JSON 配置 |

---

## 附录 A: 文件清单

| 模块 | 文件路径 | 职责 |
|------|---------|------|
| **DTO** | `backend/.../dto/ai/SkillDefinition.java` | Skill JSON 模型 |
| | `backend/.../dto/ai/FieldDef.java` | 字段定义 |
| | `backend/.../dto/ai/SkillExecuteRequest.java` | 执行请求 |
| | `backend/.../dto/ai/SkillExecuteResponse.java` | 执行响应 |
| | `backend/.../dto/ai/EntityCandidate.java` | 候选实体 |
| | `backend/.../dto/ai/HitlPayload.java` | HITL 载荷 |
| **引擎** | `backend/.../service/skill/SkillExecutionEngine.java` | 核心执行引擎 |
| | `backend/.../service/skill/SkillLoader.java` | 配置加载器 |
| | `backend/.../service/skill/DagBuilder.java` | DAG 拓扑排序 |
| | `backend/.../service/skill/ParameterResolver.java` | 参数三级降级 |
| **MCP** | `backend/.../service/McpClient.java` | JSON-RPC 客户端 |
| | `backend/.../service/McpException.java` | MCP 异常 |
| | `backend/.../service/McpToolRegistry.java` | 白名单注册表 |
| | `backend/.../resource/McpProperties.java` | MCP 服务器配置 |
| | `backend/.../config/McpConfig.java` | MCP 配置类 |
| **控制器** | `backend/.../controller/AiProxyController.java` | AI 代理控制器（含 skill/execute） |
| | `backend/.../service/AiCapabilityTranslator.java` | AI 能力翻译器（新增 isEntityRef） |
| **配置** | `backend/.../resources/skills/user-fill.json` | 示例 Skill 配置 |
| | `backend/.../resources/application.yml` | MCP 服务器配置 |
| **测试** | `backend/.../test/.../skill/DagBuilderTest.java` | DagBuilder 单元测试（9 用例） |
| **微服务** | `backend/mis-org/.../controller/OrgMcpController.java` | MCP JSON-RPC 端点 |
| | `backend/mis-org/.../service/OrgMcpService.java` | 组织 MCP 查询 |
| | `backend/mis-org/.../dto/OrgCandidate.java` | 组织候选 DTO |
| | `backend/mis-org/.../dto/McpJsonRpcRequest.java` | MCP 请求 |
| | `backend/mis-org/.../dto/McpJsonRpcResponse.java` | MCP 响应 |
| | `backend/mis-org/.../repository/OrgMcpRepository.java` | 数据访问层 |
| **前端** | `frontend/.../types/skill-fill.types.ts` | TS 类型定义 |
| | `frontend/.../services/skill-api.ts` | BFF API 调用 |
| | `frontend/.../hooks/useSkillFill.ts` | 填充主 Hook |
| | `frontend/.../hooks/useEntityMapping.ts` | localStorage 映射 |
| | `frontend/.../components/HitlDialog.tsx` | HITL 弹窗 |
| | `frontend/.../components/EntitySelector.tsx` | 无匹配手动入口 |
| | `frontend/.../ai-feature-registry.ts` (修改) | 注册 skill-fill feature |
| | `frontend/.../types.ts` (修改) | 追加 skill-fill 类型 |
| | `frontend/.../ai-form-fill.tsx` (修改) | 集成 HITL |
