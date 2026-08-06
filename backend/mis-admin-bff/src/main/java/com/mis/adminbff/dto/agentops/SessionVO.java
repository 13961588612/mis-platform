package com.mis.adminbff.dto.agentops;

import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * 会话（§4.3 #27/#28，对应前端 {@code types.ts:Session}）。
 *
 * <p>按「全量可查」定义（主理人决策 ①）：列表不限于内存中的活跃会话，
 * 历史会话同样可检索，因此带齐时间与统计字段。存储与检索在 T04 落地，
 * 但类型现在就定成最终形态 —— 等 T04 再补字段，意味着前端要为两个版本的形状写兼容。
 *
 * @param id           会话 ID
 * @param agentId      所属 Agent
 * @param agentName    Agent 显示名，便于列表直接展示而不用二次查询
 * @param channel      {@code web} | {@code wecom} | {@code api} | {@code unknown}
 * @param userId       发起用户 ID
 * @param userName     发起用户名
 * @param title        会话标题
 * @param messageCount 消息数
 * @param createdAt    创建时间
 * @param updatedAt    最后活跃时间
 */
public record SessionVO(
        @JsonProperty("id") String id,
        @JsonProperty("agent_id") String agentId,
        @JsonProperty("agent_name") String agentName,
        @JsonProperty("channel") String channel,
        @JsonProperty("user_id") String userId,
        @JsonProperty("user_name") String userName,
        @JsonProperty("title") String title,
        @JsonProperty("message_count") Integer messageCount,
        @JsonProperty("created_at") String createdAt,
        @JsonProperty("updated_at") String updatedAt) {

    /** 渠道未知时的兜底值，与前端 {@code SessionChannel} 对齐。 */
    public static final String CHANNEL_UNKNOWN = "unknown";
}
