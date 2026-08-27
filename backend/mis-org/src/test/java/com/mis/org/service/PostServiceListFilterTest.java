package com.mis.org.service;

import com.mis.org.domain.entity.SysDept;
import com.mis.org.domain.entity.SysOrg;
import com.mis.org.domain.entity.SysPost;
import com.mis.org.domain.entity.SysPostType;
import com.mis.org.domain.repository.SysDeptRepository;
import com.mis.org.domain.repository.SysEmployeePostRepository;
import com.mis.org.domain.repository.SysOrgRepository;
import com.mis.org.domain.repository.SysPostRepository;
import com.mis.org.domain.repository.SysPostTypeRepository;
import com.mis.org.dto.PostVO;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.Collection;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * {@code PostService.list()} 多部门 / 多组织过滤语义回归测试（PRD POST-02/03/04）。
 *
 * <p>守以下契约：
 * <ol>
 *   <li><b>POST-02</b>——{@code deptIds} 多值取<b>并集</b>，单值 {@code deptId} 保留兼容并并入；</li>
 *   <li><b>POST-03</b>——{@code orgIds} 经 {@code SysDeptRepository.findByOrgId} 反查部门集合，
 *       <b>仅精确匹配</b>所选组织（Q7 决策：不含下级组织）；</li>
 *   <li><b>POST-04</b>——{@code orgIds} 反查部门集合与 {@code deptIds} 默认取<b>交集</b>；
 *       交集为空时返回空列表（而非退化为全量）；</li>
 *   <li><b>空集语义</b>——{@code null} 与空 List 一律等同「不约束」；</li>
 *   <li><b>租户隔离</b>——候选集始终来自 {@code findByTenantId(tenantId)}，
 *       跨租户部门 id 无法把别的租户岗位捞出来。</li>
 * </ol>
 *
 * <p>数据布景（组织 → 部门 → 岗位）：
 * <pre>
 *   租户 1：org 10 → dept 101, 102      org 20 → dept 201      org 30 → dept 301
 *           post 1(dept101) 2(dept102) 3(dept201) 4(dept301)
 *   租户 2：dept 999 → post 9（用于租户隔离断言）
 * </pre>
 *
 * <p>R1/R7 回归：list() 现批量预取 dept/org/postType（注册表式 stub 支撑）；
 * OrgNameEnrichment 覆盖 PostVO.orgId/orgName 的填充与脏数据兜底。
 */
@ExtendWith(MockitoExtension.class)
class PostServiceListFilterTest {

    private static final Long TENANT = 1L;
    private static final Long OTHER_TENANT = 2L;

    @Mock
    private SysPostRepository postRepository;
    @Mock
    private SysPostTypeRepository postTypeRepository;
    @Mock
    private SysEmployeePostRepository employeePostRepository;
    @Mock
    private SysDeptRepository deptRepository;
    @Mock
    private SysOrgRepository orgRepository;

    /** 部门注册表：支撑 list() 批量预取 + 单条 toVo 的 findById（脏数据兜底）。 */
    private final Map<Long, SysDept> depts = new HashMap<>();
    /** 岗位类型注册表。 */
    private final Map<Long, SysPostType> types = new HashMap<>();
    /** 组织注册表：支撑 orgId → orgName 解析（R7）。 */
    private final Map<Long, SysOrg> orgs = new HashMap<>();

    private PostService postService;

