package com.mis.adminbff.dto.agentops;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.List;

/**
 * 单个 MCP Server 的工具授权聚合视图（MCP 管理页「工具授权」Tab 的数据源）。
 *
 * <p>三路数据在 BFF 聚合成一份，前端一次请求拿齐，不在页面里并发打三个接口：
 * <ol>
 *   <li><b>live 工具清单</b> —— ai-platform {@code GET /api/v1/mcp/{name}/tools}；</li>
 *   <li><b>已 discover 集合</b> —— ai-platform {@code GET /api/v1/skills?source=mcp}，
 *       按 {@code mcp_server} 归属后比对得出 {@code discovered} / {@code offline_skills}；</li>
 *   <li><b>角色授权</b> —— mis-iam {@code sys_role_menu} 翻转，按执行码对应
 *       {@code sys_menu.id} 反查持有角色。</li>
 * </ol>
 *
 * @param server        server 名（透传查询参数）
 * @param tools         live 工具行（含 discovered 状态与已授权角色）
 * @param offlineSkills 已下线工具（曾 discover 但 live 清单已无，可清理），永不为 null
 */
public record McpServerToolsVO(
        @JsonProperty("server") String server,
        @JsonProperty("tools") List<McpToolPermissionVO> tools,
        @JsonProperty("offline_skills") List<McpOfflineSkillVO> offlineSkills) {

    public McpServerToolsVO {
        tools = (tools == null) ? List.of() : List.copyOf(tools);
        offlineSkills = (offlineSkills == null) ? List.of() : List.copyOf(offlineSkills);
    }
}
