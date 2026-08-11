package com.mis.adminbff.dto.agentops;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.List;

/**
 * 清理已下线 MCP 工具的处置结果。
 *
 * <p>清理是三步破坏性操作，前端需要知道每一步实际发生了什么：
 * <ol>
 *   <li>ai-platform 注销 Skill（{@code DELETE /api/v1/skills/{id}}）；</li>
 *   <li>mis-system 删除对应 {@code sys_menu}（{@code menu_removed} 反映是否真的删了
 *       —— 若执行码从没被 {@code ensureCode} 建过则本就无菜单，不算失败）；</li>
 *   <li>mis-iam 回收 {@code sys_role_menu} 关联（{@code roles_updated} 列出被改写的角色）。</li>
 * </ol>
 *
 * @param skillId      被清理的 Skill ID
 * @param menuRemoved  sys_menu 行是否被删除（false = 该码从未建过菜单）
 * @param rolesUpdated 被回收角色菜单关联的角色 ID 列表，永不为 null
 */
public record McpOfflineCleanupResultVO(
        @JsonProperty("skill_id") String skillId,
        @JsonProperty("menu_removed") boolean menuRemoved,
        @JsonProperty("roles_updated") List<Long> rolesUpdated) {

    public McpOfflineCleanupResultVO {
        rolesUpdated = (rolesUpdated == null) ? List.of() : List.copyOf(rolesUpdated);
    }
}
