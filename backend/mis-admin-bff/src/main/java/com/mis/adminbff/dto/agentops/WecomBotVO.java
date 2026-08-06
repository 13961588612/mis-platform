package com.mis.adminbff.dto.agentops;

import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * 企微 Bot（§4.3 #48，对应前端 {@code types.ts:WecomBot}）。
 *
 * <h2>这个 VO 里<b>没有</b> {@code secret} 字段，是刻意的</h2>
 * 只暴露 {@code secretMasked}。把 secret 定义进 VO、再靠某处代码「记得置空」，
 * 是一种迟早失效的约定：新增一条返回路径、换一个序列化器、或者有人为了调试
 * 临时打开一次，密钥就出去了。<b>字段不存在</b>是唯一不依赖任何人记性的保证。
 *
 * <p>脱敏动作本身由 {@code WecomBotFacadeService} 执行，因为下游（T04）返回的
 * 原始结构里含明文 secret —— BFF 是这条链路上最后一个能拦住它的地方。
 *
 * @param botId        Bot ID
 * @param name         显示名
 * @param enabled      是否启用
 * @param wsUrl        WebSocket 接入地址
 * @param secretMasked 脱敏后的密钥（形如 {@code abc***xyz}），只读
 * @param boundAgentId 绑定的 Agent
 * @param health       {@code connected} | {@code disconnected} | {@code unknown}
 */
public record WecomBotVO(
        @JsonProperty("bot_id") String botId,
        @JsonProperty("name") String name,
        @JsonProperty("enabled") Boolean enabled,
        @JsonProperty("ws_url") String wsUrl,
        @JsonProperty("secret_masked") String secretMasked,
        @JsonProperty("bound_agent_id") String boundAgentId,
        @JsonProperty("health") String health) {

    /** 健康状态未知（gateway 不可达或未返回该 bot）。 */
    public static final String HEALTH_UNKNOWN = "unknown";
}
