package com.mis.adminbff.dto.agentops;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.List;

/**
 * 已下线 MCP 工具（僵尸 Skill）行。
 *
 * <p>定义：工具曾 discover 成 Skill（{@code skill_id} 残留在 ai-platform 注册表
 * 且 {@code mcp_server}={@code server}），但该 server 的 live 工具清单里已无对应
 * 工具名（工具改名 / 下线）。这类 Skill 在 registry + sys_menu + sys_role_menu
 * 三处残留，运营可在授权页「清理」。
 *
 * <h2>{@code tool} 字段的来源</h2>
 * 由 {@code skill_id} 去掉 {@code "mcp-" + server + "-"} 前缀得到 —— 因为
 * 归属关系已由 Skill 的 {@code mcp_server} 字段精确锚定（不是从展示名反解），
 * 剩余部分必然是原始工具名。字段仅供展示，不参与任何判权拼接。
 *
 * @param skillId       残留 Skill 的 {@code skill_id}
 * @param tool          展示用工具名（skill_id 去掉 server 前缀后的剩余段）
 * @param permissionCode 该残留 Skill 的执行码（清理时用于反查 sys_menu）
 * @param roleIds       当前仍持有该码的角色 ID 列表（清理时会回收），永不为 null
 */
public record McpOfflineSkillVO(
        @JsonProperty("skill_id") String skillId,
        @JsonProperty("tool") String tool,
        @JsonProperty("permission_code") String permissionCode,
        @JsonProperty("role_ids") List<Long> roleIds) {

    public McpOfflineSkillVO {
        roleIds = (roleIds == null) ? List.of() : List.copyOf(roleIds);
    }
}
