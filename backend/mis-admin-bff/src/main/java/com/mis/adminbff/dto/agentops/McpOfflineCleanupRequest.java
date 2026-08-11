package com.mis.adminbff.dto.agentops;

import com.fasterxml.jackson.annotation.JsonProperty;
import jakarta.validation.constraints.NotBlank;

/**
 * 清理已下线 MCP 工具入参。
 *
 * <p><b>只认 {@code skill_id}，不认 server + tool 两段</b>：清理对象是注册表里残留的
 * Skill（其 {@code skill_id} 形如 {@code mcp-{server}-{tool}}），server/tool 两段
 * 在 skill_id 里即可推导，让调用方分两次传只会增加拼接出错的机会。
 * 且 {@code skill_id} 含点号（{@code mcp-member-profile.query}），放 body 而非
 * 路径段可避免路径编码歧义。
 *
 * @param skillId 待清理的残留 Skill ID（{@code mcp-} 前缀）
 */
public record McpOfflineCleanupRequest(
        @JsonProperty("skill_id")
        @NotBlank(message = "skill_id 不能为空")
        String skillId) {
}
