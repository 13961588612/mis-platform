package com.mis.adminbff.service;

import com.mis.adminbff.client.IamWebClient;
import com.mis.adminbff.client.OrgWebClient;
import com.mis.adminbff.client.SystemWebClient;
import com.mis.adminbff.client.model.ConfigVO;
import com.mis.adminbff.client.model.DeptVO;
import com.mis.adminbff.client.model.EmployeeVO;
import com.mis.adminbff.client.model.IamUserVO;
import com.mis.adminbff.config.BffProperties;
import com.mis.adminbff.dto.UserCreateRequest;
import com.mis.adminbff.dto.UserUpdateRequest;
import com.mis.common.core.exception.BusinessException;
import com.mis.common.core.exception.ResultCode;
import com.mis.common.security.context.LoginUser;
import com.mis.common.security.context.SecurityContextHolder;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * UserAggregateService 用户-员工绑定三态 + 强制绑定参数（user.force.employee.bind）校验测试。
 *
 * <p>项目无 Spring/DB 集成测试基座，按 Mockito 装配协作者；测试前注入 {@link SecurityContextHolder}
 * 模拟网关透传的租户/APP 上下文（BFF 服务内 {@code RequestContext.requireTenantId/AppId} 依赖它）。
 */
@ExtendWith(MockitoExtension.class)
class UserAggregateServiceBindStateTest {

    private static final String FORCE_BIND_KEY = "user.force.employee.bind";

    @Mock IamWebClient iamWebClient;
    @Mock OrgWebClient orgWebClient;
    @Mock BffProperties properties;
    @Mock SystemWebClient systemWebClient;

    @InjectMocks UserAggregateService service;

    @BeforeEach
    void initContext() {
        LoginUser loginUser = new LoginUser();
        loginUser.setUserId(99L);
        loginUser.setTenantId(1L);
        loginUser.setAppId(10L);
        SecurityContextHolder.setLoginUser(loginUser);

        lenient().when(properties.getDefaultPassword()).thenReturn("defPass");
        lenient().when(properties.getAggregateTimeoutMs()).thenReturn(5000L);
        lenient().when(orgWebClient.orgNames(anyList())).thenReturn(Map.of());
    }

    private IamUserVO unboundReturn() {
        return new IamUserVO("1", "1", "10", null, "u1", null, 1, 0, 1,
                null, null, null, null, List.of(), List.of(), List.of(), null, null);
    }

    private IamUserVO boundReturn(String employeeId) {
        return new IamUserVO("7", "1", "10", employeeId, "u7", null, 1, 0, 1,
                "Name7", null, null, "135", List.of(), List.of(), List.of(), null, null);
    }

    private EmployeeVO employee(Long id, String deptId) {
        return new EmployeeVO(id.toString(), "1", deptId, List.of(deptId), deptId, "OrgName",
                List.of(), "E" + id, "Alice", "a@x", "139", 0, "T", null, 1, null, null);
    }

    private DeptVO dept(String id, String orgId) {
        return new DeptVO(id, "1", orgId, null, "d" + id, "Dept" + id, null, null,
                0, 1, 0, null, null, null, null, null, null, null, null, null, List.of());
    }

    // ---------------------------------------------------------------- create
    @Test
    void create_withEmployee_derivesOrgDeptFromEmployee() {
        when(orgWebClient.getEmployee(100L)).thenReturn(employee(100L, "20"));
        when(orgWebClient.getDept(20L)).thenReturn(dept("20", "5"));
        when(iamWebClient.createUser(any())).thenReturn(unboundReturn());

        service.create(new UserCreateRequest("alice", "Alice", 100L, null, "139",
                List.of(), "pw", List.of(), List.of(), 10L));

        ArgumentCaptor<Map<String, Object>> body = ArgumentCaptor.forClass(Map.class);
        verify(iamWebClient).createUser(body.capture());
        assertEquals(100L, ((Number) body.getValue().get("employeeId")).longValue());
        assertEquals(List.of(5L), body.getValue().get("orgIds"));
        assertEquals(List.of(20L), body.getValue().get("deptIds"));
    }

    @Test
    void create_withoutEmployee_noBind() {
        when(iamWebClient.createUser(any())).thenReturn(unboundReturn());

        service.create(new UserCreateRequest("bob", "Bob", null, null, "139",
                List.of(), "pw", List.of(), List.of(), 10L));

        verify(orgWebClient, never()).getEmployee(anyLong());
        ArgumentCaptor<Map<String, Object>> body = ArgumentCaptor.forClass(Map.class);
        verify(iamWebClient).createUser(body.capture());
        assertNull(body.getValue().get("employeeId"));
    }

    @Test
    void create_forceBindOn_withoutEmployee_throws() {
        when(systemWebClient.getConfigByKey(FORCE_BIND_KEY))
                .thenReturn(new ConfigVO("1", FORCE_BIND_KEY, "true", null, null, null));

        BusinessException ex = assertThrows(BusinessException.class, () ->
                service.create(new UserCreateRequest("bob", "Bob", null, null, "139",
                        List.of(), "pw", List.of(), List.of(), 10L)));

        assertEquals(ResultCode.VALIDATION_ERROR.getCode(), ex.getCode());
        verify(iamWebClient, never()).createUser(any());
    }

    @Test
    void create_forceBindOn_withEmployee_ok() {
        when(systemWebClient.getConfigByKey(FORCE_BIND_KEY))
                .thenReturn(new ConfigVO("1", FORCE_BIND_KEY, "true", null, null, null));
        when(orgWebClient.getEmployee(100L)).thenReturn(employee(100L, "20"));
        when(orgWebClient.getDept(20L)).thenReturn(dept("20", "5"));
        when(iamWebClient.createUser(any())).thenReturn(unboundReturn());

        service.create(new UserCreateRequest("alice", "Alice", 100L, null, "139",
                List.of(), "pw", List.of(), List.of(), 10L));

        verify(iamWebClient).createUser(any());
    }

