# Copilot 调度加速与上下文承接（落地说明）

> 状态：已落地（2026-10-31）｜范围：`mis-copilot` ↔ `spm-report` 主路径  
> 关联代码：`passthrough.py`、`a2ui_run.py`、`intent_router/`、`coordination.yaml`、`intent-router.yaml`

## 1. 目标

缩短「用户跟问 → 出报表」端到端时延，并减少短跟问丢门店/时间等已确认条件。

主手段：

1. **跳过 Coordinator 两端 LLM**（选人 + 复述）
2. **JEV / 硬委派各自带「近几轮」上文**（不是全量历史）
3. **抬高工具预览 + Skill 防截断重试**，避免 Worker 空转

## 2. 能力清单

| 能力 | 说明 | 速度影响 |
|------|------|----------|
| 硬委派 `hard_dispatch_workers` | JEV/规则命中白名单 Worker → 跳过 Coordinator 首轮 LLM，直接 `agent__invoke` | 选人 LLM ≈ 0 |
| 规则优先 `rules_then_model` | 高精度 keyword 先命中 → 同上硬委派；未命中再 JEV | 少漂 rag、少进选人 LLM |
| 精简 `system.md` | 唯一选人 prompt（短意图表 + 薄 invoke 入参）；缺 brief 时模板补全 | 选人 LLM 输入更短 |
| 透传收尾 `passthrough_workers` | 成功 invoke 且本轮仅一次委派 → 跳过 Coordinator 收尾 LLM，Worker 正文直出 | 复述 LLM ≈ 0 |
| JEV 近轮上文 | `max_context_turns` 限制进入 JEV 的对话轮次 | 跟问更稳进正确 Worker；JEV 输入更短 |
| 硬委派 TaskBrief 上文 | 近几轮写入 `attachments_text` +「已确认条件一律沿用」约束 | 减少重复选店/选时间 |
| `mode=continue`（可选） | 复用同 Worker 子会话 | 子会话内工具记忆可延续；**默认关** |
| OpenHarness 预览抬高 | 大 MCP 回包少截断 | 少同参重试 |
| Skill 规则 | 部门/柜组用 `categoryLevel`；大类须 `parentCategoryId`；truncated 禁止同参重调 | 少空转 LLM/MCP |
| spm-report 人格 | 对用户可见回复禁技术细节 | 终稿略短（Worker LLM 仍是大头） |

## 3. 三条上下文链路（勿混淆）

```text
父会话历史
    │
    ├─► JEV（意图预路由）
    │     配置：intent-router.yaml → max_context_turns / max_context_msg_chars
    │     用途：选 Worker / intent；不是交给 Worker 执行
    │
    ├─► 硬委派 TaskBrief.attachments_text
    │     代码：a2ui_run 拼近 3 轮（单条最多 800 字）→ passthrough.build_hard_dispatch_invoke_args
    │     用途：spawn 时 Worker 仍能看到已确认门店/时间/指标等
    │
    └─► Worker 子会话续聊（mode=continue）
          开关：INVOKE_AGENT_CONTINUE_ENABLED
          用途：复用同一子会话历史；不是「把 JEV 结果塞给 Worker」
```

| 配置 / 机制 | 给谁 | 干什么 | 不是什么 |
|-------------|------|--------|----------|
| `intent_router.max_context_turns` | **JEV** | 最近 N 轮用于分类 | 不是全量历史；不是 Worker 执行上下文 |
| 硬委派 `attachments_text` | **Worker（本轮 TaskBrief）** | 近几轮条件沿用 | 不依赖 continue；与 JEV 标签表无关 |
| `INVOKE_AGENT_CONTINUE_ENABLED` | **Worker 子会话** | `mode=continue` 是否生效 | 不是「承接 JEV 上下文」 |

日志对照：

- JEV：`意图预路由·JEV…；含上文；上文轮次≤3`
- 硬委派：`协调者·硬委派…；mode=continue；含上文|无上文`
- continue 被关：`continue mode disabled, falling back to spawn`

## 4. 配置项

### 4.1 `configs/agents/mis-copilot/coordination.yaml`

```yaml
delegation:
  passthrough_workers:
    - spm-report
  hard_dispatch_workers:
    - spm-report
```

- 仅名单内 Worker 走硬委派 / 透传。
- 硬委派失败（无正文 / invoke 失败）回退：软提示 + Coordinator 主模型。

### 4.2 `configs/agents/mis-copilot/intent-router.yaml`

```yaml
intent_router:
  enabled: true
  engine: rules_then_model      # 规则兜底 → 未命中再 JEV
  max_context_turns: 3          # 一轮 ≈ user+assistant；折合最多 6 条进 JEV
  max_context_msg_chars: 160
  min_confidence: 0.6
```

前提：`DECISION_MODEL_*` / `INTENT_DETECT_*`（含 API Key）已配置，否则无 JEV、硬委派不触发。

### 4.2.1 正常选人 prompt（未硬委派时）

