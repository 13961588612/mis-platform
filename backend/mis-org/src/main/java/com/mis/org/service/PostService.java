package com.mis.org.service;

import com.mis.common.core.exception.BusinessException;
import com.mis.common.core.exception.ResultCode;
import com.mis.org.domain.entity.SysDept;
import com.mis.org.domain.entity.SysOrg;
import com.mis.org.domain.entity.SysPost;
import com.mis.org.domain.entity.SysPostType;
import com.mis.org.domain.repository.SysDeptRepository;
import com.mis.org.domain.repository.SysEmployeePostRepository;
import com.mis.org.domain.repository.SysOrgRepository;
import com.mis.org.domain.repository.SysPostRepository;
import com.mis.org.domain.repository.SysPostTypeRepository;
import com.mis.org.dto.PostCreateRequest;
import com.mis.org.dto.PostTypeCreateRequest;
import com.mis.org.dto.PostTypeTreeNodeVO;
import com.mis.org.dto.PostTypeUpdateRequest;
import com.mis.org.dto.PostTypeVO;
import com.mis.org.dto.PostUpdateRequest;
import com.mis.org.dto.PostVO;
import com.mis.org.support.IdGenerator;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * 岗位维护：CRUD + 启停 + 按部门/类型筛选 + 删除引用校验（物理删）。
 * 岗位类型多层化：父级树 + 显式 isLeaf（不按子节点推导）+ 防自环。
 */
@Service
public class PostService {

    private final SysPostRepository postRepository;
    private final SysPostTypeRepository postTypeRepository;
    private final SysEmployeePostRepository employeePostRepository;
    private final SysDeptRepository deptRepository;
    private final SysOrgRepository orgRepository;

    public PostService(
            SysPostRepository postRepository,
            SysPostTypeRepository postTypeRepository,
            SysEmployeePostRepository employeePostRepository,
            SysDeptRepository deptRepository,
            SysOrgRepository orgRepository) {
        this.postRepository = postRepository;
        this.postTypeRepository = postTypeRepository;
        this.employeePostRepository = employeePostRepository;
        this.deptRepository = deptRepository;
        this.orgRepository = orgRepository;
    }

    /**
     * 岗位列表：按部门 / 类型 / 状态过滤；扩展多部门 {@code deptIds} 与多组织 {@code orgIds}。
     *
     * <p>过滤语义：
     * <ul>
     *   <li>单值 {@code deptId} 保留兼容（与 {@code deptIds} 取并集）；</li>
     *   <li>{@code orgIds} 经 {@code SysDeptRepository.findByOrgId} 反查部门集合；</li>
     *   <li>{@code deptIds} 与组织反查部门集合默认取<b>交集</b>（POST-04 默认语义，Q7 精确匹配）；</li>
     *   <li>{@code postTypeId}/{@code status} 沿用既有流过滤；</li>
     *   <li>tenantId 隔离不变。</li>
     * </ul>
     *
     * <p>R1：过滤后先<b>批量预取</b> dept / org / postType 到 Map，再映射为 VO，消除逐条 {@code toVo} 的 N+1。
     */
    @Transactional(readOnly = true)
    public List<PostVO> list(Long tenantId, Long deptId, List<Long> deptIds, List<Long> orgIds, Long postTypeId, Integer status) {
        // 组织集合 → 部门集合（经 sys_dept.org_id 反查，POST-03 精确匹配所选组织）
        Set<Long> orgDeptIds = null;
        if (orgIds != null && !orgIds.isEmpty()) {
            orgDeptIds = orgIds.stream()
                    .flatMap(orgId -> deptRepository.findByOrgId(orgId).stream())
                    .map(SysDept::getId)
                    .collect(Collectors.toSet());
        }
        // 部门集合：兼容单值 deptId + 多值 deptIds（并集）
        Set<Long> directDeptIds = null;
        if (deptIds != null && !deptIds.isEmpty()) {
            directDeptIds = new HashSet<>(deptIds);
            if (deptId != null) {
                directDeptIds.add(deptId);
            }
        } else if (deptId != null) {
            directDeptIds = Set.of(deptId);
        }
        // POST-04 默认交集：组织反查部门 ∩ 直接部门
        final Set<Long> effectiveDeptIds;
        if (orgDeptIds != null && directDeptIds != null) {
            effectiveDeptIds = orgDeptIds.stream().filter(directDeptIds::contains).collect(Collectors.toSet());
        } else if (orgDeptIds != null) {
            effectiveDeptIds = orgDeptIds;
        } else if (directDeptIds != null) {
            effectiveDeptIds = directDeptIds;
        } else {
            effectiveDeptIds = null;
        }

        final Set<Long> filter = effectiveDeptIds;
        List<SysPost> filtered = postRepository.findByTenantId(tenantId).stream()
                .filter(p -> filter == null || filter.contains(p.getDeptId()))
                .filter(p -> postTypeId == null || postTypeId.equals(p.getPostTypeId()))
                .filter(p -> status == null || status.equals(p.getStatus()))
                .toList();

        // R1：批量预取 dept / org / postType，消除逐条 toVo 的 N+1 查库。
        Set<Long> postDeptIds = filtered.stream().map(SysPost::getDeptId).collect(Collectors.toSet());
        Map<Long, SysDept> deptMap = deptRepository.findAllById(postDeptIds).stream()
                .collect(Collectors.toMap(SysDept::getId, d -> d, (a, b) -> a));
        Set<Long> orgIdsSet = deptMap.values().stream()
                .map(SysDept::getOrgId)
                .filter(Objects::nonNull)
                .collect(Collectors.toSet());
        Map<Long, SysOrg> orgMap = orgRepository.findAllById(orgIdsSet).stream()
                .collect(Collectors.toMap(SysOrg::getId, o -> o, (a, b) -> a));
        Set<Long> typeIds = filtered.stream().map(SysPost::getPostTypeId).collect(Collectors.toSet());
        Map<Long, SysPostType> typeMap = postTypeRepository.findAllById(typeIds).stream()
                .collect(Collectors.toMap(SysPostType::getId, t -> t, (a, b) -> a));

        return filtered.stream().map(p -> toVo(p, deptMap, orgMap, typeMap)).toList();
    }