    @BeforeEach
    void setUp() {
        postService = new PostService(postRepository, postTypeRepository, employeePostRepository, deptRepository, orgRepository);

        // 通用回退 stub：findAllById / findById 从注册表解析（list 批量预取 + 单条 toVo 共用），
        // 避免 Mockito 默认对未 stub 的 List 返回 null 导致 NPE。
        //
        // QA-FIX：必须用 lenient()。MockitoExtension 默认 STRICT_STUBS，会在每个测试结束时校验
        // 「本测试是否用到了每一条 stub」——list() 路径只走 findAllById、getById 路径只走 findById，
        // 两组回退 stub 在对方路径下必然未被调用 → 直接 when(...) 会抛 UnnecessaryStubbingException。
        // 这是 setUp 级「注册表式回退 stub」的固有属性，用 lenient 声明其可选性才是正确写法。
        lenient().when(deptRepository.findAllById(any())).thenAnswer(inv -> {
            Collection<Long> ids = inv.getArgument(0);
            return ids.stream().map(depts::get).filter(Objects::nonNull).toList();
        });
        lenient().when(postTypeRepository.findAllById(any())).thenAnswer(inv -> {
            Collection<Long> ids = inv.getArgument(0);
            return ids.stream().map(types::get).filter(Objects::nonNull).toList();
        });
        lenient().when(orgRepository.findAllById(any())).thenAnswer(inv -> {
            Collection<Long> ids = inv.getArgument(0);
            return ids.stream().map(orgs::get).filter(Objects::nonNull).toList();
        });
        lenient().when(deptRepository.findById(anyLong()))
                .thenAnswer(inv -> Optional.ofNullable(depts.get(inv.getArgument(0))));
        lenient().when(postTypeRepository.findById(anyLong()))
                .thenAnswer(inv -> Optional.ofNullable(types.get(inv.getArgument(0))));
        lenient().when(orgRepository.findById(anyLong()))
                .thenAnswer(inv -> Optional.ofNullable(orgs.get(inv.getArgument(0))));
    }

    // ---------------------------------------------------------------- fixtures

    private static SysPost post(Long id, Long deptId, Long postTypeId, Integer status) {
        SysPost p = new SysPost();
        p.setId(id);
        p.setTenantId(TENANT);
        p.setDeptId(deptId);
        p.setPostTypeId(postTypeId);
        p.setCode("P" + id);
        p.setName("岗位" + id);
        p.setSort(0);
        p.setStatus(status);
        return p;
    }

    private static SysDept dept(Long id, Long orgId) {
        SysDept d = new SysDept();
        d.setId(id);
        d.setOrgId(orgId);
        d.setTenantId(TENANT);
        return d;
    }

    private static SysOrg org(long id, String name) {
        SysOrg o = new SysOrg();
        o.setId(id);
        o.setName(name);
        o.setTenantId(TENANT);
        return o;
    }

    /** 租户 1 的四个岗位：dept 101 / 102 / 201 / 301，全部 status=1、postType=7。 */
    private void givenTenantPosts() {
        when(postRepository.findByTenantId(TENANT)).thenReturn(List.of(
                post(1L, 101L, 7L, 1),
                post(2L, 102L, 7L, 1),
                post(3L, 201L, 7L, 1),
                post(4L, 301L, 7L, 1)));
    }

    /** 断言返回岗位 id 集合（顺序无关）。 */
    private static void assertPostIds(List<PostVO> actual, String... expectedIds) {
        assertEquals(
                new java.util.TreeSet<>(List.of(expectedIds)),
                new java.util.TreeSet<>(actual.stream().map(PostVO::id).toList()),
                () -> "实际返回岗位 id=" + actual.stream().map(PostVO::id).toList());
    }

    // ---------------------------------------------------------------- 无约束

    @Nested
    @DisplayName("空集语义：null / 空 List 等同「不约束」")
    class NoConstraint {

        @Test
        @DisplayName("全部参数为 null → 返回该租户全部岗位")
        void allNullReturnsAll() {
            givenTenantPosts();

            List<PostVO> result = postService.list(TENANT, null, null, null, null, null);

            assertPostIds(result, "1", "2", "3", "4");
        }

        @Test
        @DisplayName("deptIds / orgIds 传空 List → 不约束（不得退化为空结果）")
        void emptyListsAreNoConstraint() {
            givenTenantPosts();

            List<PostVO> result = postService.list(TENANT, null, List.of(), List.of(), null, null);

            assertPostIds(result, "1", "2", "3", "4");
        }
    }

