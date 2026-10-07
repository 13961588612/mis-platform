package com.mis.adminbff.service;

import com.mis.adminbff.client.IamWebClient;
import com.mis.adminbff.client.OrgWebClient;
import com.mis.adminbff.client.model.IamRoleVO;
import com.mis.adminbff.client.model.IamUserVO;
import com.mis.adminbff.client.model.UserDataSetScopeVO;
import com.mis.adminbff.support.AgentOpsErrorCodes;
import com.mis.common.core.exception.BusinessException;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class IdentityContextServiceTest {

    @Mock
    private IamWebClient iamWebClient;

    @Mock
    private OrgWebClient orgWebClient;

    @InjectMocks
    private IdentityContextService service;

    @Test
    @DisplayName("IAM 角色码写入 X-Mis-Roles（code 主键），与测试问数头同构")
    void rolesSerializedAsCodePrimary() {
        when(iamWebClient.getUser(1L)).thenReturn(userWithRoles(
                new IamRoleVO("81", "1", "10", "IT-TESTER", "t", 1, 1, 1, null, null),
                new IamRoleVO("82", "1", "10", "TENANT_ADMIN", "a", 1, 1, 1, null, null)));
        when(orgWebClient.getUserDataSetScope(1L)).thenReturn(
                new UserDataSetScopeVO(1L, 1, true, List.of(), List.of(), List.of(), List.of(), List.of()));

        IdentityAskContext ctx = service.resolve(1L, 9L);

        assertEquals(1L, ctx.userId());
        String roles = ctx.headers().get(IdentityContextService.HEADER_MIS_ROLES);
        assertTrue(roles.contains("\"code\":\"IT-TESTER\""));
        assertTrue(roles.contains("\"code\":\"TENANT_ADMIN\""));
        assertTrue(ctx.headers().get(IdentityContextService.HEADER_MIS_ORGS).contains("\"id\":\"9\""));
        assertEquals("all", ctx.headers().get(IdentityContextService.HEADER_MIS_DATA_SCOPE));
    }

    @Test
    @DisplayName("IAM 不可达 → ACL_UNAVAILABLE，不返回空角色冒充零权限")
    void iamDownIsUnavailable() {
        when(iamWebClient.getUser(1L)).thenThrow(new RuntimeException("iam down"));

        BusinessException ex = assertThrows(BusinessException.class, () -> service.resolve(1L, null));
        assertEquals(AgentOpsErrorCodes.ACL_UNAVAILABLE, ex.getCode());
    }

    @Test
    @DisplayName("用户不存在 → headers 无角色（合法空，交由问数 45204）")
    void missingUserHasEmptyRoles() {
        when(iamWebClient.getUser(7L)).thenReturn(null);
        when(orgWebClient.getUserDataSetScope(7L)).thenReturn(null);

        IdentityAskContext ctx = service.resolve(7L, null);
        assertFalse(ctx.headers().containsKey(IdentityContextService.HEADER_MIS_ROLES));
    }

    private static IamUserVO userWithRoles(IamRoleVO... roles) {
        return new IamUserVO(
                "1", "1", "10", "e1", "admin", null, 1, 1, 0,
                "admin", null, "100", null, List.of(), List.of(), List.of(roles), null, null);
    }
}