    @Transactional(readOnly = true)
    public PostVO getById(Long id) {
        return toVo(requirePost(id));
    }

    @Transactional
    public PostVO create(PostCreateRequest request) {
        if (postRepository.existsByTenantIdAndCode(request.tenantId(), request.code().trim())) {
            throw new BusinessException(ResultCode.VALIDATION_ERROR, "岗位编码已存在");
        }
        requireDept(request.tenantId(), request.deptId());
        requirePostType(request.postTypeId());

        Instant now = Instant.now();
        SysPost post = new SysPost();
        post.setId(IdGenerator.nextId());
        post.setTenantId(request.tenantId());
        post.setDeptId(request.deptId());
        post.setPostTypeId(request.postTypeId());
        post.setCode(request.code().trim());
        post.setName(request.name().trim());
        post.setSort(request.sort() != null ? request.sort() : 0);
        post.setStatus(request.status() != null ? request.status() : 1);
        post.setQuota(request.quota() != null ? request.quota() : 0);
        post.setDeleted(0);
        post.setCreatedAt(now);
        post.setUpdatedAt(now);
        return toVo(postRepository.save(post));
    }

    @Transactional
    public PostVO update(Long id, PostUpdateRequest request) {
        SysPost post = requirePost(id);
        if (postRepository.existsByTenantIdAndCodeAndIdNot(post.getTenantId(), request.code().trim(), id)) {
            throw new BusinessException(ResultCode.VALIDATION_ERROR, "岗位编码已存在");
        }
        requireDept(post.getTenantId(), request.deptId());
        requirePostType(request.postTypeId());

        post.setDeptId(request.deptId());
        post.setPostTypeId(request.postTypeId());
        post.setCode(request.code().trim());
        post.setName(request.name().trim());
        if (request.sort() != null) {
            post.setSort(request.sort());
        }
        if (request.status() != null) {
            post.setStatus(request.status());
        }
        if (request.quota() != null) {
            post.setQuota(request.quota());
        }
        post.setUpdatedAt(Instant.now());
        return toVo(postRepository.save(post));
    }

    /**
     * 物理删除；岗位仍被员工任职引用（sys_employee_post.status=1）时拒绝。
     */
    @Transactional
    public void delete(Long id) {
        requirePost(id);
        long refs = employeePostRepository.countByPostIdAndStatus(id, 1);
        if (refs > 0) {
            throw new BusinessException(ResultCode.VALIDATION_ERROR, "岗位已被员工任职引用，禁止删除");
        }
        postRepository.deleteById(id);
    }

