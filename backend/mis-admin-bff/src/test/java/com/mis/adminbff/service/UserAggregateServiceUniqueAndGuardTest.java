package com.mis.adminbff.service;

import com.mis.adminbff.client.IamWebClient;
import com.mis.adminbff.client.OrgWebClient;
import com.mis.adminbff.client.SystemWebClient;
import com.mis.adminbff.client.model.EmployeeVO;
import com.mis.adminbff.client.model.IamUserVO;
import com.mis.adminbff.config.BffProperties;
import com.mis.adminbff.dto.UserCreateRequest;
import com.mis.adminbff.dto.UserUpdateRequest;
import com.mis.common.core.exception.BusinessException;
import com.mis.common.core.exception.ResultCode;
import com.mis.common.core.result.PageResult;
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
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * UserAggregateService 新增约束透传测试（appId 显式透传 / 唯一性透传 / 多 appId 分页）：
 * <ul>
 *   <li>create：使用 request.appId（取代登录态）、唯一性冲突向上透传；</li>
 *   <li>update：透传 appId + email；</li>
 *   <li>page：透传 appIds 列表（空/非空）。</li>
 * </ul>
 * 纯 Mockito 全路径，无 Spring/DB 基座；@BeforeEach 注入租户/APP 登录态供 RequestContext 使用。
 */
@ExtendWith(MockitoExtension.class)
class UserAggregateServiceUniqueAndGuardTest {

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

    private EmployeeVO employeeNoDept(Long id) {
        return new EmployeeVO(String.valueOf(id), "1", null, List.of(), null, null,
                List.of(), "E" + id, "Alice", "a@x", "139", 0, "T", null, 1, null, null);
    }

    // B1) create 使用 request.appId（非登录态 appId）
    @Test
    void create_usesRequestAppIdNotLoginAppId() {
        when(iamWebClient.createUser(any())).thenReturn(unboundReturn());

        service.create(new UserCreateRequest("alice", "Alice", null, null, "139",
                List.of(), "pw", List.of(), List.of(), 20L));

        ArgumentCaptor<Map<String, Object>> body = ArgumentCaptor.forClass(Map.class);
        verify(iamWebClient).createUser(body.capture());
        assertEquals(20L, ((Number) body.getValue().get("appId")).longValue());
    }

    // B2) create 唯一性透传：40918 / 40910
    @Test
    void create_phoneConflict_passthrough40918() {
        when(iamWebClient.createUser(any())).thenThrow(new BusinessException(ResultCode.USER_PHONE_EXISTS));

        BusinessException ex = assertThrows(BusinessException.class, () ->
                service.create(new UserCreateRequest("alice", "Alice", null, null, "139",
                        List.of(), "pw", List.of(), List.of(), 10L)));

        assertEquals(ResultCode.USER_PHONE_EXISTS.getCode(), ex.getCode());
    }

    @Test
    void create_employeeBound_passthrough40910() {
        when(orgWebClient.getEmployee(100L)).thenReturn(employeeNoDept(100L));
        when(iamWebClient.createUser(any())).thenThrow(new BusinessException(ResultCode.EMPLOYEE_ALREADY_BOUND));

        BusinessException ex = assertThrows(BusinessException.class, () ->
                service.create(new UserCreateRequest("alice", "Alice", 100L, null, "139",
                        List.of(), "pw", List.of(), List.of(), 10L)));

        assertEquals(ResultCode.EMPLOYEE_ALREADY_BOUND.getCode(), ex.getCode());
    }

    // B3) update 透传 appId / email
    @Test
    void update_passesThroughAppIdAndEmail() {
        when(iamWebClient.getUser(7L)).thenReturn(unboundReturn());
        when(iamWebClient.updateUser(eq(7L), any())).thenReturn(unboundReturn());

        service.update(7L, new UserUpdateRequest("u7", null, "NewName", "new@x.com", "134",
                null, null, null, 20L));

        ArgumentCaptor<Map<String, Object>> body = ArgumentCaptor.forClass(Map.class);
        verify(iamWebClient).updateUser(eq(7L), body.capture());
        assertEquals(20L, ((Number) body.getValue().get("appId")).longValue());
        assertEquals("new@x.com", body.getValue().get("email"));
        assertEquals("NewName", body.getValue().get("realName"));
        assertEquals("134", body.getValue().get("phone"));
    }

    // B4) page 透传 appIds
    @Test
    void page_passesThroughAppIds() {
        when(iamWebClient.pageUsers(any(), any(), any(), any(), any(), any(), any(), any(), anyInt(), anyInt()))
                .thenReturn(PageResult.of(1, 10, 0L, List.of()));

        service.page(null, null, null, null, null, null, List.of(10L, 20L), 1, 10);

        ArgumentCaptor<List<Long>> appIdsCap = ArgumentCaptor.forClass(List.class);
        verify(iamWebClient).pageUsers(any(), appIdsCap.capture(), any(), any(), any(), any(), any(), any(), anyInt(), anyInt());
        assertEquals(List.of(10L, 20L), appIdsCap.getValue());
    }

    @Test
    void page_emptyAppIds_passesEmptyList() {
        when(iamWebClient.pageUsers(any(), any(), any(), any(), any(), any(), any(), any(), anyInt(), anyInt()))
                .thenReturn(PageResult.of(1, 10, 0L, List.of()));

        service.page(null, null, null, null, null, null, List.of(), 1, 10);

        ArgumentCaptor<List<Long>> appIdsCap = ArgumentCaptor.forClass(List.class);
        verify(iamWebClient).pageUsers(any(), appIdsCap.capture(), any(), any(), any(), any(), any(), any(), anyInt(), anyInt());
        assertEquals(List.of(), appIdsCap.getValue());
    }
}
