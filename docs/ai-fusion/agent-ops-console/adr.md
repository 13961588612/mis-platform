# ADR：智能体运营控制台落在 ai-platform，定位为平台运维面

> 状态：✅ 已确认｜日期：2026-08-04（v1.1 增补界面强制范围）  
> 范围：`agent/ai-platform` 运营控制台；关联 Coordinator–Worker、Gateway 企微、Skill/MCP  
> 详细契约：[spec.md](spec.md)  
> 产品需求：[prd.md](prd.md)  
> 界面设计：[ui.md](ui.md)  
> 架构说明：[architecture.md](architecture.md)  
> 本目录：[README.md](README.md)

## 背景

平台已具备：

1. 多个 Agent YAML 配置与 `AgentManager` 生命周期；
2. `mis-copilot` 经 `agent__invoke` 委派 Worker 的对话调度基线；
3. Coordinator–Worker **C0 文档**（产品要求业务侧仅暴露一个 Coordinator）；
4. ai-platform 前端已有 Skill / Monitor / Approvals，但 **Agent 管理页未落地**（redirect）；
5. Skill/MCP/Session API 与 Gateway 企微通道已有基线，但**技能 ACL、多企微机器人、会话运营列表、配置文件在线编辑**等管理面不完整；
6. 知识库已走出 **MIS host App**（`sys_app=kb`）范式。

需要明确：「智能体管理后台」是做成第二个 host App，还是强化 ai-platform 自带管理台；以及产品面向运营还是业务用户。

## 决策

1. **产品定位为平台运营控制台**，**不是**面向业务的「智能体应用中心」。
2. **界面落点为 `agent/ai-platform/frontend` 的 `/admin/*` + `/chat`**。
3. **不新建 MIS 门户 host App**；门户最多外链 / 书签 / 可选 `runtime=link`。
4. **配置与运行真相仍在 ai-platform**；**不**新建 `mis-agent` Java 领域服务。
5. **业务对话入口与运营调试分离**：业务仅 Coordinator；运营 `/chat` 可直连任意 Agent。
6. **与 Coordinator–Worker 分期对齐**：Catalog/traces 不另起委派协议。
7. **调度观测与系统监控分责**：Monitor ≠ Dispatch。
8. **界面强制范围（v1.2）**：下列能力必须在 [ui.md](ui.md) 具备独立菜单/路由：  
   (1)–(9) 技能池/权限、企微多机器人、会话、Agent 绑技能、本地对话、技能 CRUD/停用、MCP、人设与配置文件；  
   **(10) Coordinator–Worker 调度配置**（`role`、可委派 Worker、Catalog 元数据、TaskBrief/超时/depth、全局 Catalog 页）。  
9. **技能执行双重门禁**：Agent 可用技能集 ∩ Skill ACL 允许，方可运行。  
10. **企微通道按 Bot 多实例建模**（Registry），管理台支持并存多个机器人。  
11. **#9 与 #10 分工**：Prompt/人设原文在配置文件页；C–W 结构化调度字段在「调度配置」页，二者互补不可互相替代。
## 备选方案

| 方案 | 结论 |
|------|------|
| A. 在 mis-admin-web 建 `features/agent` host App（类似 kb） | **否（本期）**：运营面与 Python 配置/热更新强耦合；BFF 透传成本高；与「业务不选 Worker」产品叙事易混淆 |
| B. 仅文档、不建 UI，运维全靠改 YAML / 调 API | 否：启停与 traces 需要可操作界面；Agent 页本就在路线图（T06） |
| C. 外挂独立第三个前端工程 | 否：已有 ai-platform frontend，避免分裂 |
| D. ai-platform `/admin` 运营控制台（选定） | 是：贴合现网、与 C–W 同栈、改动面最小 |

## 后果

### 正面

- 与现有 Skill/Monitor 管理台一体，研发心智一致
- Catalog / traces 可直接读运行时，无需 BFF 二次建模
- 不干扰知识库与业务 Copilot 的产品边界
- 新 Worker 接入路径与 C–W「注册 Worker」一致，控制台自然可见

### 负面 / 约束

- 运营人员需能访问 ai-platform 前端 origin（网络与账号）
- 首期运营权限模型较弱（平台登录），后续需接 MIS 权限码
- traces 若仅本机内存，多实例下视图不完整（需 Redis/PG 升级）
- 业务侧「仅 Coordinator」仍属 C–W C4，不因本 ADR 自动完成

## 补充澄清

1. **「智能体管理」≠「让用户管理并选择多个智能体」**。后者与 C–W ADR 冲突，明确禁止作为本控制台的业务目标。  
2. **专用能力页**（extract/summary/rag）仍可直连 Worker，属于业务工作台，不属于本控制台 IA。  
3. 若未来合规要求「所有管理 UI 必须进 MIS 门户壳」，可另开 ADR 评估 BFF 聚合运营 API + host App；**不推翻本 ADR 的数据面归属（仍在 ai-platform）**。

## 关联

- 需求：[prd.md](prd.md)
- 架构：[architecture.md](architecture.md)
- 规范：[spec.md](spec.md)
- 对话调度 ADR：[../coordinator-worker/adr.md](../coordinator-worker/adr.md)
- 现网前端占位：`agent/ai-platform/frontend/src/routes/AppRoutes.tsx`
- Agent API：`agent/ai-platform/backend/src/api/routes/agent.py`