    /**
     * V40 岗位类型全量列表（含禁用）+ 引用计数（referenceCount）。
     *
     * @param tenantId 租户
     * @param status   可选：null=全量；1=仅启用
     */
    @Transactional(readOnly = true)
    public List<PostTypeVO> listTypes(Long tenantId, Integer status) {
        List<SysPostType> types = status == null
                ? postTypeRepository.findByTenantId(tenantId)
                : postTypeRepository.findByTenantIdAndStatus(tenantId, status);
        if (types.isEmpty()) {
            return List.of();
        }
        Map<Long, Long> refCounts = types.stream()
                .collect(Collectors.toMap(SysPostType::getId, t -> postRepository.countByPostTypeId(t.getId())));
        return types.stream()
                .map(t -> toTypeVo(t, refCounts.getOrDefault(t.getId(), 0L)))
                .toList();
    }

    /**
     * V47 岗位类型树：按 parent_id 递归组装（顶层 parentId=0）。
     *
     * @param tenantId 租户
     * @param status   可选：null=全量；1=仅启用
     */
    @Transactional(readOnly = true)
    public List<PostTypeTreeNodeVO> listTypeTree(Long tenantId, Integer status) {
        List<SysPostType> types = status == null
                ? postTypeRepository.findByTenantId(tenantId)
                : postTypeRepository.findByTenantIdAndStatus(tenantId, status);
        if (types.isEmpty()) {
            return List.of();
        }
        Map<Long, Long> refCounts = types.stream()
                .collect(Collectors.toMap(SysPostType::getId, t -> postRepository.countByPostTypeId(t.getId())));
        Map<Long, List<SysPostType>> childrenByParent = types.stream()
                .collect(Collectors.groupingBy(SysPostType::getParentId));
        return buildTypeTree(childrenByParent, 0L, refCounts);
    }

    private List<PostTypeTreeNodeVO> buildTypeTree(
            Map<Long, List<SysPostType>> childrenByParent, Long parentId, Map<Long, Long> refCounts) {
        List<SysPostType> children = childrenByParent.get(parentId);
        if (children == null) {
            return List.of();
        }
        final Long pid = parentId;
        return children.stream()
                .sorted(Comparator.comparing(SysPostType::getSort, Comparator.nullsLast(Integer::compareTo)))
                .map(t -> new PostTypeTreeNodeVO(
                        String.valueOf(t.getId()),
                        t.getCode(),
                        t.getName(),
                        t.getSort(),
                        t.getStatus(),
                        t.getIsLeaf(),
                        Math.toIntExact(refCounts.getOrDefault(t.getId(), 0L)),
                        String.valueOf(t.getParentId() != null ? t.getParentId() : 0L),
                        buildTypeTree(childrenByParent, t.getId(), refCounts)))
                .toList();
    }

    /**
     * 新增岗位类型：code 租户内唯一；parentId 默认 0；isLeaf 显式写入（默认 1）。
     * 挂到非根父级时，父必须已是非末级（分类）；不再推导/回写父 isLeaf。
     */
    @Transactional
    public PostTypeVO createType(PostTypeCreateRequest request) {
        postTypeRepository.findByTenantIdAndCode(request.tenantId(), request.code())
                .ifPresent(t -> {
                    throw new BusinessException(ResultCode.VALIDATION_ERROR, "岗位类型编码已存在");
                });
        Long parentId = request.parentId() != null ? request.parentId() : 0L;
        requireParentAllowsChildren(request.tenantId(), parentId);
        int isLeaf = normalizeIsLeaf(request.isLeaf(), 1);

        Instant now = Instant.now();
        SysPostType type = new SysPostType();
        type.setId(IdGenerator.nextId());
        type.setTenantId(request.tenantId());
        type.setCode(request.code().trim());
        type.setName(request.name().trim());
        type.setSort(request.sort() != null ? request.sort() : 0);
        type.setStatus(request.status() != null ? request.status() : 1);
        type.setParentId(parentId);
        type.setIsLeaf(isLeaf);
        type.setCreatedAt(now);
        type.setUpdatedAt(now);
        postTypeRepository.save(type);
        return toTypeVo(type, 0L);
    }

