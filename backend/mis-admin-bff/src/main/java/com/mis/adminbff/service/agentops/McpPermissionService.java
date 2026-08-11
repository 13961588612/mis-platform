package com.mis.adminbff.service.agentops;

import com.fasterxml.jackson.databind.JsonNode;
import com.mis.adminbff.client.AgentOpsClient;
import com.mis.adminbff.client.IamWebClient;
import com.mis.adminbff.client.SystemWebClient;
import com.mis.adminbff.client.model.AppVO;
import com.mis.adminbff.client.model.IamRoleVO;
import com.mis.adminbff.dto.agentops.McpOfflineCleanupResultVO;
import com.mis.adminbff.dto.agentops.McpOfflineSkillVO;
import com.mis.adminbff.dto.agentops.McpServerToolsVO;
import com.mis.adminbff.dto.agentops.McpToolPermissionVO;
import com.mis.adminbff.dto.agentops.SkillGrantVO;
import com.mis.adminbff.support.RequestContext;
import com.mis.common.core.exception.BusinessException;
import com.mis.common.core.exception.ResultCode;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * MCP 工具授权聚合 + 已下线工具清理。
 *
 * <p>这是「MCP 管理页 → 工具授权 Tab」的后端数据源，三路只读聚合 + 一条破坏性清理：
 * <ol>
 *   <li><b>live 工具</b> —— ai-platform {@code GET /api/v1/mcp/{name}/tools}；</li>
 *   <li><b>已 discover 集合</b> —— ai-platform {@code GET /api/v1/skills?source=mcp}；
 *       按 {@code mcp_server} 归属到本 server，再与 live 工具名比对：
 *       命中 ⇒ {@code discovered=true}；注册表有但 live 无 ⇒ 已下线（{@code offline_skills}）；</li>
 *   <li><b>角色授权</b> —— mis-iam {@code sys_role_menu} 翻转：{@code listEnabledRoles} 一次
 *       + {@code listRoleMenus} 每角色一次，建成 {@code menuId → roleIds} 反查表，
 *       再对每个 skill 用执行码对应的 {@code sys_menu.id} 查表。</li>
 * </ol>
 *
 * <h2>{@code skill_id} 拼接（本类最关键的不可错处）</h2>
 * {@code skill_id = "mcp-" + server + "-" + tool}。两端必须逐字节一致：
 * <ul>
 *   <li>ai-platform {@code MCPDiscovery._tool_to_skill()}（{@code mcp/discovery.py:103}）
 *       与运行时 {@code AclToolWrapper._mcp_requirement()} 的判别名
 *       {@code f"mcp-{server_name}-{tool_name}"}（{@code runtime/acl_tool_wrapper.py:189}）；</li>
 *   <li>本类的 {@code skillIdOf()} 使用 ai-platform 返回的<b>原始工具名</b>（未经净化），
 *       与两端同源，天然一致。严禁从前端展示名 {@code mcp__S__T} 反解。</li>
 * </ul>
 *
 * <h2>未 discover 工具为什么不 {@code ensureCode}</h2>
 * {@code ensureCode} 会往 mis-system 建 {@code sys_menu} 按钮。对未 discover 的工具建码
 * 等于给「尚不存在的 Skill」留权限位，纯属垃圾数据。所以：
 * <ul>
 *   <li>未 discover ⇒ {@code role_ids=[]}（本就不可授权），执行码仍回传供展示；</li>
 *   <li>已 discover / 已下线 ⇒ {@code findMenuId}（只查不建）反查持有角色。</li>
 * </ul>
 *
 * <h2>清理是破坏性操作（{@link #cleanupOfflineSkill}）</h2>
 * 三步按「先远端后本地」顺序，任一步失败即抛错，避免半截状态：
 * <ol>
 *   <li>ai-platform 注销 Skill；</li>
 *   <li>mis-system 删除对应 {@code sys_menu}（顺带清 {@code SkillPermissionCodeService}
 *       的缓存，否则将来重新 discover 会命中指向已删菜单的陈旧映射）；</li>
 *   <li>mis-iam 回收 {@code sys_role_menu}（read-modify-write，只改涉及的角色）。</li>
 * </ol>
 */
@Service
public class McpPermissionService {

    private static final Logger log = LoggerFactory.getLogger(McpPermissionService.class);

    /** MCP Skill 的 {@code skill_id} 前缀（与 ai-platform {@code discovery.py} 对齐）。 */
    private static final String MCP_SKILL_PREFIX = "mcp-";

    /** 技能执行码所在 App 编码（与 {@link AgentOpsGrantService} 同一口径）。 */
    private static final String SYSTEM_APP_CODE = "system";

    /** {@link #SYSTEM_APP_CODE} 解析失败时的兜底 ID（V21 明确 system App 为 1）。 */
    private static final long SYSTEM_APP_ID_FALLBACK = 1L;

    /** 单次拉取 MCP Skill 的分页上限（ai-platform Query le=100）。 */
    private static final int MCP_SKILL_PAGE_SIZE = 100;

    private final AgentOpsClient agentOpsClient;
    private final IamWebClient iamWebClient;
    private final SystemWebClient systemWebClient;
    private final SkillPermissionCodeService skillPermissionCodeService;

    public McpPermissionService(
            AgentOpsClient agentOpsClient,
            IamWebClient iamWebClient,
            SystemWebClient systemWebClient,
            SkillPermissionCodeService skillPermissionCodeService) {
        this.agentOpsClient = agentOpsClient;
        this.iamWebClient = iamWebClient;
        this.systemWebClient = systemWebClient;
        this.skillPermissionCodeService = skillPermissionCodeService;
    }

    // ==================================================================
    // 聚合
    // ==================================================================

    /**
     * 聚合指定 MCP Server 的工具授权视图。
     *
     * @param serverName MCP Server 名
     * @return live 工具行（含 discovered / role_ids）+ 已下线工具列表
     */
    public McpServerToolsVO aggregateTools(String serverName) {
        if (serverName == null || serverName.isBlank()) {
            throw new BusinessException(ResultCode.VALIDATION_ERROR, "server 不能为空");
        }
        String server = serverName.trim();

        List<McpToolEntry> liveTools = fetchLiveTools(server);
        List<McpSkillEntry> mcpSkills = fetchMcpSkills(server);

        Set<String> discoveredSkillIds = new HashSet<>();
        for (McpSkillEntry skill : mcpSkills) {
            discoveredSkillIds.add(skill.skillId());
        }
        Set<String> liveToolNames = new HashSet<>();
        for (McpToolEntry tool : liveTools) {
            liveToolNames.add(tool.name());
        }

        Map<Long, List<Long>> menuIdToRoleIds = buildMenuRoleMap();

        List<McpToolPermissionVO> tools = new ArrayList<>();
        for (McpToolEntry tool : liveTools) {
            String skillId = skillIdOf(server, tool.name());
            boolean discovered = discoveredSkillIds.contains(skillId);
            List<Long> roleIds = discovered ? roleIdsOf(menuIdToRoleIds, skillId) : List.of();
            tools.add(new McpToolPermissionVO(
                    tool.name(),
                    tool.description(),
                    skillId,
                    SkillGrantVO.permissionCodeOf(skillId),
                    discovered,
                    roleIds));
        }

        List<McpOfflineSkillVO> offlineSkills = new ArrayList<>();
        for (McpSkillEntry skill : mcpSkills) {
            String toolName = toolNameOf(server, skill.skillId());
            if (toolName == null || liveToolNames.contains(toolName)) {
                continue;
            }
            List<Long> roleIds = roleIdsOf(menuIdToRoleIds, skill.skillId());
            offlineSkills.add(new McpOfflineSkillVO(
                    skill.skillId(),
                    toolName,
                    SkillGrantVO.permissionCodeOf(skill.skillId()),
                    roleIds));
        }

        return new McpServerToolsVO(server, tools, offlineSkills);
    }

    /**
     * 拉取 MCP Server 的 live 工具清单。
     *
     * <p>ai-platform {@code GET /api/v1/mcp/{name}/tools} 的 {@code data} 是工具数组
     * （{@code manager.discover_tools} → {@code client.list_tools()}），每项含
     * {@code name} / {@code description} / {@code inputSchema} 等。结构异常按空清单
     * 处理：宁可少列工具，也不能让整个授权页因一个 server 的畸形响应而不可用。
     */
    private List<McpToolEntry> fetchLiveTools(String server) {
        JsonNode data = agentOpsClient.mcpTools(server);
        List<McpToolEntry> result = new ArrayList<>();
        if (data == null || !data.isArray()) {
            log.warn("MCP tools 返回非数组，按空清单处理: server={}", server);
            return result;
        }
        for (JsonNode node : data) {
            String name = node.path("name").asText("");
            if (name.isBlank()) {
                continue;
            }
            result.add(new McpToolEntry(name, node.path("description").asText("")));
        }
        return result;
    }

    /**
     * 拉取归属本 server 的已 discover MCP Skill。
     *
     * <p><b>归属判定用 {@code mcp_server} 字段，不用前缀匹配</b>：server 名可互为前缀
     * （如 {@code member} 与 {@code member-x}），仅按 {@code mcp-{server}-} 前缀过滤会把
     * {@code member-x} 的 Skill 误判给 {@code member}。{@code mcp_server} 由
     * {@code MCPDiscovery._tool_to_skill()} 在 discover 时写入，是权威归属。
     * 历史数据缺该字段时（早期注册的 Skill）退回前缀匹配兜底。
     */
    private List<McpSkillEntry> fetchMcpSkills(String server) {
        JsonNode data = agentOpsClient.listSkills(Map.of(
                "source", "mcp",
                "page_size", String.valueOf(MCP_SKILL_PAGE_SIZE)));
        List<McpSkillEntry> result = new ArrayList<>();
        if (data == null) {
            return result;
        }
        JsonNode items = data.get("items");
        if (items == null || !items.isArray()) {
            log.warn("MCP Skill 列表缺 items 数组，按空集合处理: server={}", server);
            return result;
        }
        for (JsonNode node : items) {
            String skillId = node.path("skill_id").asText("");
            if (!skillId.startsWith(MCP_SKILL_PREFIX)) {
                continue;
            }
            String mcpServer = node.path("mcp_server").asText("");
            boolean belongs;
            if (!mcpServer.isBlank()) {
                belongs = mcpServer.equals(server);
            } else {
                belongs = skillId.startsWith(MCP_SKILL_PREFIX + server + "-");
            }
            if (belongs) {
                result.add(new McpSkillEntry(skillId, mcpServer));
            }
        }
        return result;
    }

    /**
     * 建立 {@code sys_menu.id → roleIds} 反查表。
     *
     * <p>这是整个聚合里唯一昂贵的部分：{@code listEnabledRoles} 一次 + 每角色
     * {@code listRoleMenus} 一次。建一次表，所有 skill 共查 —— 不为每个工具重复
     * 拉角色，也绝不逐工具 {@code ensureCode}（见类注释）。
     */
    private Map<Long, List<Long>> buildMenuRoleMap() {
        Long tenantId = RequestContext.requireTenantId();
        long appId = resolveSystemAppId(tenantId);

        Map<Long, List<Long>> menuIdToRoleIds = new HashMap<>();
        for (IamRoleVO role : iamWebClient.listEnabledRoles(tenantId, appId)) {
            Long roleId = parseId(role.id());
            if (roleId == null) {
                continue;
            }
            for (Long menuId : iamWebClient.listRoleMenus(roleId)) {
                if (menuId == null) {
                    continue;
                }
                menuIdToRoleIds.computeIfAbsent(menuId, k -> new ArrayList<>()).add(roleId);
            }
        }
        return menuIdToRoleIds;
    }

    /**
     * 按 skill 的执行码菜单反查持有角色。
     *
     * <p>用 {@code findMenuId}（只查不建）：未 discover 的工具不该建码（调用方在
     * discovered=false 时根本不传本方法）；已 discover / 已下线的工具若从未建过码
     * （历史上直接注册 Skill 但没进过授权页），返回空角色集即可。
     */
    private List<Long> roleIdsOf(Map<Long, List<Long>> menuIdToRoleIds, String skillId) {
        Long menuId = skillPermissionCodeService.findMenuId(skillId);
        if (menuId == null) {
            return List.of();
        }
        List<Long> roleIds = menuIdToRoleIds.get(menuId);
        return roleIds == null ? List.of() : List.copyOf(roleIds);
    }

    // ==================================================================
    // 清理（破坏性）
    // ==================================================================

    /**
     * 清理已下线 MCP 工具：三步「先远端后本地」。
     *
     * @param skillId 残留 Skill ID（{@code mcp-} 前缀）
     * @return 处置结果（菜单是否删除、哪些角色的菜单关联被回收）
     */
    public McpOfflineCleanupResultVO cleanupOfflineSkill(String skillId) {
        if (skillId == null || skillId.isBlank()) {
            throw new BusinessException(ResultCode.VALIDATION_ERROR, "skill_id 不能为空");
        }
        if (!skillId.startsWith(MCP_SKILL_PREFIX)) {
            throw new BusinessException(ResultCode.VALIDATION_ERROR, "仅支持清理 mcp- 前缀的 Skill");
        }

        // ① ai-platform 注销 Skill —— 先删远端：失败则整体中止，
        //    避免「菜单已删但 Skill 还在」这种更难收拾的半截状态。
        agentOpsClient.deleteSkill(skillId);
        log.info("已下线 MCP 工具清理: ai-platform 注销 Skill {}", skillId);

        // ② mis-system 删除对应 sys_menu（先查后删，只查不建）
        Long menuId = skillPermissionCodeService.findMenuId(skillId);
        boolean menuRemoved = false;
        if (menuId != null) {
            systemWebClient.deleteMenu(menuId);
            menuRemoved = true;
            // 缓存里的 permission→menuId 必须清掉：否则将来该工具重新 discover 时
            // ensureCode 命中指向已删菜单的陈旧映射，授权写进 sys_role_menu 后查无此行。
            skillPermissionCodeService.evictCode(skillId);
            log.info("已下线 MCP 工具清理: 删除 sys_menu menuId={} skillId={}", menuId, skillId);
        } else {
            log.info("已下线 MCP 工具清理: 该执行码从未建过菜单，跳过删菜单 skillId={}", skillId);
        }

        // ③ mis-iam 回收 sys_role_menu（read-modify-write，只改持有该菜单的角色）
        List<Long> rolesUpdated = recycleRoleMenus(menuId);

        return new McpOfflineCleanupResultVO(skillId, menuRemoved, rolesUpdated);
    }

    /**
     * 回收持有 {@code menuId} 的角色关联（全量读改写）。
     *
     * <p>与 {@link AgentOpsGrantService#updateGrants} 同一安全模式：逐角色
     * {@code listRoleMenus} 读全量 → 内存移除 {@code menuId} → {@code assignRoleMenus}
     * 写回全量。绝不能只传「去掉了 menuId 的集合」之外的任何子集，否则会把该角色
     * 其余菜单权限一并清空。
     */
    private List<Long> recycleRoleMenus(Long menuId) {
        List<Long> updated = new ArrayList<>();
        if (menuId == null) {
            return updated;
        }
        Long tenantId = RequestContext.requireTenantId();
        long appId = resolveSystemAppId(tenantId);

        for (IamRoleVO role : iamWebClient.listEnabledRoles(tenantId, appId)) {
            Long roleId = parseId(role.id());
            if (roleId == null) {
                continue;
            }
            List<Long> current = iamWebClient.listRoleMenus(roleId);
            if (!current.contains(menuId)) {
                continue;
            }
            List<Long> next = new ArrayList<>(current);
            next.remove(menuId);
            iamWebClient.assignRoleMenus(roleId, next);
            updated.add(roleId);
            log.info("已下线 MCP 工具清理: 回收角色菜单关联 roleId={} menuId={} (菜单数 {} → {})",
                    roleId, menuId, current.size(), next.size());
        }
        return updated;
    }

    // ==================================================================
    // skill_id / tool 名推导
    // ==================================================================

    /**
     * 按 ai-platform 的判别名规则拼 {@code skill_id}：{@code mcp-{server}-{tool}}。
     *
     * <p>{@code tool} 必须是 ai-platform live 清单返回的<b>原始名</b>（可含点号，
     * 如 {@code profile.query}），不做任何净化 —— 与 {@code discovery.py} / 
     * {@code acl_tool_wrapper.py} 的拼接规则逐字节一致。
     */
    static String skillIdOf(String server, String tool) {
        return MCP_SKILL_PREFIX + server + "-" + tool;
    }

    /**
     * 从 {@code skill_id} 反推展示用工具名：去掉 {@code mcp-{server}-} 前缀。
     *
     * <p><b>仅用于展示</b>（已下线工具没有 live 行，没有现成的工具名字段可展示）。
     * 归属已由 {@code mcp_server} 精确锚定，故剩余段必然对应原始工具名。
     * 本方法不参与任何判权拼接，与「严禁从展示名反解判别名」的铁律不冲突。
     *
     * @return 工具名；skill_id 前缀不匹配时返回 {@code null}
     */
    static String toolNameOf(String server, String skillId) {
        String prefix = MCP_SKILL_PREFIX + server + "-";
        if (skillId == null || !skillId.startsWith(prefix) || skillId.length() == prefix.length()) {
            return null;
        }
        return skillId.substring(prefix.length());
    }

    // ==================================================================
    // 基础设施（与 AgentOpsGrantService 同口径，刻意重复不抽公共类）
    // ==================================================================

    private long resolveSystemAppId(Long tenantId) {
        try {
            for (AppVO app : iamWebClient.listApps(tenantId, null)) {
                if (app != null && SYSTEM_APP_CODE.equals(app.code())) {
                    Long id = parseId(app.id());
                    if (id != null) {
                        return id;
                    }
                }
            }
        } catch (RuntimeException ex) {
            log.warn("查询 system App 失败，回落到 app_id={}: {}", SYSTEM_APP_ID_FALLBACK, ex.toString());
            return SYSTEM_APP_ID_FALLBACK;
        }
        log.warn("未在 IAM 中找到 code={} 的 App，回落到 app_id={}", SYSTEM_APP_CODE, SYSTEM_APP_ID_FALLBACK);
        return SYSTEM_APP_ID_FALLBACK;
    }

    private static Long parseId(String raw) {
        if (raw == null || raw.isBlank()) {
            return null;
        }
        try {
            return Long.valueOf(raw.trim());
        } catch (NumberFormatException ex) {
            return null;
        }
    }

    /** 聚合过程内部的 live 工具行。 */
    private record McpToolEntry(String name, String description) {
    }

    /** 聚合过程内部的已 discover Skill 行。 */
    private record McpSkillEntry(String skillId, String mcpServer) {
    }
}
