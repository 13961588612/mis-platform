package com.mis.adminbff.service.agentops;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.mis.adminbff.client.AgentOpsClient;
import com.mis.adminbff.client.IamWebClient;
import com.mis.adminbff.client.SystemWebClient;
import com.mis.adminbff.client.model.AppVO;
import com.mis.adminbff.client.model.IamRoleVO;
import com.mis.adminbff.dto.agentops.McpOfflineCleanupResultVO;
import com.mis.adminbff.dto.agentops.McpOfflineSkillVO;
import com.mis.adminbff.dto.agentops.McpServerToolsVO;
import com.mis.adminbff.dto.agentops.McpToolPermissionVO;
import com.mis.common.core.exception.BusinessException;
import com.mis.common.security.context.LoginUser;
import com.mis.common.security.context.SecurityContextHolder;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * {@link McpPermissionService} 的 Mockito 单测（仓库约束：BFF 零 {@code @SpringBootTest}）。
 *
 * <p>覆盖三路聚合与清理链路：
 * <ul>
 *   <li><b>聚合</b>：live 工具 × MCP Skill 集合 × IAM 角色翻转，验证
 *       {@code skill_id} 拼接、{@code discovered} 判定、{@code role_ids} 反查、
 *       {@code offline_skills} 归属（含 {@code mcp_server} 锚定，杜绝前缀误判）；</li>
 *   <li><b>清理</b>：三步顺序（ai-platform 注销 → 删 sys_menu → 回收 sys_role_menu），
 *       以及「从未建过菜单」「非 mcp- 前缀拒绝」两条边界。</li>
 * </ul>
 */
class McpPermissionServiceTest {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private AgentOpsClient agentOpsClient;
    private IamWebClient iamWebClient;
    private SystemWebClient systemWebClient;
    private SkillPermissionCodeService skillPermissionCodeService;
    private McpPermissionService service;

    @BeforeEach
    void setUp() {
        agentOpsClient = mock(AgentOpsClient.class);
        iamWebClient = mock(IamWebClient.class);
        systemWebClient = mock(SystemWebClient.class);
        skillPermissionCodeService = mock(SkillPermissionCodeService.class);
        service = new McpPermissionService(
                agentOpsClient, iamWebClient, systemWebClient, skillPermissionCodeService);
        SecurityContextHolder.clear();
        SecurityContextHolder.setLoginUser(loginUser());
        when(iamWebClient.listApps(1L, null)).thenReturn(List.of(new AppVO(
                "1", "1", "system", "system", null, null, null, null, null, null, 1, 1)));
    }

    @AfterEach
    void tearDown() {
        SecurityContextHolder.clear();
    }

    private static LoginUser loginUser() {
        LoginUser user = new LoginUser();
        user.setUserId(42L);
        user.setTenantId(1L);
        user.setAppId(91010L);
        user.setUsername("tester");
        return user;
    }

    private static IamRoleVO role(Long id, String code) {
        return new IamRoleVO(String.valueOf(id), "1", "1", code, "角色" + id, 1, 1, 1, null, null);
    }

    private static ObjectNode skillNode(String skillId, String mcpServer) {
        ObjectNode node = MAPPER.createObjectNode();
        node.put("skill_id", skillId);
        node.put("name", skillId);
        node.put("mcp_server", mcpServer);
        return node;
    }

    private static ObjectNode toolNode(String name, String description) {
        ObjectNode node = MAPPER.createObjectNode();
        node.put("name", name);
        node.put("description", description);
        return node;
    }

    /** 组装 ai-platform SkillListResponse 信封（{@code {items, total, page, page_size}}）。 */
    private static JsonNode skillListEnvelope(ObjectNode... items) {
        ArrayNode array = MAPPER.createArrayNode();
        for (ObjectNode item : items) {
            array.add(item);
        }
        ObjectNode envelope = MAPPER.createObjectNode();
        envelope.set("items", array);
        envelope.put("total", array.size());
        envelope.put("page", 1);
        envelope.put("page_size", 100);
        return envelope;
    }

    @Nested
    @DisplayName("聚合：三路数据正确合成")
    class Aggregate {