    /**
     * 编辑岗位类型：name/sort/status + 可选 parentId / isLeaf。
     * parentId 变更防环，且新父须为非末级；isLeaf 显式写入，附带有子/有引用约束。
     */
    @Transactional
    public PostTypeVO updateType(Long id, PostTypeUpdateRequest request) {
        SysPostType type = postTypeRepository.findById(id)
                .orElseThrow(() -> new BusinessException(ResultCode.NOT_FOUND, "岗位类型不存在"));

        if (request.parentId() != null) {
            Long newParentId = request.parentId();
            if (newParentId.equals(id)) {
                throw new BusinessException(ResultCode.VALIDATION_ERROR, "岗位类型不能挂载到自身");
            }
            if (newParentId != 0 && isDescendant(type.getTenantId(), newParentId, id)) {
                throw new BusinessException(ResultCode.VALIDATION_ERROR, "不能挂载到自身的下级类型（防循环）");
            }
            requireParentAllowsChildren(type.getTenantId(), newParentId);
            type.setParentId(newParentId);
        }

        type.setName(request.name().trim());
        if (request.sort() != null) {
            type.setSort(request.sort());
        }
        if (request.status() != null) {
            type.setStatus(request.status());
        }
        if (request.isLeaf() != null) {
            int isLeaf = normalizeIsLeaf(request.isLeaf(), type.getIsLeaf() != null ? type.getIsLeaf() : 1);
            if (isLeaf == 1) {
                requireCanMarkAsLeaf(type.getTenantId(), id);
            } else {
                requireCanMarkAsNonLeaf(id);
            }
            type.setIsLeaf(isLeaf);
        }
        type.setUpdatedAt(Instant.now());
        postTypeRepository.save(type);

        long refs = postRepository.countByPostTypeId(id);
        return toTypeVo(type, refs);
    }

    /**
     * 删除岗位类型：仅末级（isLeaf=1）可删；有子节点或被岗位引用时硬拦截。不回写父 isLeaf。
     */
    @Transactional
    public void deleteType(Long id) {
        SysPostType type = postTypeRepository.findById(id)
                .orElseThrow(() -> new BusinessException(ResultCode.NOT_FOUND, "岗位类型不存在"));
        if (type.getIsLeaf() == null || type.getIsLeaf() != 1) {
            throw new BusinessException(ResultCode.VALIDATION_ERROR, "非末级类型不可删除；请先改为末级，或先处理其子类型");
        }
        if (postTypeRepository.existsByTenantIdAndParentId(type.getTenantId(), id)) {
            throw new BusinessException(ResultCode.VALIDATION_ERROR, "仍存在子类型，不可删除");
        }
        long refs = postRepository.countByPostTypeId(id);
        if (refs > 0) {
            throw new BusinessException(409, "岗位类型已被 " + refs + " 个岗位引用，禁止删除");
        }
        postTypeRepository.delete(type);
    }

    /** 挂子：父为 0 表示根级；非 0 时父必须存在且 isLeaf=0。 */
    private void requireParentAllowsChildren(Long tenantId, Long parentId) {
        if (parentId == null || parentId == 0) {
            return;
        }
        SysPostType parent = postTypeRepository.findById(parentId)
                .orElseThrow(() -> new BusinessException(ResultCode.NOT_FOUND, "上级岗位类型不存在"));
        if (!parent.getTenantId().equals(tenantId)) {
            throw new BusinessException(ResultCode.VALIDATION_ERROR, "上级岗位类型不属于该租户");
        }
        if (parent.getIsLeaf() == null || parent.getIsLeaf() != 0) {
            throw new BusinessException(ResultCode.VALIDATION_ERROR, "仅非末级（分类）类型下可增加子类型");
        }
    }

    private int normalizeIsLeaf(Integer isLeaf, int defaultValue) {
        if (isLeaf == null) {
            return defaultValue;
        }
        if (isLeaf != 0 && isLeaf != 1) {
            throw new BusinessException(ResultCode.VALIDATION_ERROR, "isLeaf 仅允许 0 或 1");
        }
        return isLeaf;
    }

    private void requireCanMarkAsLeaf(Long tenantId, Long id) {
        if (postTypeRepository.existsByTenantIdAndParentId(tenantId, id)) {
            throw new BusinessException(ResultCode.VALIDATION_ERROR, "存在子类型时不可标记为末级，请先删除或移走子类型");
        }
    }

    private void requireCanMarkAsNonLeaf(Long id) {
        long refs = postRepository.countByPostTypeId(id);
        if (refs > 0) {
            throw new BusinessException(ResultCode.VALIDATION_ERROR, "已被岗位引用的类型不可改为非末级（分类）");
        }
    }

    /**
     * 判断 candidateParentId 是否为 selfId 的子孙（含直接子），用于 updateType 防环。
     */
    private boolean isDescendant(Long tenantId, Long candidateParentId, Long selfId) {
        List<SysPostType> all = postTypeRepository.findByTenantId(tenantId);
        Map<Long, List<Long>> childMap = all.stream()
                .collect(Collectors.groupingBy(
                        t -> t.getParentId() != null ? t.getParentId() : 0L,
                        Collectors.mapping(SysPostType::getId, Collectors.toList())));
        Set<Long> visited = new HashSet<>();
        List<Long> stack = new ArrayList<>(childMap.getOrDefault(selfId, List.of()));
        while (!stack.isEmpty()) {
            Long cur = stack.remove(stack.size() - 1);
            if (cur.equals(candidateParentId)) {
                return true;
            }
            if (visited.add(cur)) {
                stack.addAll(childMap.getOrDefault(cur, List.of()));
            }
        }
        return false;
    }

