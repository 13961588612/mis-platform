package com.mis.adminbff.controller;

import com.mis.adminbff.dto.agentops.McpOfflineCleanupRequest;
import com.mis.adminbff.dto.agentops.McpOfflineCleanupResultVO;
import com.mis.adminbff.dto.agentops.McpOfflineSkillVO;
import com.mis.adminbff.dto.agentops.McpServerToolsVO;
import com.mis.adminbff.dto.agentops.McpToolPermissionVO;
import com.mis.adminbff.service.agentops.McpPermissionService;
import com.mis.common.core.exception.BusinessException;
import com.mis.common.core.exception.ResultCode;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * {@link McpPermissionController} 路由回归测试（MockMvc standaloneSetup）。
 *
 * <p>验证两条新端点的路径、入参、响应形状，以及转发给 {@link McpPermissionService}
 * 的参数（{@code server} 透传 / {@code skill_id} 从 body 解出）。
 */
class McpPermissionControllerTest {

    private McpPermissionService service;
    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        service = mock(McpPermissionService.class);
        mockMvc = MockMvcBuilders.standaloneSetup(new McpPermissionController(service)).build();
    }

    @Test
    @DisplayName("GET /api/v1/agent-ops/mcp/tools?server=member → Result.ok(聚合视图)")
    void listMcpToolPermissionsRoute() throws Exception {
        McpServerToolsVO vo = new McpServerToolsVO(
                "member",
                List.of(new McpToolPermissionVO(
                        "profile.query",
                        "查会员资料",
                        "mcp-member-profile.query",
                        "ai:skill:mcp-member-profile.query:run",
                        true,
                        List.of(3L))),
                List.of(new McpOfflineSkillVO(
                        "mcp-member-retired.tool",
                        "retired.tool",
                        "ai:skill:mcp-member-retired.tool:run",
                        List.of(7L))));
        when(service.aggregateTools("member")).thenReturn(vo);

        mockMvc.perform(get("/api/v1/agent-ops/mcp/tools").param("server", "member"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.server").value("member"))
                .andExpect(jsonPath("$.data.tools[0].name").value("profile.query"))
                .andExpect(jsonPath("$.data.tools[0].skill_id").value("mcp-member-profile.query"))
                .andExpect(jsonPath("$.data.tools[0].permission_code")
                        .value("ai:skill:mcp-member-profile.query:run"))
                .andExpect(jsonPath("$.data.tools[0].discovered").value(true))
                .andExpect(jsonPath("$.data.tools[0].role_ids[0]").value(3))
                .andExpect(jsonPath("$.data.offline_skills[0].skill_id")
                        .value("mcp-member-retired.tool"));

        verify(service).aggregateTools("member");
    }

    @Test
    @DisplayName("POST /api/v1/agent-ops/mcp/tools/cleanup-offline → 解出 skill_id 转发")
    void cleanupOfflineRoute() throws Exception {
        McpOfflineCleanupResultVO result = new McpOfflineCleanupResultVO(
                "mcp-member-retired.tool", true, List.of(3L));
        when(service.cleanupOfflineSkill("mcp-member-retired.tool")).thenReturn(result);

        mockMvc.perform(post("/api/v1/agent-ops/mcp/tools/cleanup-offline")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"skill_id\":\"mcp-member-retired.tool\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.skill_id").value("mcp-member-retired.tool"))
                .andExpect(jsonPath("$.data.menu_removed").value(true))
                .andExpect(jsonPath("$.data.roles_updated[0]").value(3));

        verify(service).cleanupOfflineSkill("mcp-member-retired.tool");
    }

    @Test
    @DisplayName("cleanup-offline 转发异常：service 抛 BusinessException → 原样上抛，不吞")
    void cleanupOfflineServiceErrorPropagates() {
        BusinessException boom = new BusinessException(ResultCode.VALIDATION_ERROR, "skill_id 不能为空");
        when(service.cleanupOfflineSkill(any())).thenThrow(boom);

        McpPermissionController controller = new McpPermissionController(service);
        BusinessException ex = assertThrows(BusinessException.class,
                () -> controller.cleanupOfflineSkill(new McpOfflineCleanupRequest("member.profile")));

        assertEquals(ResultCode.VALIDATION_ERROR.getCode(), ex.getCode());
        verify(service).cleanupOfflineSkill("member.profile");
    }
}