    // ---------------------------------------------------------------- POST-02

    @Nested
    @DisplayName("POST-02 部门多选：deptIds 并集 + 单值 deptId 兼容")
    class DeptFilter {

        @Test
        @DisplayName("单值 deptId 兼容：仅返回该部门岗位")
        void singleDeptIdStillWorks() {
            givenTenantPosts();

            List<PostVO> result = postService.list(TENANT, 101L, null, null, null, null);

            assertPostIds(result, "1");
        }

        @Test
        @DisplayName("deptIds=[101,102] → 两个部门岗位的并集")
        void deptIdsAreUnion() {
            givenTenantPosts();

            List<PostVO> result = postService.list(TENANT, null, List.of(101L, 102L), null, null, null);

            assertPostIds(result, "1", "2");
        }

        @Test
        @DisplayName("deptId 与 deptIds 同时传 → 并集（兼容语义，不互相覆盖）")
        void deptIdAndDeptIdsUnion() {
            givenTenantPosts();

            List<PostVO> result = postService.list(TENANT, 201L, List.of(101L), null, null, null);

            assertPostIds(result, "1", "3");
        }

        @Test
        @DisplayName("deptIds 命中不存在的部门 → 空结果")
        void unknownDeptIdYieldsEmpty() {
            givenTenantPosts();

            List<PostVO> result = postService.list(TENANT, null, List.of(88888L), null, null, null);

            assertTrue(result.isEmpty(), "不存在的部门不应匹配任何岗位");
        }
    }

    // ---------------------------------------------------------------- POST-03

    @Nested
    @DisplayName("POST-03 组织多选：orgIds 经 dept.org_id 反查，仅精确匹配（Q7）")
    class OrgFilter {

        @Test
        @DisplayName("orgIds=[10] → 反查 dept 101/102 → 对应岗位")
        void orgIdReverseLookup() {
            givenTenantPosts();
            when(deptRepository.findByOrgId(10L)).thenReturn(List.of(dept(101L, 10L), dept(102L, 10L)));

            List<PostVO> result = postService.list(TENANT, null, null, List.of(10L), null, null);

            assertPostIds(result, "1", "2");
            verify(deptRepository).findByOrgId(10L);
        }

        @Test
        @DisplayName("orgIds=[10,20] → 多组织反查结果并集")
        void multipleOrgIdsUnion() {
            givenTenantPosts();
            when(deptRepository.findByOrgId(10L)).thenReturn(List.of(dept(101L, 10L), dept(102L, 10L)));
            when(deptRepository.findByOrgId(20L)).thenReturn(List.of(dept(201L, 20L)));

            List<PostVO> result = postService.list(TENANT, null, null, List.of(10L, 20L), null, null);

            assertPostIds(result, "1", "2", "3");
        }

        @Test
        @DisplayName("Q7 精确匹配：选父组织不自动带出子组织部门（findByOrgId 只按精确 org_id）")
        void exactMatchOnlyNoChildOrgs() {
            givenTenantPosts();
            // org 10 是 org 20 的父组织，但 findByOrgId(10) 只返回 org_id=10 的部门
            when(deptRepository.findByOrgId(10L)).thenReturn(List.of(dept(101L, 10L), dept(102L, 10L)));

            List<PostVO> result = postService.list(TENANT, null, null, List.of(10L), null, null);

            assertPostIds(result, "1", "2");
            assertTrue(result.stream().noneMatch(v -> "3".equals(v.id())),
                    "Q7 决策为仅精确匹配：子组织 org20 的 dept201 岗位不应出现");
        }

        @Test
        @DisplayName("组织下无部门 → 空结果（不得退化为全量）")
        void orgWithoutDeptsYieldsEmpty() {
            givenTenantPosts();
            when(deptRepository.findByOrgId(999L)).thenReturn(List.of());

            List<PostVO> result = postService.list(TENANT, null, null, List.of(999L), null, null);

            assertTrue(result.isEmpty(), "组织下无部门时必须返回空，不能变成不约束");
        }
    }