    // ---------------------------------------------------------------- update 三态
    @Test
    void update_bindFromUnbound_derivesAndSyncsFromEmployee() {
        // 未绑定现状：employeeId 为 null
        when(iamWebClient.getUser(7L)).thenReturn(new IamUserVO("7", "1", "10", null, "u7", null, 1, 0, 1,
                "Name7", null, null, "135", List.of(), List.of(), List.of(), null, null));
        when(orgWebClient.getEmployee(300L)).thenReturn(employee(300L, "20"));
        when(orgWebClient.getDept(20L)).thenReturn(dept("20", "5"));
        when(iamWebClient.updateUser(eq(7L), any())).thenReturn(unboundReturn());

        service.update(7L, new UserUpdateRequest("u7", 300L, null, null, null, null, null, null, 10L));

        ArgumentCaptor<Map<String, Object>> body = ArgumentCaptor.forClass(Map.class);
        verify(iamWebClient).updateUser(eq(7L), body.capture());
        assertEquals(300L, ((Number) body.getValue().get("employeeId")).longValue());
        assertEquals(List.of(5L), body.getValue().get("orgIds"));
        assertEquals(List.of(20L), body.getValue().get("deptIds"));
        assertEquals("Alice", body.getValue().get("realName"));
        assertEquals("139", body.getValue().get("phone"));
    }

    @Test
    void update_unbind_clearsEmployee() {
        when(iamWebClient.getUser(7L)).thenReturn(boundReturn("100"));
        when(iamWebClient.updateUser(eq(7L), any())).thenReturn(unboundReturn());

        service.update(7L, new UserUpdateRequest("u7", null, null, null, null, null, null, null, 10L));

        ArgumentCaptor<Map<String, Object>> body = ArgumentCaptor.forClass(Map.class);
        verify(iamWebClient).updateUser(eq(7L), body.capture());
        assertNull(body.getValue().get("employeeId"));
    }

    @Test
    void update_unbind_forceBindOn_throws() {
        when(systemWebClient.getConfigByKey(FORCE_BIND_KEY))
                .thenReturn(new ConfigVO("1", FORCE_BIND_KEY, "true", null, null, null));
        when(iamWebClient.getUser(7L)).thenReturn(boundReturn("100"));

        BusinessException ex = assertThrows(BusinessException.class, () ->
                service.update(7L, new UserUpdateRequest("u7", null, null, null, null, null, null, null, 10L)));

        assertEquals(ResultCode.VALIDATION_ERROR.getCode(), ex.getCode());
        verify(iamWebClient, never()).updateUser(eq(7L), any());
    }

    @Test
    void update_forceBindOff_unbindAllowed() {
        when(systemWebClient.getConfigByKey(FORCE_BIND_KEY)).thenReturn(null);
        when(iamWebClient.getUser(7L)).thenReturn(boundReturn("100"));
        when(iamWebClient.updateUser(eq(7L), any())).thenReturn(unboundReturn());

        service.update(7L, new UserUpdateRequest("u7", null, null, null, null, null, null, null, 10L));

        ArgumentCaptor<Map<String, Object>> body = ArgumentCaptor.forClass(Map.class);
        verify(iamWebClient).updateUser(eq(7L), body.capture());
        assertNull(body.getValue().get("employeeId"));
    }

    @Test
    void update_noChange_boundUser_passesExistingEmployeeId() {
        when(systemWebClient.getConfigByKey(FORCE_BIND_KEY)).thenReturn(null);
        when(iamWebClient.getUser(7L)).thenReturn(boundReturn("100"));
        when(iamWebClient.updateUser(eq(7L), any())).thenReturn(unboundReturn());

        service.update(7L, new UserUpdateRequest("u7", 100L, null, null, null, null, null, null, 10L));

        ArgumentCaptor<Map<String, Object>> body = ArgumentCaptor.forClass(Map.class);
        verify(iamWebClient).updateUser(eq(7L), body.capture());
        // 回归：绑定未变更时必须透传现有 employeeId，否则 IAM 会把缺省字段误判为显式解绑
        assertEquals(100L, ((Number) body.getValue().get("employeeId")).longValue());
        verify(orgWebClient, never()).getEmployee(anyLong());
    }

    @Test
    void update_noChange_unbound_passesSelfMaintainedFields() {
        when(systemWebClient.getConfigByKey(FORCE_BIND_KEY)).thenReturn(null);
        when(iamWebClient.getUser(7L)).thenReturn(new IamUserVO("7", "1", "10", null, "u7", null, 1, 0, 1,
                "Name7", null, null, "135", List.of(), List.of(), List.of(), null, null));
        when(iamWebClient.updateUser(eq(7L), any())).thenReturn(unboundReturn());

        service.update(7L, new UserUpdateRequest("u7", null, "NewName", null, "134", null,
                List.of(11L), List.of(22L), 10L));

        ArgumentCaptor<Map<String, Object>> body = ArgumentCaptor.forClass(Map.class);
        verify(iamWebClient).updateUser(eq(7L), body.capture());
        assertEquals("NewName", body.getValue().get("realName"));
        assertEquals("134", body.getValue().get("phone"));
        assertEquals(List.of(11L), body.getValue().get("orgIds"));
        assertEquals(List.of(22L), body.getValue().get("deptIds"));
    }
}
