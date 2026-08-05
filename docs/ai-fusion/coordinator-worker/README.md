# Coordinator–Worker 文档目录

> MIS 管理台对话调度基座（对齐 OpenHarness Coordinator / Worker 语义）  
> **本目录单独存放本需求的全部相关文档**（需求 / 架构 / 决策 / 规范 / 开发）。

## 阅读顺序

| 顺序 | 文档 | 说明 |
|------|------|------|
| 1 | [prd.md](prd.md) | **需求**：目标、用例、验收、分期 |
| 2 | [architecture.md](architecture.md) | **架构**：角色、数据流、与官方语义对齐、运行时关系 |
| 3 | [adr.md](adr.md) | **决策（ADR）** |
| 4 | [spec.md](spec.md) | **技术规范**：TaskBrief、契约、接入清单、FAQ |
| 5 | [dev.md](dev.md) | **开发设计**：影响面、C0–C5 任务清单、测试与风险 |
| 6 | [design-impl.md](design-impl.md) | **实现级设计**：代码基线核实、文件清单、pydantic 模型与类图、调用时序、T01–T05 任务分解、共享约定、待明确事项 |

图源：[class-diagram.mermaid](class-diagram.mermaid)｜[sequence-diagram.mermaid](sequence-diagram.mermaid)｜[task-dependency.mermaid](task-dependency.mermaid)

## 一句话结论

- **语义**：按 OpenHarness Coordinator / Worker（Swarm）对齐。  
- **实现**：MIS Coordinator Adapter（in-process），不直用 OH 默认 subprocess Swarm。  
- **产品**：将 Agent `mis-copilot` **配置为 Coordinator 模式**作为默认对话入口；新业务注册 Worker 扩展。

## 文档状态

| 文档 | 状态 |
|------|------|
| 需求 PRD | ✅ 已发布 |
| 架构 | ✅ 已发布 |
| ADR | ✅ 已发布 |
| 技术规范 Spec | ✅ 已发布 |
| 开发设计 | ✅ 已发布（实现从 C1 起） |
| 实现级设计 design-impl | ✅ 已发布（覆盖 C1+C2+C3+C5，待评审后实施） |

## 关联代码（仓库内）

- 现网委派：`agent/ai-platform/backend/src/skills/tools/invoke_agent.py`
- Coordinator 配置：`agent/ai-platform/configs/agents/mis-copilot/`
- 运行时抽象：`agent/ai-platform/backend/src/runtime/`
- 融合总览：[`../README.md`](../README.md)