    // ---------------------------------------------------------------- POST-04

    @Nested
    @DisplayName("POST-04 组织 × 部门 默认交集语义")
    class IntersectionSemantics {

        @Test
        @DisplayName("orgIds=[10] ∩ deptIds=[102,201] → 仅 dept102 的岗位")
        void orgAndDeptIntersect() {
            givenTenantPosts();
            when(deptRepository.findByOrgId(10L)).thenReturn(List.of(dept(101L, 10L), dept(102L, 10L)));

            List<PostVO> result = postService.list(TENANT, null, List.of(102L, 201L), List.of(10L), null, null);

            assertPostIds(result, "2");
        }

        @Test
        @DisplayName("交集为空（org20 的部门与 deptIds=[101] 无交集）→ 空结果")
        void emptyIntersectionYieldsEmpty() {
            givenTenantPosts();
            when(deptRepository.findByOrgId(20L)).thenReturn(List.of(dept(201L, 20L)));

            List<PostVO> result = postService.list(TENANT, null, List.of(101L), List.of(20L), null, null);

            assertTrue(result.isEmpty(),
                    "交集为空必须返回空列表；若返回全量说明交集逻辑退化成了「或」");
        }

        @Test
        @DisplayName("交集也覆盖单值 deptId：orgIds=[10] ∩ deptId=201 → 空")
        void intersectionAppliesToSingleDeptId() {
            givenTenantPosts();
            when(deptRepository.findByOrgId(10L)).thenReturn(List.of(dept(101L, 10L), dept(102L, 10L)));

            List<PostVO> result = postService.list(TENANT, 201L, null, List.of(10L), null, null);

            assertTrue(result.isEmpty(), "单值 deptId 也须参与与 orgIds 的交集");
        }
    }

    // ---------------------------------------------------------------- 其它维度

    @Nested
    @DisplayName("既有维度不回归：postTypeId / status")
    class LegacyFilters {

        @Test
        @DisplayName("postTypeId 过滤生效，且与 deptIds 叠加")
        void postTypeFilter() {
            when(postRepository.findByTenantId(TENANT)).thenReturn(List.of(
                    post(1L, 101L, 7L, 1),
                    post(2L, 102L, 8L, 1)));

            List<PostVO> result = postService.list(TENANT, null, List.of(101L, 102L), null, 8L, null);

            assertPostIds(result, "2");
        }

        @Test
        @DisplayName("status 过滤生效（0=禁用不返回）")
        void statusFilter() {
            when(postRepository.findByTenantId(TENANT)).thenReturn(List.of(
                    post(1L, 101L, 7L, 1),
                    post(2L, 102L, 7L, 0)));

            List<PostVO> result = postService.list(TENANT, null, null, null, null, 1);

            assertPostIds(result, "1");
        }
    }

    // ---------------------------------------------------------------- 租户隔离

    @Nested
    @DisplayName("租户隔离：候选集永远来自 findByTenantId(tenantId)")
    class TenantIsolation {

        @Test
        @DisplayName("换租户 → 只查该租户候选集，不返回其它租户岗位")
        void candidateSetIsTenantScoped() {
            SysPost foreign = new SysPost();
            foreign.setId(9L);
            foreign.setTenantId(OTHER_TENANT);
            foreign.setDeptId(999L);
            foreign.setPostTypeId(7L);
            foreign.setCode("P9");
            foreign.setName("岗位9");
            foreign.setStatus(1);
            when(postRepository.findByTenantId(OTHER_TENANT)).thenReturn(List.of(foreign));

            List<PostVO> result = postService.list(OTHER_TENANT, null, null, null, null, null);

            assertPostIds(result, "9");
            verify(postRepository).findByTenantId(OTHER_TENANT);
        }