        @Test
        @DisplayName("live 工具 + discovered 判定 + role_ids 反查（menuId→角色翻转）")
        void aggregateDiscoveredWithRoles() {
            // live 工具：profile.query 已 discover、old.deprecated 未 discover
            ArrayNode tools = MAPPER.createArrayNode();
            tools.add(toolNode("profile.query", "查会员资料"));
            tools.add(toolNode("old.deprecated", "旧工具"));
            when(agentOpsClient.mcpTools("member")).thenReturn(tools);

            // mcp skills：只有 profile.query 被注册
            when(agentOpsClient.listSkills(Map.of("source", "mcp", "page_size", "100")))
                    .thenReturn(skillListEnvelope(skillNode("mcp-member-profile.query", "member")));

            // 角色：role 3 有 menu 501（profile.query 的执行码菜单）；role 7 没有
            when(iamWebClient.listEnabledRoles(1L, 1L))
                    .thenReturn(List.of(role(3L, "ops"), role(7L, "audit")));
            when(iamWebClient.listRoleMenus(3L)).thenReturn(List.of(101L, 501L));
            when(iamWebClient.listRoleMenus(7L)).thenReturn(List.of(202L));
            when(skillPermissionCodeService.findMenuId("mcp-member-profile.query")).thenReturn(501L);
            // old.deprecated 未 discover —— 不应触发 findMenuId（不建码）
            when(skillPermissionCodeService.findMenuId("mcp-member-old.deprecated")).thenReturn(null);

            McpServerToolsVO vo = service.aggregateTools("member");

            assertEquals("member", vo.server());
            assertEquals(2, vo.tools().size());
            assertEquals(0, vo.offlineSkills().size());

            McpToolPermissionVO discovered = vo.tools().get(0);
            assertEquals("profile.query", discovered.name());
            assertEquals("mcp-member-profile.query", discovered.skillId());
            assertEquals("ai:skill:mcp-member-profile.query:run", discovered.permissionCode());
            assertTrue(discovered.discovered());
            assertEquals(List.of(3L), discovered.roleIds());

            McpToolPermissionVO undiscovered = vo.tools().get(1);
            assertEquals("old.deprecated", undiscovered.name());
            assertEquals("mcp-member-old.deprecated", undiscovered.skillId());
            assertFalse(undiscovered.discovered());
            assertEquals(List.of(), undiscovered.roleIds());

            // 已 discover 的工具触发 findMenuId（只查不建）；未 discover 的绝不触发
            verify(skillPermissionCodeService).findMenuId("mcp-member-profile.query");
            verify(skillPermissionCodeService, never()).findMenuId("mcp-member-old.deprecated");
            verify(skillPermissionCodeService, never()).ensureCode(any());
        }

        @Test
        @DisplayName("已 discover 但 live 清单已无 → 进 offline_skills（mcp_server 锚定）")
        void aggregateOfflineSkill() {
            ArrayNode tools = MAPPER.createArrayNode();
            tools.add(toolNode("profile.query", "查会员资料"));
            when(agentOpsClient.mcpTools("member")).thenReturn(tools);

            // 残留 skill：profile.query 已 discover（live 有）；retired.tool 已下线（live 无）；
            // 另一个 server 的 foo 不属于本 server
            when(agentOpsClient.listSkills(Map.of("source", "mcp", "page_size", "100")))
                    .thenReturn(skillListEnvelope(
                            skillNode("mcp-member-profile.query", "member"),
                            skillNode("mcp-member-retired.tool", "member"),
                            skillNode("mcp-other-foo", "other")));

            when(iamWebClient.listEnabledRoles(1L, 1L)).thenReturn(List.of(role(3L, "ops")));
            when(iamWebClient.listRoleMenus(3L)).thenReturn(List.of(601L));
            when(skillPermissionCodeService.findMenuId("mcp-member-retired.tool")).thenReturn(601L);

            McpServerToolsVO vo = service.aggregateTools("member");

            assertEquals(1, vo.tools().size());
            assertEquals("profile.query", vo.tools().get(0).name());
            assertTrue(vo.tools().get(0).discovered());
            assertEquals(List.of(), vo.tools().get(0).roleIds());

            assertEquals(1, vo.offlineSkills().size());
            McpOfflineSkillVO offline = vo.offlineSkills().get(0);
            assertEquals("mcp-member-retired.tool", offline.skillId());
            assertEquals("retired.tool", offline.tool(), "tool 为 skill_id 去掉 server 前缀的剩余段");
            assertEquals("ai:skill:mcp-member-retired.tool:run", offline.permissionCode());
            assertEquals(List.of(3L), offline.roleIds());
        }

