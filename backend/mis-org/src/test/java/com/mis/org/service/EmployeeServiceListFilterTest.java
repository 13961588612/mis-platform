package com.mis.org.service;

import com.mis.org.domain.entity.SysDept;
import com.mis.org.domain.entity.SysEmployee;
import com.mis.org.domain.entity.SysEmployeePost;
import com.mis.org.domain.entity.SysOrg;
import com.mis.org.domain.entity.SysPost;
import com.mis.org.domain.repository.SysDeptRepository;
import com.mis.org.domain.repository.SysEmployeeDeptRepository;
import com.mis.org.domain.repository.SysEmployeePostRepository;
import com.mis.org.domain.repository.SysEmployeeRepository;
import com.mis.org.domain.repository.SysOrgRepository;
import com.mis.org.domain.repository.SysPostRepository;
import com.mis.org.client.OrgIamClient;
import com.mis.org.dto.EmployeePostVO;
import com.mis.org.dto.EmployeeVO;
import jakarta.persistence.criteria.CriteriaBuilder;
import jakarta.persistence.criteria.CriteriaQuery;
import jakarta.persistence.criteria.Path;
import jakarta.persistence.criteria.Predicate;
import jakarta.persistence.criteria.Root;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.data.jpa.domain.Specification;

import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyCollection;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import org.mockito.stubbing.Answer;

/**
 * {@code EmployeeService.listAll} 多部门 / 多组织过滤语义 + toVo orgName 回填回归测试。
 *
 * <p>与 {@link PostServiceListFilterTest} 的关键差异：{@code listAll} 的部门过滤不是内存流式过滤，
 * 而是构造 {@link Specification<SysEmployee>}（{@code root.get("deptId").in(allowed)}）交给 Repository。
 * 纯 Mockito 单测无法用真实 JPA 评估 Specification，因此本测试用一个「录制型 CriteriaBuilder」触发 spec
 * 的 {@code toPredicate}，把源代码中构建的 {@code allowed} 部门集合与 tenantId/status/realName 抽取出来，
 * 再对候选集做等价过滤。这样测试的是<b>源代码构造的 spec</b>，而非测试自己重写一遍逻辑（避免双向同源错误）。
 *
 * <p>录制的 root/path/cb 在 {@code setUp} 中一次性创建（避免「在 thenAnswer 内部建桩」导致 STRICT_STUBS
 * 不可靠）。其中 {@code cb} 用 default-answer 拦截所有方法调用，按方法名 + 实参类型把
 * {@code equal/like/in/and} 的实参录制进实例字段（规避 Mockito 对 {@code equal} 等重载方法用 any() 桩时
 * 重载解析不稳定、桩不命中的坑），{@code filterBySpec} 每次调用前重置字段即可。
 *
 * <p>守约（与 POST-02/03/04 对齐）：
 * <ol>
 *   <li>仅 {@code orgIds}——组织经 {@code findByOrgId} 反查部门集合（精确匹配，不含下级组织），结果=该集合；</li>
 *   <li>仅 {@code deptIds}——直接部门集合（并集；单值 deptId 兼容并并入）；</li>
 *   <li>两者都传——默认<b>交集</b>（POST-04）；交集空→空结果；</li>
 *   <li>皆空（null 或空 List）——不过滤部门，返回该租户全部；</li>
 *   <li>toVo orgName——主部门 orgName + 各 post orgName 经批量预取回填；脏数据 dept.orgId=null→orgName=null。</li>
 * </ol>
 */
@ExtendWith(MockitoExtension.class)
class EmployeeServiceListFilterTest {

    private static final Long TENANT = 1L;

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

    /** 部门注册表：支撑 toVo 批量预取 findAllById + findById 回退。 */
    private final Map<Long, SysDept> depts = new HashMap<>();
    /** 组织注册表：支撑 orgId → orgName 解析。 */
    private final Map<Long, SysOrg> orgs = new HashMap<>();
    /** 岗位注册表：支撑 toVo post 批量预取。 */
    private final Map<Long, SysPost> posts = new HashMap<>();
    /** 员工 → 任职部门 id 列表（findActiveDeptIds 回退）。 */
    private final Map<Long, List<Long>> empDeptIds = new HashMap<>();
    /** 员工 → 任职岗位（findByEmployeeIdAndStatus 回退）。 */
    private final Map<Long, List<SysEmployeePost>> empPosts = new HashMap<>();

