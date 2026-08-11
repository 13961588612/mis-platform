package com.mis.adminbff.dto.agentops;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.List;

/**
 * MCP 工具授权行（MCP 管理页「工具授权」Tab 的表格行）。
 *
 * <p>BFF 三路聚合的产物：工具本体来自 ai-platform {@code GET /api/v1/mcp/{name}/tools}，
 * {@code discovered} 来自 ai-platform MCP Skill 注册表（{@code source=mcp}），
 * {@code role_ids} 来自 mis-iam {@code sys_role_menu} 翻转。
 *
 * <h2>{@code skill_id} 的构造铁律</h2>
 * {@code skill_id = "mcp-" + server + "-" + tool}，与运行时
 * {@code AclToolWrapper._mcp_requirement()} 的判别名
 * {@code f"mcp-{server_name}-{tool_name}"}（{@code runtime/acl_tool_wrapper.py:189}）
 * 以及 {@code MCPDiscovery._tool_to_skill()}（{@code mcp/discovery.py:103}）
 * <b>逐字节一致</b>。本字段只由 BFF 从 ai-platform 返回的<b>原始工具名</b>拼出，
 * 严禁前端从展示名 {@code mcp__S__T} 反解。
 *
 * <h2>{@code permission_code} 为什么要回传</h2>
 * 与 {@link SkillGrantVO#permissionCodeOf} 同一理由：拼接规则只有后端一份，
 * 前端只负责展示，避免「前端自己拼」与 V21 实际码形状错位而不报错。
 *
 * @param name          工具名（原始名，与 ai-platform live 清单一致）
 * @param description   工具描述（可能为空串）
 * @param skillId       判别名 {@code mcp-{server}-{tool}}
 * @param permissionCode 执行码 {@code ai:skill:{skillId}:run}
 * @param discovered    该工具是否已在 ai-platform 注册成 Skill（未 discover 不可授权）
 * @param roleIds       已持有该执行码的角色 ID 列表，永不为 null
 */
public record McpToolPermissionVO(
        @JsonProperty("name") String name,
        @JsonProperty("description") String description,
        @JsonProperty("skill_id") String skillId,
        @JsonProperty("permission_code") String permissionCode,
        @JsonProperty("discovered") boolean discovered,
        @JsonProperty("role_ids") List<Long> roleIds) {

    public McpToolPermissionVO {
        roleIds = (roleIds == null) ? List.of() : List.copyOf(roleIds);
    }
}
