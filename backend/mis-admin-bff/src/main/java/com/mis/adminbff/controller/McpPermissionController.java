package com.mis.adminbff.controller;

import com.mis.adminbff.dto.agentops.McpOfflineCleanupRequest;
import com.mis.adminbff.dto.agentops.McpOfflineCleanupResultVO;
import com.mis.adminbff.dto.agentops.McpServerToolsVO;
import com.mis.adminbff.service.agentops.McpPermissionService;
import com.mis.common.core.result.Result;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * MCP 工具授权域 BFF 端点（MCP 管理页「工具授权」Tab 的数据源）。
 *
 * <h2>为什么单独成类而不是塞进 {@link AgentOpsGrantController}</h2>
 * 技能授权（{@code AgentOpsGrantController}）是「一个 skill 一个码」的通用能力；
 * 这里是「一个 MCP server 一批工具」的聚合视图，多一路 ai-platform 工具清单来源，
 * 且带破坏性清理动作。混在一起会让授权 Controller 的职责从「授权翻转」膨胀成
 * 「MCP 运维」，与 {@code AgentOpsController} / {@code AgentOpsGrantController} /
 * {@code AgentOpsChannelController} 的「按域分治」约定相悖。
 *
 * <h2>权限：复用 MCP 管理页现有码，不新增</h2>
 * 入口在 MCP 管理页内 Tab，页面级 {@code agent:mcp:list} + 操作级
 * {@code agent:mcp:manage} 已足够（V20 的 92039 / 92059 菜单节点）。
 * <ul>
 *   <li>{@code GET  /mcp/tools}             —— 只读，挂 {@code agent:mcp:list}；</li>
 *   <li>{@code POST /mcp/tools/cleanup-offline} —— 破坏性，挂 {@code agent:mcp:manage}。</li>
 * </ul>
 * 后端判权由 {@code sys_api} 注册表驱动（V29 迁移登记），不写 {@code @PreAuthorize}，
 * 与 {@code AgentOpsController} 的既有约定一致。
 */
@RestController
@RequestMapping("/api/v1/agent-ops")
public class McpPermissionController {

    private final McpPermissionService permissionService;

    public McpPermissionController(McpPermissionService permissionService) {
        this.permissionService = permissionService;
    }

    /**
     * 聚合指定 MCP Server 的工具授权视图。
     *
     * @param server MCP Server 名
     * @return {@code {server, tools[], offline_skills[]}}
     */
    @GetMapping("/mcp/tools")
    public Result<McpServerToolsVO> listMcpToolPermissions(@RequestParam("server") String server) {
        return Result.ok(permissionService.aggregateTools(server));
    }

    /**
     * 清理已下线 MCP 工具（破坏性，需前端二次确认）。
     *
     * @param request 含 {@code skill_id}
     * @return 处置结果（菜单是否删除、哪些角色的菜单关联被回收）
     */
    @PostMapping("/mcp/tools/cleanup-offline")
    public Result<McpOfflineCleanupResultVO> cleanupOfflineSkill(
            @Valid @RequestBody McpOfflineCleanupRequest request) {
        return Result.ok(permissionService.cleanupOfflineSkill(request.skillId()));
    }
}