    /** listAll 的候选集（findAll(spec) 的真实"库表"由本字段提供）。 */
    private List<SysEmployee> master = new ArrayList<>();

    // ---- 录制型 CriteriaBuilder（在 setUp 中创建，避免 thenAnswer 内建栈不可靠）----
    private Root<SysEmployee> root;
    private Path<Object> path;
    private CriteriaBuilder cb;
    private Long recordedTenant;
    private String recordedRealName;
    private Set<Long> recordedAllowed;
    private Integer recordedStatus;

    private EmployeeService employeeService;

    @BeforeEach
    void setUp() {
        employeeService = new EmployeeService(
                employeeRepository, deptRepository, employeeDeptRepository,
                employeePostRepository, postRepository, orgRepository, dataScopeService, orgIamClient);

        // 通用回退 stub（lenient）：toVo 批量预取 + 单条解析从注册表取数，避免默认 null 触发 NPE。
        lenient().when(deptRepository.findAllById(anyCollection())).thenAnswer(inv -> {
            Collection<Long> ids = inv.getArgument(0);
            return ids.stream().map(depts::get).filter(Objects::nonNull).toList();
        });
        lenient().when(orgRepository.findAllById(anyCollection())).thenAnswer(inv -> {
            Collection<Long> ids = inv.getArgument(0);
            return ids.stream().map(orgs::get).filter(Objects::nonNull).toList();
        });
        lenient().when(postRepository.findAllById(anyCollection())).thenAnswer(inv -> {
            Collection<Long> ids = inv.getArgument(0);
            return ids.stream().map(posts::get).filter(Objects::nonNull).toList();
        });
        lenient().when(employeeDeptRepository.findActiveDeptIds(anyLong()))
                .thenAnswer(inv -> empDeptIds.getOrDefault(inv.getArgument(0), List.of()));
        lenient().when(employeePostRepository.findByEmployeeIdAndStatus(anyLong(), any()))
                .thenAnswer(inv -> empPosts.getOrDefault(inv.getArgument(0), List.of()));

        // 录制型 root/path/cb：用 default-answer 录制 spec 的 equal/like/in/and 实参到实例字段，
        // 规避 Mockito 对重载方法（如 cb.equal 的 equal(Expression,Object) / equal(Object,Expression) /
        // equal(Expression,Expression)）用 any()/any(Class) 桩时重载解析不稳定、桩不命中的坑。
        root = mock(Root.class);
        path = mock(Path.class);
        cb = mock(CriteriaBuilder.class, (Answer<Object>) inv -> {
            Class<?> ret = inv.getMethod().getReturnType();
            switch (inv.getMethod().getName()) {
                case "equal": {
                    Object a0 = inv.getArgument(0);
                    Object a1 = inv.getArgument(1);
                    for (Object o : new Object[]{a0, a1}) {
                        if (o instanceof Long l) {
                            recordedTenant = l;
                        } else if (o instanceof Integer i) {
                            recordedStatus = i;
                        }
                    }
                    return mock(Predicate.class);
                }
                case "like":
                    recordedRealName = inv.getArgument(1);
                    return mock(Predicate.class);
                default:
                    return Predicate.class.isAssignableFrom(ret) ? mock(Predicate.class) : null;
            }
        });
        lenient().when(root.get(anyString())).thenReturn(path);
        lenient().when(path.in(anyCollection())).thenAnswer(inv -> {
            recordedAllowed = new HashSet<>((Collection<Long>) inv.getArgument(0));
            return mock(Predicate.class);
        });

        // listAll → 构造 Specification → 触发 toPredicate 录制后等价过滤候选集。
        when(employeeRepository.findAll(any(Specification.class)))
                .thenAnswer(inv -> filterBySpec(inv.getArgument(0), master));
    }

    // -------------------------------------------------------- spec 录制 + 等价过滤

    /**
     * 重置录制字段，触发 spec.toPredicate（把源代码的 allowed/tenantId/status/realName 录进实例字段），
     * 再对候选集做等价内存过滤。验证的是源代码构造出的 spec 内容本身。
     */
    private List<SysEmployee> filterBySpec(Specification<SysEmployee> spec, List<SysEmployee> candidates) {
        recordedTenant = null;
        recordedRealName = null;
        recordedAllowed = null;
        recordedStatus = null;

        spec.toPredicate(root, mock(CriteriaQuery.class), cb);

        final Long tenant = recordedTenant;
        final String realName = recordedRealName;
        final Set<Long> allowed = recordedAllowed;
        final Integer status = recordedStatus;

        final String likeInner = realName == null ? null : realName.substring(1, realName.length() - 1);
        return candidates.stream().filter(e -> {
            if (tenant == null || !tenant.equals(e.getTenantId())) {
                return false;
            }
            if (likeInner != null && (e.getRealName() == null || !e.getRealName().contains(likeInner))) {
                return false;
            }
            if (allowed != null && !allowed.contains(e.getDeptId())) {
                return false;
            }
            return status == null || status.equals(e.getStatus());
        }).toList();
    }

