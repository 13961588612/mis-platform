package com.mis.adminbff.service;

import com.mis.adminbff.client.IamWebClient;
import com.mis.adminbff.client.OrgWebClient;
import com.mis.adminbff.client.SystemWebClient;
import com.mis.adminbff.client.model.DeptVO;
import com.mis.adminbff.client.model.EmployeeVO;
import com.mis.adminbff.client.model.IamUserVO;
import com.mis.adminbff.config.BffProperties;
import com.mis.adminbff.dto.UserView;
import com.mis.common.core.result.PageResult;
import com.mis.common.core.result.Result;
import com.mis.common.security.context.LoginUser;
import com.mis.common.security.context.SecurityContextHolder;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.when;

/**
 * GET 用户列表 500 回归：下游 IAM 曾把 null 员工/部门 ID 序列化为字面量 "null" 字符串，
 * 导致 {@code enrich()} 里 {@code Long::valueOf("null")} 抛 NumberFormatException。
 * 修复后应把非数字 ID 视为未绑定，正常返回分页而非 500。
 */
@ExtendWith(MockitoExtension.class)
class UserAggregateServicePageNullIdTest {

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

        lenient().when(properties.getAggregateTimeoutMs()).thenReturn(5000L);
        lenient().when(orgWebClient.orgNames(anyList())).thenReturn(Map.of());
    }

    @Test
    void page_withNullLiteralEmployeeIdAndDeptIds_doesNotThrow500() {
        // 模拟 IAM toVo 的 String.valueOf(null) 脏数据：employeeId / deptIds 为字面量 "null"
        IamUserVO dirty = new IamUserVO("1", "1", "10", "null", "it-tester-001", null, 1, 0, 1,
                null, null, null, null, List.of("null"), List.of("null"), List.of(), null, null);
        when(iamWebClient.pageUsers(anyLong(), any(), any(), any(), any(), any(), any(), any(), anyInt(), anyInt()))
                .thenReturn(PageResult.of(1, 20, 1, List.of(dirty)));

        PageResult<UserView> result = service.page(null, null, null, null, null, null, null, 1, 20);

        assertEquals(1, result.getList().size());
        assertEquals("it-tester-001", result.getList().get(0).username());
        // "null" 字面量被忽略后，用户仍正常渲染，只是不按员工绑定解析
        assertFalse(result.getList().get(0).username().isBlank());
        // 脏 orgIds/deptIds 字面量 "null" 应清洗为空列表，而非 NPE/原样回传
        assertEquals(List.of(), result.getList().get(0).orgIds());
        assertEquals(List.of(), result.getList().get(0).deptIds());
    }

    @Test
    void page_boundUser_echoesPermissionOrgAndDeptIds() {
        // Bug：权限 Sheet 保存组织/部门后，BFF UserView 未透传 IAM orgIds/deptIds，
        // 前端只能回退到员工主组织/主部门，导致「保存成功但重新打开没有」。
        IamUserVO bound = new IamUserVO("7", "1", "10", "100", "u7", null, 1, 0, 1,
                "Name7", null, null, "135",
                List.of("11", "12"), List.of("22", "23"), List.of(), null, null);
        when(iamWebClient.pageUsers(anyLong(), any(), any(), any(), any(), any(), any(), any(), anyInt(), anyInt()))
                .thenReturn(PageResult.of(1, 20, 1, List.of(bound)));

        EmployeeVO emp = new EmployeeVO("100", "1", "20", List.of("20"), "20", "OrgName",
                List.of(), "E100", "Name7", "a@x", "135", 0, "T", null, 1, null, null);
        DeptVO dept = new DeptVO("20", "1", "5", null, "d20", "Dept20", null, null,
                0, 1, 0, null, null, null, null, null, null, null, null, null, List.of());
        when(orgWebClient.getEmployeeMono(100L)).thenReturn(
                reactor.core.publisher.Mono.just(Result.ok(emp)));
        // enrich 会解析员工主部门 20，以及权限 deptIds 22/23；缺失部门用 empty 消化
        when(orgWebClient.getDeptMono(20L)).thenReturn(
                reactor.core.publisher.Mono.just(Result.ok(dept)));
        when(orgWebClient.getDeptMono(22L)).thenReturn(reactor.core.publisher.Mono.empty());
        when(orgWebClient.getDeptMono(23L)).thenReturn(reactor.core.publisher.Mono.empty());
        when(orgWebClient.orgNames(anyList())).thenReturn(Map.of(5L, "Org5"));

        PageResult<UserView> result = service.page(null, null, null, null, null, null, null, 1, 20);

        UserView view = result.getList().get(0);
        // 列表展示仍可派生自员工主部门
        assertEquals("20", view.deptId());
        assertEquals("5", view.orgId());
        // 权限回填必须用 IAM 多选列表，不能被员工主组织覆盖
        assertEquals(List.of("11", "12"), view.orgIds());
        assertEquals(List.of("22", "23"), view.deptIds());
    }
}