        @Test
        @DisplayName("即便 orgIds 反查出跨租户部门 id，也捞不到别租户的岗位")
        void crossTenantDeptIdCannotLeakPosts() {
            givenTenantPosts();
            // 构造一个「别租户部门」被反查出来的极端情形
            SysDept foreignDept = new SysDept();
            foreignDept.setId(999L);
            foreignDept.setOrgId(77L);
            foreignDept.setTenantId(OTHER_TENANT);
            when(deptRepository.findByOrgId(77L)).thenReturn(List.of(foreignDept));

            List<PostVO> result = postService.list(TENANT, null, null, List.of(77L), null, null);

            assertTrue(result.isEmpty(),
                    "跨租户部门 id 不应命中本租户候选集，且不得越权返回别租户岗位");
        }
    }

    // ---------------------------------------------------------------- R7：org 透传

    @Nested
    @DisplayName("OrgNameEnrichment：PostVO 携带 orgId / orgName（R1 批量预取 + R7 对称）")
    class OrgNameEnrichment {

        @Test
        @DisplayName("getById 单条：dept.orgId 指向存在 org → 返回 orgId + orgName")
        void getByIdEnrichesOrg() {
            depts.put(101L, dept(101L, 10L));
            orgs.put(10L, org(10L, "组织甲"));
            when(postRepository.findById(1L)).thenReturn(Optional.of(post(1L, 101L, 7L, 1)));

            PostVO vo = postService.getById(1L);

            assertEquals("10", vo.orgId());
            assertEquals("组织甲", vo.orgName());
        }

        @Test
        @DisplayName("list 批量（R1）：每个 PostVO 经预取带 orgId / orgName")
        void listBatchEnrichesOrg() {
            givenTenantPosts();
            depts.put(101L, dept(101L, 10L));
            depts.put(102L, dept(102L, 10L));
            depts.put(201L, dept(201L, 20L));
            depts.put(301L, dept(301L, 30L));
            orgs.put(10L, org(10L, "组织甲"));
            orgs.put(20L, org(20L, "组织乙"));
            orgs.put(30L, org(30L, "组织丙"));

            List<PostVO> result = postService.list(TENANT, null, null, null, null, null);

            assertEquals(4, result.size());
            PostVO p1 = result.stream().filter(v -> "1".equals(v.id())).findFirst().orElseThrow();
            assertEquals("10", p1.orgId());
            assertEquals("组织甲", p1.orgName());
            PostVO p3 = result.stream().filter(v -> "3".equals(v.id())).findFirst().orElseThrow();
            assertEquals("20", p3.orgId());
            assertEquals("组织乙", p3.orgName());
        }

        @Test
        @DisplayName("脏数据：dept.orgId 指向不存在的 org → orgName=null（orgId 仍非空）")
        void dirtyDataOrgMissing() {
            givenTenantPosts();
            depts.put(101L, dept(101L, 10L)); // org 10 未注册 → 视为不存在（脏数据）

            List<PostVO> result = postService.list(TENANT, null, null, null, null, null);
            PostVO p1 = result.stream().filter(v -> "1".equals(v.id())).findFirst().orElseThrow();

            assertEquals("10", p1.orgId());
            assertNull(p1.orgName(), "dept.orgId 指向不存在 org 时 orgName 应为 null");
        }

        @Test
        @DisplayName("脏数据：dept.orgId=null → orgId / orgName 均为 null（与计数 0 语义不同）")
        void deptWithoutOrg() {
            givenTenantPosts();
            depts.put(101L, dept(101L, null)); // orgId 为 null

            List<PostVO> result = postService.list(TENANT, null, null, null, null, null);
            PostVO p1 = result.stream().filter(v -> "1".equals(v.id())).findFirst().orElseThrow();

            assertNull(p1.orgId());
            assertNull(p1.orgName());
        }
    }
}