    // -------------------------------------------------------- fixtures

    private static SysEmployee emp(Long id, Long deptId, String realName, Integer status) {
        SysEmployee e = new SysEmployee();
        e.setId(id);
        e.setTenantId(TENANT);
        e.setDeptId(deptId);
        e.setEmployeeNo("E" + id);
        e.setRealName(realName);
        e.setStatus(status);
        return e;
    }

    private static SysDept dept(Long id, Long orgId) {
        SysDept d = new SysDept();
        d.setId(id);
        d.setOrgId(orgId);
        d.setTenantId(TENANT);
        d.setName("部门" + id);
        return d;
    }

    private static SysOrg org(long id, String name) {
        SysOrg o = new SysOrg();
        o.setId(id);
        o.setName(name);
        o.setTenantId(TENANT);
        return o;
    }

    private static SysPost post(long id, String name, Long deptId) {
        SysPost p = new SysPost();
        p.setId(id);
        p.setName(name);
        p.setDeptId(deptId);
        p.setTenantId(TENANT);
        return p;
    }

    private static SysEmployeePost empPost(Long empId, Long postId, Integer isPrimary) {
        SysEmployeePost ep = new SysEmployeePost();
        ep.setId(IdGeneratorReflect.nextId());
        ep.setEmployeeId(empId);
        ep.setPostId(postId);
        ep.setIsPrimary(isPrimary);
        ep.setStatus(1);
        return ep;
    }

    /** 租户 1 四个员工：dept 101 / 102（属 org10）/ 201（属 org20）/ 301（属 org30）。 */
    private void givenTenantEmployees() {
        master = List.of(
                emp(1L, 101L, "张三", 1),
                emp(2L, 102L, "李四", 1),
                emp(3L, 201L, "王五", 1),
                emp(4L, 301L, "赵六", 0));
        // lenient：部分用例仅用 org10（20/30 不被反查），避免 UnnecessaryStubbing。
        lenient().when(deptRepository.findByOrgId(10L)).thenReturn(List.of(dept(101L, 10L), dept(102L, 10L)));
        lenient().when(deptRepository.findByOrgId(20L)).thenReturn(List.of(dept(201L, 20L)));
        lenient().when(deptRepository.findByOrgId(30L)).thenReturn(List.of(dept(301L, 30L)));
    }

    private static void assertEmpIds(List<EmployeeVO> actual, String... expectedIds) {
        assertEquals(
                new java.util.TreeSet<>(List.of(expectedIds)),
                new java.util.TreeSet<>(actual.stream().map(EmployeeVO::id).toList()),
                () -> "实际返回员工 id=" + actual.stream().map(EmployeeVO::id).toList());
    }

    // -------------------------------------------------------- 仅 orgIds

    @Nested
    @DisplayName("仅 orgIds：组织经 findByOrgId 反查部门集合（精确匹配），结果=该集合")
    class OrgOnly {

        @Test
        @DisplayName("orgIds=[10] → 反查 dept 101/102 → 员工 张三/李四")
        void orgIdReverseLookup() {
            givenTenantEmployees();

            List<EmployeeVO> result = employeeService.listAll(TENANT, null, null, null, List.of(10L), null);

            assertEmpIds(result, "1", "2");
        }

        @Test
        @DisplayName("orgIds=[10,20] → 多组织反查并集 → 员工 1/2/3")
        void multipleOrgIdsUnion() {
            givenTenantEmployees();

            List<EmployeeVO> result = employeeService.listAll(TENANT, null, null, null, List.of(10L, 20L), null);

            assertEmpIds(result, "1", "2", "3");
        }

        @Test
        @DisplayName("组织下无部门 → 空结果（不得退化为全量）")
        void orgWithoutDeptsYieldsEmpty() {
            master = List.of(emp(1L, 101L, "张三", 1));
            when(deptRepository.findByOrgId(999L)).thenReturn(List.of());

            List<EmployeeVO> result = employeeService.listAll(TENANT, null, null, null, List.of(999L), null);

            assertTrue(result.isEmpty(), "组织下无部门时必须返回空，不能变成不约束");
        }
    }

