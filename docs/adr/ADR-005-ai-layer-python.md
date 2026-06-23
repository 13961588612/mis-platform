# ADR-005: AI 层独立 Python 服务

## 状态
提议中

## 日期
2026-06-23

## 背景

平台规划包含 RAG、Agent 编排、NL2SQL 等 AI 能力。Java 生态虽有 Spring AI，但 Python 在 LLM 工具链、向量检索、快速迭代方面生态更成熟。

## 决策

1. **AI 能力独立为 Python 服务层**（`agent/`），与 Java 业务微服务解耦
2. Phase 1 仅交付 agent-gateway 骨架（健康检查 + Mock SSE）
3. Phase 3 交付 RAG、审批摘要、NL2SQL 等完整能力
4. AI 服务通过 JWT 以用户身份调用 Java API，不绕过权限体系

## 备选方案

| 方案 | 优点 | 缺点 |
|------|------|------|
| A. Python 独立层（选定） | 生态好、迭代快 | 多语言运维 |
| B. Spring AI 全 Java | 统一栈 | LLM 生态滞后 |
| C. 第三方 SaaS Agent | 上线快 | 数据出境、定制差 |

## 后果

### 正面
- AI 可独立部署、扩缩容
- 模型切换不影响 Java 核心
- 团队可并行开发

### 负面
- 需维护 Python CI/CD
- 跨语言联调与鉴权需规范
- 运维多一套运行时

## 约束

- AI 不承载核心交易写逻辑
- 写操作工具调用需用户确认（Human-in-the-loop）
- NL2SQL 仅只读 + 数据权限沙箱

## 待确认

- [ ] LLM 首选厂商
- [ ] 向量库：Milvus vs pgvector
- [ ] Agent 经 BFF 代理还是独立域名
