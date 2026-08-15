/**
 * 「AI 对话创建」Tab(C) 引导语与模板（P2-1）。
 *
 * <p>提供若干示例技能描述，降低运营同学的起手门槛；可整段发送，也可摘取片段。
 * 纯静态文本，便于后续运营补充更多领域模板。
 */

/** 空状态引导语（首次进入 C Tab 时展示）。 */
export const SKILL_BUILDER_EMPTY_HINT =
  '描述你想要的技能，AI 会生成一份规范的 SKILL.md。例如：「一个按会员 ID 查询积分余额的技能，对接 crm-server 的 query_points 工具」。';

/** 示例技能描述模板（点击即填入输入框，可增改后再发送）。 */
export const SKILL_BUILDER_EXAMPLES: string[] = [
  '一个按会员 ID 查询积分余额与等级的技能，对接 crm-server 的 query_points 工具，仅做只读查询。',
  '一个订单状态查询技能：用户输入订单号，调用 order-server 的 get_order 返回物流与状态，需要校验订单号格式。',
  '一个知识库检索技能：把用户问题向量化后检索内部文档，返回最相关的三段摘要，用于客服前置答疑。',
  '一个定时播报技能：每天上午 9 点把昨日新增工单汇总推送到企微群，handler 用 builtin:daily-report。',
];