    // -------------------------------------------------------- 仅 deptIds

    @Nested
    @DisplayName("仅 deptIds：直接部门集合（并集，单值 deptId 兼容并并入）")
    class DeptOnly {

        @Test
        @DisplayName("单值 deptId 兼容：仅返回该部门员工")
        void singleDeptIdStillWorks() {
            givenTenantEmployees();

            List<EmployeeVO> result = employeeService.listAll(TENANT, null, 101L, null, null, null);

            assertEmpIds(result, "1");
        }

        @Test
        @DisplayName("deptIds=[102,201] → 两部门员工并集")
        void deptIdsAreUnion() {
            givenTenantEmployees();

            List<EmployeeVO> result = employeeService.listAll(TENANT, null, null, List.of(102L, 201L), null, null);

            assertEmpIds(result, "2", "3");
        }

        @Test
        @DisplayName("deptId 与 deptIds 同时传 → 并集（兼容，不互相覆盖）")
        void deptIdAndDeptIdsUnion() {
            givenTenantEmployees();

            List<EmployeeVO> result = employeeService.listAll(TENANT, null, 201L, List.of(101L), null, null);

            assertEmpIds(result, "1", "3");
        }

        @Test
        @DisplayName("deptIds 命中不存在部门 → 空结果")
        void unknownDeptIdYieldsEmpty() {
            givenTenantEmployees();

            List<EmployeeVO> result = employeeService.listAll(TENANT, null, null, List.of(88888L), null, null);

            assertTrue(result.isEmpty(), "不存在部门不应匹配任何员工");
        }
    }

    // -------------------------------------------------------- POST-04 交集

    @Nested
    @DisplayName("POST-04：orgIds 反查部门 ∩ deptIds 默认交集语义")
    class Intersection {

        @Test
        @DisplayName("orgIds=[10] ∩ deptIds=[102,201] → 仅 dept102（员工李四）")
        void orgAndDeptIntersect() {
            givenTenantEmployees();

            List<EmployeeVO> result = employeeService.listAll(TENANT, null, null, List.of(102L, 201L), List.of(10L), null);

            assertEmpIds(result, "2");
        }

        @Test
        @DisplayName("交集为空（org20 的部门与 deptIds=[101] 无交集）→ 空结果")
        void emptyIntersectionYieldsEmpty() {
            givenTenantEmployees();

            List<EmployeeVO> result = employeeService.listAll(TENANT, null, null, List.of(101L), List.of(20L), null);

            assertTrue(result.isEmpty(), "交集为空必须返回空；若返回全量说明退化成了「或」");
        }

        @Test
        @DisplayName("交集也覆盖单值 deptId：orgIds=[10] ∩ deptId=201 → 空")
        void intersectionAppliesToSingleDeptId() {
            givenTenantEmployees();

            List<EmployeeVO> result = employeeService.listAll(TENANT, null, 201L, null, List.of(10L), null);

            assertTrue(result.isEmpty(), "单值 deptId 也要参与与 orgIds 的交集");
        }
    }

    // -------------------------------------------------------- 皆空不过滤

    @Nested
    @DisplayName("皆空：null / 空 List 等同「不约束部门」")
    class NoConstraint {

        @Test
        @DisplayName("全部参数为 null → 返回该租户全部员工（含禁用）")
        void allNullReturnsAll() {
            givenTenantEmployees();

            List<EmployeeVO> result = employeeService.listAll(TENANT, null, null, null, null, null);

            assertEmpIds(result, "1", "2", "3", "4");
        }

        @Test
        @DisplayName("deptIds / orgIds 传空 List → 不约束（不得退化为空结果）")
        void emptyListsAreNoConstraint() {
            givenTenantEmployees();

            List<EmployeeVO> result = employeeService.listAll(TENANT, null, null, List.of(), List.of(), null);

            assertEmpIds(result, "1", "2", "3", "4");
        }
    }

    // -------------------------------------------------------- 其它维度不回归

    @Nested
    @DisplayName("既有维度不回归：realName / status")
    class LegacyFilters {

        @Test
        @DisplayName("realName 模糊匹配生效")
        void realNameFilter() {
            givenTenantEmployees();

            List<EmployeeVO> result = employeeService.listAll(TENANT, "李", null, null, null, null);

            assertEmpIds(result, "2");
        }