        @Test
        @DisplayName("mcp_server 缺失的历史 Skill 按前缀兜底归属；归属他人时不计入")
        void aggregateLegacySkillWithoutMcpServer() {
            ArrayNode tools = MAPPER.createArrayNode();
            tools.add(toolNode("profile.query", "查会员资料"));
            when(agentOpsClient.mcpTools("member")).thenReturn(tools);

            // 历史数据无 mcp_server：member 前缀命中；member-x 是另一个 server，不能误判
            when(agentOpsClient.listSkills(Map.of("source", "mcp", "page_size", "100")))
                    .thenReturn(skillListEnvelope(
                            skillNode("mcp-member-profile.query", ""),
                            skillNode("mcp-member-x-extra", "member-x")));

            when(iamWebClient.listEnabledRoles(1L, 1L)).thenReturn(List.of());

            McpServerToolsVO vo = service.aggregateTools("member");

            assertEquals(1, vo.tools().size());
            assertTrue(vo.tools().get(0).discovered(), "member-profile.query 应被识别为已 discover");
            assertEquals(0, vo.offlineSkills().size(), "member-x 的 Skill 不应被算进 member 的已下线");
        }

        @Test
        @DisplayName("live 工具清单为空时仍能返回 offline_skills（清理区不依赖 live 清单）")
        void aggregateEmptyLiveToolsStillListsOffline() {
            when(agentOpsClient.mcpTools("member")).thenReturn(MAPPER.createArrayNode());
            when(agentOpsClient.listSkills(Map.of("source", "mcp", "page_size", "100")))
                    .thenReturn(skillListEnvelope(skillNode("mcp-member-retired.tool", "member")));
            when(iamWebClient.listEnabledRoles(1L, 1L)).thenReturn(List.of());
            when(skillPermissionCodeService.findMenuId("mcp-member-retired.tool")).thenReturn(null);

            McpServerToolsVO vo = service.aggregateTools("member");

            assertEquals(0, vo.tools().size());
            assertEquals(1, vo.offlineSkills().size());
            assertEquals(List.of(), vo.offlineSkills().get(0).roleIds());
        }

        @Test
        @DisplayName("server 为空 → 400")
        void aggregateBlankServerRejected() {
            assertThrows(BusinessException.class, () -> service.aggregateTools("  "));
        }
    }

    @Nested
    @DisplayName("清理：三步顺序与边界")
    class Cleanup {

        @Test
        @DisplayName("正常链路：注销 Skill → 删菜单 → 回收角色菜单（read-modify-write 写全量）")
        void cleanupHappyPath() {
            when(skillPermissionCodeService.findMenuId("mcp-member-retired.tool")).thenReturn(501L);
            when(iamWebClient.listEnabledRoles(1L, 1L))
                    .thenReturn(List.of(role(3L, "ops"), role(7L, "audit")));
            when(iamWebClient.listRoleMenus(3L)).thenReturn(List.of(101L, 501L, 102L));
            when(iamWebClient.listRoleMenus(7L)).thenReturn(List.of(202L));

            McpOfflineCleanupResultVO result = service.cleanupOfflineSkill("mcp-member-retired.tool");

            verify(agentOpsClient).deleteSkill("mcp-member-retired.tool");
            verify(systemWebClient).deleteMenu(501L);
            verify(skillPermissionCodeService).evictCode("mcp-member-retired.tool");

            // 只回收持有 501 的角色 3，且写回的是全量（删掉 501 后剩 101、102）
            verify(iamWebClient).assignRoleMenus(3L, List.of(101L, 102L));
            verify(iamWebClient, never()).assignRoleMenus(eq(7L), any());

            assertTrue(result.menuRemoved());
            assertEquals(List.of(3L), result.rolesUpdated());
        }

        @Test
        @DisplayName("执行码从未建过菜单 → 不删菜单、不回收角色，仅注销 Skill")
        void cleanupWithoutMenu() {
            when(skillPermissionCodeService.findMenuId("mcp-member-retired.tool")).thenReturn(null);
            when(iamWebClient.listEnabledRoles(1L, 1L)).thenReturn(List.of(role(3L, "ops")));
            when(iamWebClient.listRoleMenus(3L)).thenReturn(List.of(101L));

            McpOfflineCleanupResultVO result = service.cleanupOfflineSkill("mcp-member-retired.tool");

            verify(agentOpsClient).deleteSkill("mcp-member-retired.tool");
            verify(systemWebClient, never()).deleteMenu(any());
            verify(skillPermissionCodeService, never()).evictCode(any());
            verify(iamWebClient, never()).assignRoleMenus(any(), any());

            assertFalse(result.menuRemoved());
            assertEquals(List.of(), result.rolesUpdated());
        }

        @Test
        @DisplayName("非 mcp- 前缀的 skill_id → 400，且不触碰任何下游")
        void cleanupRejectsNonMcpPrefix() {
            assertThrows(BusinessException.class, () -> service.cleanupOfflineSkill("member.profile"));

            verify(agentOpsClient, never()).deleteSkill(any());
            verify(systemWebClient, never()).deleteMenu(any());
        }
    }
}
