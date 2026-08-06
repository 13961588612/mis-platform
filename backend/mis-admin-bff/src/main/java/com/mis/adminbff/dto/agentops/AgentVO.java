package com.mis.adminbff.dto.agentops;

import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * Agent 摘要 / 详情（对应前端 {@code types.ts:AgentSummary} + {@code AgentDetail}）。
 *
 * <h2>为什么摘要与详情合成一个 record</h2>
 * 前端的 {@code AgentDetail extends AgentSummary}，多出的四个字段全部可选。
 * Java 侧若照搬继承关系，record 又不支持继承，就得退化成两个 class + 手写委托，
 * 或者一个抽象类 + 两个子类 —— 为四个可选字段付出的结构复杂度不成比例。
 * 合成一个 record、列表场景下后四项为 null，是这里代价最低的表达。
 *
 * <p><b>{@code workspace} 的用途</b>：配置文件接口（§4.3 #22–#24）靠它在磁盘上定位
 * agent 目录。它是详情独有字段，列表接口不返回 —— 这也是本 VO 允许字段为 null 的原因。
 *
 * @param id                Agent ID
 * @param displayName       显示名
 * @param role              {@code coordinator} | {@code worker}
 * @param state             {@code running} | {@code paused} | {@code stopped} | {@code error}
 * @param enabledSkillCount 已启用技能数
 * @param description       描述（详情）
 * @param model             使用的模型（详情）
 * @param workspace         磁盘上的 agent 目录名（详情）
 * @param updatedAt         最后更新时间（详情）
 */
public record AgentVO(
        @JsonProperty("id") String id,
        @JsonProperty("display_name") String displayName,
        @JsonProperty("role") String role,
        @JsonProperty("state") String state,
        @JsonProperty("enabled_skill_count") Integer enabledSkillCount,
        @JsonProperty("description") String description,
        @JsonProperty("model") String model,
        @JsonProperty("workspace") String workspace,
        @JsonProperty("updated_at") String updatedAt) {

    /** 协调者：可派发任务给 worker。 */
    public static final String ROLE_COORDINATOR = "coordinator";

    /** 执行者：只接任务不派发。 */
    public static final String ROLE_WORKER = "worker";

    /** 运行中，是 {@code monitor/overview} 统计 {@code agents_running} 的判定依据。 */
    public static final String STATE_RUNNING = "running";

    /** @return 是否运行中 */
    public boolean isRunning() {
        return STATE_RUNNING.equals(state);
    }
}