        @Test
        @DisplayName("status 过滤生效（0=禁用不返回）")
        void statusFilter() {
            givenTenantEmployees();

            List<EmployeeVO> result = employeeService.listAll(TENANT, null, null, null, null, 1);

            assertEmpIds(result, "1", "2", "3");
        }
    }

    // -------------------------------------------------------- toVo orgName 回填

    @Nested
    @DisplayName("toVo orgName：主部门 + 各 post 经批量预取回填；脏数据兜底")
    class OrgNameEnrichment {

        /** emp1 主部门 101→org10「组织甲」；post 指向 post101(dept102→org20「组织乙」)。 */
        private void givenEmp1WithOrg() {
            master = List.of(emp(1L, 101L, "张三", 1));
            depts.put(101L, dept(101L, 10L));
            depts.put(102L, dept(102L, 20L));
            orgs.put(10L, org(10L, "组织甲"));
            orgs.put(20L, org(20L, "组织乙"));
            posts.put(101L, post(101L, "岗位甲", 102L));
            empDeptIds.put(1L, List.of(101L));
            empPosts.put(1L, List.of(empPost(1L, 101L, 1)));
        }

        @Test
        @DisplayName("主部门 orgName + 任职 post orgName 均回填")
        void primaryAndPostOrgName() {
            givenEmp1WithOrg();

            List<EmployeeVO> result = employeeService.listAll(TENANT, null, null, null, null, null);
            EmployeeVO vo = result.get(0);

            assertEquals("组织甲", vo.orgName(), "主部门 orgName 应来自 emp.deptId→dept→org");
            assertEquals(1, vo.posts().size());
            EmployeePostVO pv = vo.posts().get(0);
            assertEquals("组织乙", pv.orgName(), "任职 post orgName 应来自 post.deptId→dept→org");
        }

        @Test
        @DisplayName("脏数据：主部门 dept.orgId=null → orgName=null（非空对象但字段为 null）")
        void dirtyDataPrimaryDeptNoOrg() {
            master = List.of(emp(1L, 301L, "赵六", 1));
            SysDept dirty = dept(301L, null); // orgId 为 null
            depts.put(301L, dirty);
            empDeptIds.put(1L, List.of(301L));

            List<EmployeeVO> result = employeeService.listAll(TENANT, null, null, null, null, null);
            EmployeeVO vo = result.get(0);

            assertNull(vo.orgName(), "dept.orgId=null 时主部门 orgName 必须为 null");
        }

        @Test
        @DisplayName("脏数据：post 的 dept 非注册表找不到 → post.orgName=null")
        void dirtyDataPostDeptMissing() {
            master = List.of(emp(1L, 101L, "张三", 1));
            depts.put(101L, dept(101L, 10L));
            orgs.put(10L, org(10L, "组织甲"));
            posts.put(999L, post(999L, "孤儿岗位", 777L)); // dept 777 不在 depts 注册表
            empDeptIds.put(1L, List.of(101L));
            empPosts.put(1L, List.of(empPost(1L, 999L, 1)));

            List<EmployeeVO> result = employeeService.listAll(TENANT, null, null, null, null, null);
            EmployeeVO vo = result.get(0);

            assertEquals("组织甲", vo.orgName());
            EmployeePostVO pv = vo.posts().get(0);
            assertNull(pv.orgName(), "post.dept 不在注册表 → 无法解析 orgName，应为 null");
        }

        @Test
        @DisplayName("员工无任职岗位 → posts 为空，主部门 orgName 仍回填")
        void noPostsPrimaryOrgNameStillFilled() {
            master = List.of(emp(1L, 101L, "张三", 1));
            depts.put(101L, dept(101L, 10L));
            orgs.put(10L, org(10L, "组织甲"));
            empDeptIds.put(1L, List.of(101L));
            // 不注册 empPosts → findByEmployeeIdAndStatus 回退空

            List<EmployeeVO> result = employeeService.listAll(TENANT, null, null, null, null, null);
            EmployeeVO vo = result.get(0);

            assertEquals("组织甲", vo.orgName());
            assertTrue(vo.posts().isEmpty(), "无任职岗位时 posts 应为空列表");
        }
    }

    /** 轻量 id 生成（避免依赖生产 IdGenerator，仅用于员工-岗位行 id）。 */
    static final class IdGeneratorReflect {
        private static long seq = 10_000L;

        static long nextId() {
            return seq++;
        }
    }
}