| 项 | 位置 | 行为 |
|----|------|------|
| 唯一 prompt | `runtime/prompts/system.md` | 短意图表 + 薄 `agent__invoke` 入参说明 |
| 模板 brief | `enrich_invoke_args_with_template` | LLM 未给完整 brief 时按硬委派模板补全 |

### 4.3 环境变量（`backend/.env`）

| 变量 | 建议值 | 说明 |
|------|--------|------|
| `OPENHARNESS_TOOL_OUTPUT_INLINE_CHARS` | `48000` | 超过则落盘 artifact |
| `OPENHARNESS_TOOL_OUTPUT_PREVIEW_CHARS` | `24000` | 对话内预览长度；过小易截断→重试 |
| `INVOKE_AGENT_CONTINUE_ENABLED` | `true`（可选） | 允许 `mode=continue`；默认 `false` |
| `INTENT_DETECT_API_KEY` 等 | 已有 | JEV 独立 Key |

### 4.4 代码侧约定（非 YAML）

| 位置 | 约定 |
|------|------|
| `passthrough.build_hard_dispatch_invoke_args` | 默认 `mode=continue`；有上文时写 goal/constraints「已确认条件一律沿用」 |
| `a2ui_run` 硬委派 | Worker 上文：`max_context_turns=3`，`max_msg_chars=800` |

## 5. Skill / 人格（spm-report）

- `sm-report-router` / `sm-shop-category-sale`：部门·柜组 vs 大类父类；truncated → summary，禁止同参重试。
- `memory/personality.md`：对用户可见回复禁止 API/字段名/Skill 名等技术细节。

## 6. 部署检查

1. 同步配置与代码：`coordination.yaml`、`intent-router.yaml`、`passthrough.py`、`a2ui_run.py`、`intent_router/*`、相关 Skill/persona。
2. `.env`：`OPENHARNESS_*`；若要子会话续聊则 `INVOKE_AGENT_CONTINUE_ENABLED=true`。
3. 重启 ai-platform backend。
4. 验收日志：硬委派 + 透传；跟问应 `含上文`；开 continue 后不应再出现 `continue mode disabled`。

## 7. 已知瓶颈（未在本轮消掉）

端到端仍常卡在 **Worker 多轮 LLM**（加载 Skill、拉年日清单、纠错重试、终稿）：

- `listYearDates` 整年回包灌上下文（token / 时延大）
- 日期键格式偶发错误导致多一轮纠错
- 终稿 LLM 仍可达十余秒

后续优化方向（未实施）：日历结果摘要化、槽位齐时短路取数、终稿 TopN / 更短 persona 约束。

## 8. 关联文件

| 类型 | 路径 |
|------|------|
| 硬委派 / 透传 | `agent/ai-platform/backend/src/coordinator/passthrough.py` |
| TaskBrief 模板补全 | `agent/ai-platform/backend/src/coordinator/routing_llm.py` |
| A2UI 主路径 | `agent/ai-platform/backend/src/runtime/a2ui_run.py` |
| JEV 服务 | `agent/ai-platform/backend/src/intent_router/` |
| continue 开关 | `config.INVOKE_AGENT_CONTINUE_ENABLED` ← `invoke_agent._resolve_continue_session` |
| 协调配置 | `configs/agents/mis-copilot/coordination.yaml` |
| JEV / 规则 | `configs/agents/mis-copilot/intent-router.yaml` |
| 选人 prompt | `configs/agents/mis-copilot/runtime/prompts/system.md` |
| 单测 | `tests/test_coordinator_passthrough.py`、`tests/test_intent_router.py`、`tests/test_routing_llm.py` |

## 9. 会话详情「逐步耗时」（timing schema v3）

日志里的「对话步骤」在写入的同时采集进 Redis `SessionTiming.steps`（TTL 24h），运营台会话详情每一轮助手消息可展开查看。

- 采集：`log_turn_step` → `TURN_STEPS_CV`；委派时 `TURN_STEPS_MIRROR_CV` 把 Worker 步骤镜像进 Coordinator 本轮。
- 落库：`SessionTimingRecorder.snapshot()` 字段 `steps`；`schema_version=3`。
- 前端：`TimingBlock` 下「逐步耗时（对齐日志）」默认展开；与规划/工具/生成等五阶段并存。
- **仅新产生的轮次**有 steps；历史 Redis 采样无此字段。

### 9.1 为何和日志「差很多」

| 展示 | 口径 | 典型现象 |
|------|------|----------|
| 五阶段（规划/检索/工具/生成/后处理） | 父会话墙钟切段 | 硬委派时整段 Worker 算进「工具」几十秒；看不到 JEV/各轮 LLM/MCP |
| 逐步耗时 `steps` | 与日志「对话步骤」同源 | 可见 JEV、执行者·大模型第 N 轮、MCP、Skill；含「本轮汇总」行（整轮汇总，勿与逐步相加） |
| 日志 | 同上逐步 + 结构化 `agent_step_timing` / `route_timing` | 权威明细 |

对比请用 **逐步耗时**，不要用五阶段去对日志里的 LLM/MCP 行。未部署 v3 或采样过期时只有五阶段，会与日志差异很大。
