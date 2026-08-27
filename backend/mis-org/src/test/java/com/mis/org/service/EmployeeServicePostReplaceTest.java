package com.mis.org.service;

import com.mis.org.client.OrgIamClient;
import com.mis.org.domain.entity.SysDept;
import com.mis.org.domain.entity.SysEmployee;
import com.mis.org.domain.entity.SysEmployeePost;
import com.mis.org.domain.entity.SysPost;
import com.mis.org.domain.repository.SysDeptRepository;
import com.mis.org.domain.repository.SysEmployeeDeptRepository;
import com.mis.org.domain.repository.SysEmployeePostRepository;
import com.mis.org.domain.repository.SysEmployeeRepository;
import com.mis.org.domain.repository.SysOrgRepository;
import com.mis.org.domain.repository.SysPostRepository;
import com.mis.org.dto.EmployeePostItem;
import com.mis.org.dto.EmployeeUpdateRequest;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InOrder;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.stream.Collectors;
import java.util.stream.StreamSupport;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyCollection;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.when;

/**
 * 任职全量覆盖：delete 必须先 flush 再 saveAll，避免同事务重插原 post_id 撞 uk_emp_post。
 */
@ExtendWith(MockitoExtension.class)
class EmployeeServicePostReplaceTest {

    private static final Long TENANT = 1L;
    private static final Long EMP_ID = 1786958367312L;
    private static final Long DEPT_ID = 1786521729236L;
    private static final Long PRIMARY_POST = 1786947529326L;
    private static final Long SECOND_POST = 1786947529317L;

    @Mock
    private SysEmployeeRepository employeeRepository;
    @Mock
    private SysDeptRepository deptRepository;
    @Mock
    private SysEmployeeDeptRepository employeeDeptRepository;
    @Mock
    private SysEmployeePostRepository employeePostRepository;
    @Mock
    private SysPostRepository postRepository;
    @Mock
    private SysOrgRepository orgRepository;
    @Mock
    private DataScopeService dataScopeService;
    @Mock
    private OrgIamClient orgIamClient;

    private EmployeeService employeeService;

    @BeforeEach
    void setUp() {
        employeeService = new EmployeeService(
                employeeRepository, deptRepository, employeeDeptRepository,
                employeePostRepository, postRepository, orgRepository, dataScopeService, orgIamClient);

        lenient().when(employeeDeptRepository.findActiveDeptIds(anyLong())).thenReturn(List.of(DEPT_ID));
        lenient().when(employeePostRepository.findByEmployeeIdAndStatus(anyLong(), any())).thenReturn(List.of());
        lenient().when(deptRepository.findAllById(anyCollection())).thenReturn(List.of(dept(DEPT_ID)));
        lenient().when(orgRepository.findAllById(anyCollection())).thenReturn(List.of());
        lenient().when(postRepository.findAllById(anyCollection())).thenReturn(List.of(
                post(PRIMARY_POST), post(SECOND_POST)));
        lenient().when(employeeRepository.save(any(SysEmployee.class))).thenAnswer(inv -> inv.getArgument(0));
        lenient().when(employeeDeptRepository.saveAll(anyList())).thenAnswer(inv -> inv.getArgument(0));
        lenient().when(employeePostRepository.saveAll(anyList())).thenAnswer(inv -> inv.getArgument(0));
    }

    @Test
    @DisplayName("保留原主职并加第二岗：delete → flush → saveAll（含原 post_id）")
    void replacePostsFlushesDeleteBeforeReinsert() {
        SysEmployee emp = employee(EMP_ID, DEPT_ID);
        when(employeeRepository.findById(EMP_ID)).thenReturn(Optional.of(emp));
        when(deptRepository.findById(DEPT_ID)).thenReturn(Optional.of(dept(DEPT_ID)));

        EmployeeUpdateRequest request = new EmployeeUpdateRequest(
                "测试",
                null,
                "13900000001",
                1,
                "测试员",
                DEPT_ID,
                List.of(DEPT_ID),
                List.of(
                        new EmployeePostItem(PRIMARY_POST, 1, LocalDate.of(2026, 8, 17)),
                        new EmployeePostItem(SECOND_POST, 0, LocalDate.of(2026, 8, 18))),
                null,
                1,
                0);

        employeeService.update(EMP_ID, request);

        InOrder postOrder = inOrder(employeePostRepository);
        postOrder.verify(employeePostRepository).deleteByEmployeeId(EMP_ID);
        postOrder.verify(employeePostRepository).flush();
        postOrder.verify(employeePostRepository).saveAll(org.mockito.ArgumentMatchers.argThat(rows -> {
            Set<Long> postIds = toPostIds(rows);
            return postIds.equals(Set.of(PRIMARY_POST, SECOND_POST));
        }));

        InOrder deptOrder = inOrder(employeeDeptRepository);
        deptOrder.verify(employeeDeptRepository).deleteByEmployeeId(EMP_ID);
        deptOrder.verify(employeeDeptRepository).flush();
        deptOrder.verify(employeeDeptRepository).saveAll(any());

        assertEquals(DEPT_ID, emp.getDeptId());
    }

    private static Set<Long> toPostIds(Iterable<SysEmployeePost> rows) {
        return StreamSupport.stream(rows.spliterator(), false)
                .map(SysEmployeePost::getPostId)
                .collect(Collectors.toSet());
    }

    private static SysEmployee employee(Long id, Long deptId) {
        SysEmployee e = new SysEmployee();
        e.setId(id);
        e.setTenantId(TENANT);
        e.setDeptId(deptId);
        e.setEmployeeNo("E" + id);
        e.setRealName("测试");
        e.setPhone("13900000001");
        e.setStatus(1);
        e.setIsBuiltin(0);
        e.setCreatedAt(Instant.parse("2026-01-01T00:00:00Z"));
        e.setUpdatedAt(Instant.parse("2026-01-01T00:00:00Z"));
        return e;
    }

    private static SysDept dept(Long id) {
        SysDept d = new SysDept();
        d.setId(id);
        d.setTenantId(TENANT);
        d.setOrgId(1L);
        d.setName("部门");
        d.setStatus(1);
        return d;
    }

    private static SysPost post(Long id) {
        SysPost p = new SysPost();
        p.setId(id);
        p.setTenantId(TENANT);
        p.setDeptId(DEPT_ID);
        p.setName("岗位" + id);
        p.setStatus(1);
        return p;
    }
}
