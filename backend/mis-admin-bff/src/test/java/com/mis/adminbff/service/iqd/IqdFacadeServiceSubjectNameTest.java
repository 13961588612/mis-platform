package com.mis.adminbff.service.iqd;

import com.mis.adminbff.client.AiPlatformClient;
import com.mis.adminbff.client.IamWebClient;
import com.mis.adminbff.client.IqdClient;
import com.mis.adminbff.client.model.IamRoleVO;
import com.mis.adminbff.config.IqdProperties;
import com.mis.adminbff.dto.iqd.IqdAclVO;
import com.mis.adminbff.dto.iqd.IqdScopePolicyVO;
import com.mis.adminbff.security.UserPermissionLoader;
import com.mis.adminbff.service.KbSubjectProxyService;
import com.mis.common.security.context.LoginUser;
import com.mis.common.security.context.SecurityContextHolder;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class IqdFacadeServiceSubjectNameTest {

    private IqdClient iqdClient;
    private IqdProperties properties;
    private UserPermissionLoader userPermissionLoader;
    private KbSubjectProxyService subjectProxyService;
    private IamWebClient iamWebClient;
    private IqdFacadeService facade;

    @BeforeEach
    void setUp() {
        iqdClient = mock(IqdClient.class);
        properties = mock(IqdProperties.class);
        userPermissionLoader = mock(UserPermissionLoader.class);
        subjectProxyService = mock(KbSubjectProxyService.class);
        iamWebClient = mock(IamWebClient.class);
        facade = new IqdFacadeService(
                iqdClient,
                properties,
                userPermissionLoader,
                mock(AiPlatformClient.class),
                subjectProxyService,
                iamWebClient);

        LoginUser user = new LoginUser();
        user.setUserId(99L);
        user.setTenantId(1L);
        user.setAppId(10L);
        user.setPermissions(Set.of("iqd:scope:view", "iqd:acl:view"));
        SecurityContextHolder.setLoginUser(user);

        when(properties.getScopeViewPermission()).thenReturn("iqd:scope:view");
        when(properties.getAclViewPermission()).thenReturn("iqd:acl:view");
        when(userPermissionLoader.load(any())).thenReturn(Set.of("iqd:scope:view", "iqd:acl:view"));
    }

    @AfterEach
    void tearDown() {
        SecurityContextHolder.clear();
    }

    @Test
    @DisplayName("listScopePolicies 回填 subject_name：数字 ID 走批量主体解析，角色码走 enabled roles")
    void listScopePoliciesFillsSubjectNames() {
        IqdScopePolicyVO userRow = new IqdScopePolicyVO();
        userRow.setSubjectType("user");
        userRow.setSubjectId("11");
        userRow.setItemKey("pg.public.orders");

        IqdScopePolicyVO roleCodeRow = new IqdScopePolicyVO();
        roleCodeRow.setSubjectType("role");
        roleCodeRow.setSubjectId("SALES");
        roleCodeRow.setItemKey("pg.public.orders");

        when(iqdClient.listScopePolicies(900001L)).thenReturn(List.of(userRow, roleCodeRow));
        when(subjectProxyService.resolveNames(any()))
                .thenReturn(Map.of("user:11", "张三"));
        when(iamWebClient.listEnabledRoles(1L, 10L))
                .thenReturn(List.of(new IamRoleVO("1", "1", "10", "SALES", "销售", 1, 1, 1, null, null)));

        List<IqdScopePolicyVO> result = facade.listScopePolicies(900001L);

        assertEquals("张三", result.get(0).getSubjectName());
        assertEquals("销售", result.get(1).getSubjectName());
    }

    @Test
    @DisplayName("listAcls 回填 subject_name，缺失名称保持 null")
    void listAclsFillsSubjectNamesAndKeepsMissingNull() {
        IqdAclVO userRow = new IqdAclVO();
        userRow.setSubjectType("user");
        userRow.setSubjectId("11");
        userRow.setItemKey("pg.public.orders");
        userRow.setAction("ask");

        IqdAclVO missingRow = new IqdAclVO();
        missingRow.setSubjectType("user");
        missingRow.setSubjectId("99");
        missingRow.setItemKey("pg.public.orders");
        missingRow.setAction("ask");

        when(iqdClient.listAcls(900001L)).thenReturn(List.of(userRow, missingRow));
        when(subjectProxyService.resolveNames(any()))
                .thenReturn(Map.of("user:11", "张三"));

        List<IqdAclVO> result = facade.listAcls(900001L);

        assertEquals("张三", result.get(0).getSubjectName());
        assertEquals(null, result.get(1).getSubjectName());
    }
}
