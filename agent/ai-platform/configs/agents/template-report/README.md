# template-report — 模板报告智能体

由 **mis-copilot 每轮首步**委派。快路径（不经 OpenHarness 工具循环）：

1. `GET /api/v1/ai-reports/catalog` 拉可见报告  
2. 决策模型一次 choice（参与 code + `not_template_report`）  
3. 未命中 / 低分 → `TaskStatus.skipped`，Coordinator 继续选人  
4. 命中 → `prepare-card` → 抽槽；缺必填则开参数卡；齐则 `execute` 透传结果  

配置：`template-report-router.yaml`（`min_confidence` / `participate_codes` / 描述覆盖）。