    private PostTypeVO toTypeVo(SysPostType t, long refCount) {
        return new PostTypeVO(
                String.valueOf(t.getId()),
                String.valueOf(t.getTenantId()),
                t.getCode(),
                t.getName(),
                t.getSort(),
                t.getStatus(),
                Math.toIntExact(refCount),
                String.valueOf(t.getParentId() != null ? t.getParentId() : 0L),
                t.getIsLeaf() != null ? t.getIsLeaf() : 1);
    }

    private SysPost requirePost(Long id) {
        return postRepository.findById(id)
                .orElseThrow(() -> new BusinessException(ResultCode.NOT_FOUND, "岗位不存在"));
    }

    private void requireDept(Long tenantId, Long deptId) {
        SysDept dept = deptRepository.findById(deptId)
                .orElseThrow(() -> new BusinessException(ResultCode.NOT_FOUND, "部门不存在"));
        if (!tenantId.equals(dept.getTenantId())) {
            throw new BusinessException(ResultCode.VALIDATION_ERROR, "部门不属于该租户");
        }
        if (dept.getStatus() != null && dept.getStatus() == 0) {
            throw new BusinessException(ResultCode.VALIDATION_ERROR, "部门已禁用");
        }
    }

    private void requirePostType(Long postTypeId) {
        SysPostType type = postTypeRepository.findById(postTypeId)
                .orElseThrow(() -> new BusinessException(ResultCode.NOT_FOUND, "岗位类型不存在"));
        if (type.getIsLeaf() == null || type.getIsLeaf() != 1) {
            throw new BusinessException(ResultCode.VALIDATION_ERROR, "岗位只能选用末级类型");
        }
    }

    /**
     * 单条 toVo（getById / create / update 调用；调用点不动）：逐条补 org 解析。
     */
    private PostVO toVo(SysPost p) {
        SysDept dept = deptRepository.findById(p.getDeptId()).orElse(null);
        String deptName = dept != null ? dept.getName() : null;
        String orgId = null;
        String orgName = null;
        if (dept != null && dept.getOrgId() != null) {
            orgId = String.valueOf(dept.getOrgId());
            orgName = orgRepository.findById(dept.getOrgId()).map(SysOrg::getName).orElse(null);
        }
        String postTypeName = postTypeRepository.findById(p.getPostTypeId())
                .map(SysPostType::getName)
                .orElse(null);
        return new PostVO(
                String.valueOf(p.getId()),
                String.valueOf(p.getTenantId()),
                String.valueOf(p.getDeptId()),
                deptName,
                String.valueOf(p.getPostTypeId()),
                postTypeName,
                p.getCode(),
                p.getName(),
                p.getSort(),
                p.getStatus(),
                p.getQuota(),
                orgId,
                orgName);
    }

    /**
     * 批量预取版 toVo（R1）：从已加载的 deptMap / orgMap / typeMap 取名称，避免逐条查库。
     *
     * @param p       岗位
     * @param deptMap 部门 id → 部门（批量预取）
     * @param orgMap  组织 id → 组织（批量预取）
     * @param typeMap 岗位类型 id → 类型（批量预取）
     */
    private PostVO toVo(SysPost p, Map<Long, SysDept> deptMap, Map<Long, SysOrg> orgMap, Map<Long, SysPostType> typeMap) {
        SysDept dept = deptMap.get(p.getDeptId());
        String deptName = dept != null ? dept.getName() : null;
        String orgId = null;
        String orgName = null;
        if (dept != null && dept.getOrgId() != null) {
            orgId = String.valueOf(dept.getOrgId());
            SysOrg org = orgMap.get(dept.getOrgId());
            // 脏数据：dept.orgId 指向不存在 org 时 orgName 为 null（与计数 0 语义不同，R5）。
            orgName = org != null ? org.getName() : null;
        }
        SysPostType type = typeMap.get(p.getPostTypeId());
        String postTypeName = type != null ? type.getName() : null;
        return new PostVO(
                String.valueOf(p.getId()),
                String.valueOf(p.getTenantId()),
                String.valueOf(p.getDeptId()),
                deptName,
                String.valueOf(p.getPostTypeId()),
                postTypeName,
                p.getCode(),
                p.getName(),
                p.getSort(),
                p.getStatus(),
                p.getQuota(),
                orgId,
                orgName);
    }
}
