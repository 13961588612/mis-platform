# template-report — 模板报告智能体

由 **mis-copilot 每轮首步**委派。快路径（不经 OpenHarness 工具循环）：

1. `GET /api/v1/ai-reports/catalog` 拉可见报告  
2. 决策模型一次 choice（参与 code + `not_template_report`）  
3. 未命中 / 低分 → `TaskStatus.skipped`，Coordinator 继续选人  
4. 命中 → `prepare-card`（**库/ADS 填充门店·日·周·月 options**）→ 槽位解析：  
   - 带近期对话上下文  
   - 确定性 Resolve：相对日/上周/上月/店名 → **必须落在 options.value**  
   - `INTENT_DETECT` 一次补洞（非法丢弃）  
   - 必填未显式识别 → 开参数卡（提示中可带已识别预填）；日槽 T+1 禁止静默 execute  
   - 齐则 `execute`  

配置：`template-report-router.yaml`（`min_confidence` / `slot_intent`）。  
槽位模型默认 `INTENT_DETECT_MODEL=tongyi-intent-detect-v3`。  
维表缺口补 Java `SpmSlotFetchService` / ParamSource，Agent 不直连库、不做 sm-report-router Skill。
