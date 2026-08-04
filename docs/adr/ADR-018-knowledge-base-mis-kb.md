# ADR-018: 知识库 APP 与 mis-kb / RAG 引擎边界

## 状态

已接受 | 2026-08-03

## 背景

平台需要企业知识库：多层分类、密级与显式授权、文档生命周期、专用 RAG 问答（方案 B：多维评价与运营后台）。检索引擎拟采用开源 RAGFlow（Apache-2.0），管理 UI 自研并作为 MIS 独立 APP。需明确服务拆分、引擎部署形态，以及开发交付物是否包含测试环境 Docker。

## 决策

1. **新建 Java 领域服务 `mis-kb`**：分类、知识库、文档、ACL、问答会话/评价/工单、引擎适配层（`KnowledgeEnginePort`）。
2. **`mis-rag`（ai-platform Agent）只做生成**：消费统一召回结果，不承载管理 CRUD，不直连引擎散落调用。
3. **`mis-admin-bff` 对外门面**：`/api/v1/kb/**` 与问答编排（先 `mis-kb.retrieve`，再调 `mis-rag`）。
4. **一期引擎 = RAGFlow**，经 Adapter 接入；业务只认 MIS `libraryId`/`documentId`，可切换引擎需重 ingest。
5. **RAG 细项（切片、top_k 等）在 MIS 配置**，经 API 同步/传参；业务人员不进 RAGFlow 控制台。
6. **RAGFlow 以 Docker Compose 运行**；**开发实现 `mis-kb` / 知识 APP 时，必须同步交付测试环境可用的 Docker 脚本**（见 `deploy/ragflow/`），不得只留口头约定。

## 后果

- 新增微服务、Flyway 表、门户 `sys_app`（知识 APP）、测试栈资源需求上升（RAGFlow 官方建议约 ≥16GB RAM）。
- 运维需维护独立引擎栈与 `mis-kb` 的引擎连接配置（API Key 仅服务端）。
- 切换引擎有明确适配层，但向量不可热迁移。
- **二期扩展**（混合检索打磨、Rerank、命中测试、**同义词由 MIS 持有并在 retrieve 前扩展**、库级 GraphRAG PoC）仍经 `KnowledgeEnginePort`；**不上独立 Neo4j**；图谱为可选库级能力；引擎原生 synonym 文件仅运维可选。详见 [knowledge-base-phase2-plan.md](../backend/knowledge-base-phase2-plan.md) Wave D。

## 关联

- **完整规划**：[knowledge-base-app-plan.md](../backend/knowledge-base-app-plan.md)
- **二期扩展**：[knowledge-base-phase2-plan.md](../backend/knowledge-base-phase2-plan.md)
- 设计摘要：[knowledge-base.md](../backend/knowledge-base.md)
- 部署：[deploy/ragflow/README.md](../../deploy/ragflow/README.md)、[test-deploy.md](../devops/test-deploy.md)
- 既有 AI 融合：[ai-fusion/README.md](../ai-fusion/README.md)
