package com.mis.adminbff.service.agentops;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.NullNode;
import com.mis.adminbff.client.AgentOpsClient;
import com.mis.adminbff.service.KbSubjectProxyService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 技能池删除须级联收执行码（与 createSkill → ensureCode 对称）。
 */
@ExtendWith(MockitoExtension.class)
class AgentOpsFacadeDeleteSkillTest {

    @Mock
    private AgentOpsClient client;
    @Mock
    private SkillPermissionCodeService skillPermissionCodeService;
    @Mock
    private AgentOpsGrantService agentOpsGrantService;
    @Mock
    private KbSubjectProxyService subjectProxyService;

    private AgentOpsFacadeService facade;

    @BeforeEach
    void setUp() {
        facade = new AgentOpsFacadeService(
                client,
                skillPermissionCodeService,
                agentOpsGrantService,
                subjectProxyService,
                new ObjectMapper());
    }

    @Test
    @DisplayName("删除技能：下游注销后删除执行码菜单并回收角色授权")
    void deleteSkillCascadesPermissionCode() {
        when(client.deleteSkill("demo")).thenReturn(NullNode.getInstance());
        when(skillPermissionCodeService.removeCode("demo")).thenReturn(92210L);

        facade.deleteSkill("demo");

        verify(client).deleteSkill("demo");
        verify(skillPermissionCodeService).removeCode("demo");
        verify(agentOpsGrantService).revokeMenuFromAllRoles(92210L);
    }

    @Test
    @DisplayName("删除技能：从未建过执行码时不回收角色菜单")
    void deleteSkillWithoutMenuSkipsRevoke() {
        when(client.deleteSkill("demo")).thenReturn(NullNode.getInstance());
        when(skillPermissionCodeService.removeCode("demo")).thenReturn(null);

        facade.deleteSkill("demo");

        verify(skillPermissionCodeService).removeCode("demo");
        verify(agentOpsGrantService, never()).revokeMenuFromAllRoles(anyLong());
    }

    @Test
    @DisplayName("删除技能：级联清理失败不阻断主流程（技能已删）")
    void deleteSkillCascadeFailureIsBestEffort() {
        when(client.deleteSkill("demo")).thenReturn(NullNode.getInstance());
        when(skillPermissionCodeService.removeCode(anyString()))
                .thenThrow(new RuntimeException("mis-system down"));

        facade.deleteSkill("demo");

        verify(client).deleteSkill("demo");
        verify(agentOpsGrantService, never()).revokeMenuFromAllRoles(anyLong());
    }
}
