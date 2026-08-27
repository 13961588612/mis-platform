package com.mis.org.service;

import com.mis.common.core.exception.BusinessException;
import com.mis.common.core.exception.ResultCode;
import com.mis.org.domain.entity.SysDept;
import com.mis.org.domain.entity.SysDeptType;
import com.mis.org.domain.entity.SysOrg;
import com.mis.org.domain.repository.SysDeptRepository;
import com.mis.org.domain.repository.SysDeptTypeRepository;
import com.mis.org.domain.repository.SysEmployeeRepository;
import com.mis.org.domain.repository.SysOrgRepository;
import com.mis.org.domain.repository.SysPostRepository;
import com.mis.org.dto.DeptCreateRequest;
import com.mis.org.dto.DeptPierceVO;
import com.mis.org.dto.DeptUpdateRequest;
import com.mis.org.dto.DeptVO;
import com.mis.org.support.IdGenerator;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * 组织内部门树：层级 code（ADR-011/013）与 ancestors 维护。
 * V40 新增：部门手工对应组织（linked_org_id 穿透锚点）+ 组织穿透只读 forest（pierce）。
 * V54 新增：部门类型（deptTypeId / deptTypeName）+ 部门编制数（establishmentCount）
 *         + 是否末级（isLeaf，后端按「有无子部门」计算，不按前端 children 推导）。
 */
@Service
public class DeptService {

    private final SysDeptRepository deptRepository;
    private final SysDeptTypeRepository deptTypeRepository;
    private final SysOrgRepository orgRepository;
    private final SysEmployeeRepository employeeRepository;
    private final SysPostRepository postRepository;

    public DeptService(SysDeptRepository deptRepository,
                       SysDeptTypeRepository deptTypeRepository,
                       SysOrgRepository orgRepository,
                       SysEmployeeRepository employeeRepository,
                       SysPostRepository postRepository) {
        this.deptRepository = deptRepository;
        this.deptTypeRepository = deptTypeRepository;
        this.orgRepository = orgRepository;
        this.employeeRepository = employeeRepository;
        this.postRepository = postRepository;
    }

    @Transactional(readOnly = true)
    public List<DeptVO> tree(Long orgId) {
        List<SysDept> all = deptRepository.findByOrgIdAndStatus(orgId, 1);
        Map<Long, List<SysDept>> parentMap = all.stream()
                .collect(Collectors.groupingBy(SysDept::getParentId));
        Map<Long, String> orgNames = resolveLinkedOrgNames(all);
        Map<Long, String> deptTypeNameMap = buildDeptTypeNameMap(all);
        List<SysDept> roots = parentMap.getOrDefault(0L, List.of());
        return roots.stream()
                .map(d -> toVoTree(d, parentMap, orgNames, deptTypeNameMap))
                .toList();
    }

    /**
     * V40 组织穿透：返回该组织顶级部门树 forest（每棵子树根带来源组织名徽标）。
     * 只读 GET；懒加载（每层一次请求，下钻复用同端点换 orgId）。
     * 一次取该 org 全部部门 + 一次批量取锚点组织名，避免 N+1。
     */
    @Transactional(readOnly = true)
    public List<DeptPierceVO> pierce(Long orgId) {
        String orgName = orgRepository.findById(orgId)
                .map(SysOrg::getName)
                .orElse(null);
        List<SysDept> all = deptRepository.findByOrgIdAndStatus(orgId, 1);
        Map<Long, List<SysDept>> parentMap = all.stream()
                .collect(Collectors.groupingBy(SysDept::getParentId));
        Map<Long, String> orgNames = resolveLinkedOrgNames(all);
        // V54 一次性批量解析部门类型名（避免 N+1），穿透只读 forest 每层递归透传
        Map<Long, String> deptTypeNameMap = buildDeptTypeNameMap(all);
        List<SysDept> roots = parentMap.getOrDefault(0L, List.of());
        return roots.stream()
                .map(d -> toPierceVo(d, parentMap, orgName, orgNames, deptTypeNameMap))
                .toList();
    }

    @Transactional(readOnly = true)
    public DeptVO getById(Long id) {
        SysDept dept = deptRepository.findById(id)
                .orElseThrow(() -> new BusinessException(ResultCode.NOT_FOUND, "部门不存在"));
        Map<Long, String> orgNames = resolveLinkedOrgNames(List.of(dept));
        Map<Long, String> deptTypeNameMap = buildDeptTypeNameMap(List.of(dept));
        // 是否末级：按「有无子部门」计算（后端真源，前端只读）。
        int isLeaf = deptRepository.existsByOrgIdAndParentId(dept.getOrgId(), dept.getId()) ? 0 : 1;
        return toVoSingle(dept, orgNames, deptTypeNameMap, isLeaf);
    }

    /** 本部门及全部子孙 ID（含自身），供 DataScope。 */
    @Transactional(readOnly = true)
    public List<Long> subtreeIds(Long id) {
        SysDept dept = deptRepository.findById(id)
                .orElseThrow(() -> new BusinessException(ResultCode.NOT_FOUND, "部门不存在"));
        List<Long> ids = new ArrayList<>();
        ids.add(id);
        ids.addAll(deptRepository.findDescendantIds(dept.getOrgId(), String.valueOf(id)));
        return ids;
    }

    @Transactional
    public DeptVO create(DeptCreateRequest request) {
        orgRepository.findById(request.orgId())
                .orElseThrow(() -> new BusinessException(ResultCode.NOT_FOUND, "组织不存在"));

        if (request.parentId() == null || request.parentId() == 0L) {
            throw new BusinessException(ResultCode.VALIDATION_ERROR, "根部门由创建组织时自动生成，不可手工创建");
        }

        SysDept parent = deptRepository.findById(request.parentId())
                .orElseThrow(() -> new BusinessException(ResultCode.NOT_FOUND, "父部门不存在"));
        if (!parent.getOrgId().equals(request.orgId())) {
            throw new BusinessException(ResultCode.VALIDATION_ERROR, "父部门不属于该组织");
        }
        if (!parent.getTenantId().equals(request.tenantId())) {
            throw new BusinessException(ResultCode.VALIDATION_ERROR, "租户与父部门不一致");
        }
        if (parent.getLinkedOrgId() != null) {
            throw new BusinessException(ResultCode.VALIDATION_ERROR, "已关联组织的部门不可再创建子部门");
        }

        validateLinkedOrg(request.tenantId(), request.orgId(), request.linkedOrgId());

        Instant now = Instant.now();
        SysDept dept = new SysDept();
        dept.setId(IdGenerator.nextId());
        dept.setTenantId(request.tenantId());
        dept.setOrgId(request.orgId());
        dept.setParentId(request.parentId());
        dept.setCode(generateCode(request.orgId(), request.parentId(), null));
        dept.setName(request.name());
        dept.setCategoryId(request.categoryId());
        dept.setAncestors(buildAncestors(parent));
        dept.setSort(request.sort() != null ? request.sort() : 0);
        dept.setStatus(1);
        dept.setIsRoot(0);
        dept.setLeaderEmployeeId(request.leaderEmployeeId());
        dept.setLinkedOrgId(request.linkedOrgId());
        // V54 新增：部门类型 + 编制数
        dept.setDeptTypeId(request.deptTypeId());
        dept.setEstablishmentCount(request.establishmentCount() != null ? request.establishmentCount() : 0);
        dept.setDeleted(0);
        dept.setCreatedAt(now);
        dept.setUpdatedAt(now);
        deptRepository.save(dept);
        int isLeaf = deptRepository.existsByOrgIdAndParentId(dept.getOrgId(), dept.getId()) ? 0 : 1;
        return toVoSingle(dept, resolveLinkedOrgNames(List.of(dept)), buildDeptTypeNameMap(List.of(dept)), isLeaf);
    }

    @Transactional
    public DeptVO update(Long id, DeptUpdateRequest request) {
        SysDept dept = deptRepository.findById(id)
                .orElseThrow(() -> new BusinessException(ResultCode.NOT_FOUND, "部门不存在"));

        // V40 更新语义：PUT 总是下发 linkedOrgId（null=清空），先校验再落库
        validateLinkedOrg(dept.getTenantId(), dept.getOrgId(), request.linkedOrgId());
        dept.setLinkedOrgId(request.linkedOrgId());

        // 规则 1.3：根部门（创建组织时自动生成）的名称/状态由所属组织维护，
        // 禁止通过部门自身编辑接口修改。仅当请求试图改变根部门的 name/status 时才拦截，
        // 以免误伤其它字段（如 linkedOrgId）的正常更新；非根部门按原逻辑正常更新。
        boolean isRoot = dept.getIsRoot() != null && dept.getIsRoot() == 1;
        if (isRoot) {
            boolean nameChanged = !Objects.equals(request.name(), dept.getName());
            boolean statusChanged = request.status() != null
                    && !Objects.equals(request.status(), dept.getStatus());
            if (nameChanged || statusChanged) {
                throw new BusinessException(ResultCode.VALIDATION_ERROR,
                        "根部门名称/状态由所属组织维护，不可直接修改（请通过修改对应组织调整）");
            }
            // 不应用 name/status：根部门字段保持与组织一致，由 OrgService.update 同步。
        } else {
            dept.setName(request.name());
            if (request.categoryId() != null) {
                dept.setCategoryId(request.categoryId());
            }
            if (request.sort() != null) {
                dept.setSort(request.sort());
            }
            if (request.status() != null) {
                dept.setStatus(request.status());
            }
        }
        if (request.leaderEmployeeId() != null) {
            dept.setLeaderEmployeeId(request.leaderEmployeeId());
        }
        // V54 新增：部门类型 + 编制数（NULL=不修改）
        if (request.deptTypeId() != null) {
            dept.setDeptTypeId(request.deptTypeId());
        }
        if (request.establishmentCount() != null) {
            dept.setEstablishmentCount(request.establishmentCount());
        }

        if (request.parentId() != null && !request.parentId().equals(dept.getParentId())) {
            relocate(dept, request.parentId());
        }

        dept.setUpdatedAt(Instant.now());
        deptRepository.save(dept);
        int isLeaf = deptRepository.existsByOrgIdAndParentId(dept.getOrgId(), dept.getId()) ? 0 : 1;
        return toVoSingle(dept, resolveLinkedOrgNames(List.of(dept)), buildDeptTypeNameMap(List.of(dept)), isLeaf);
    }

    @Transactional
    public void delete(Long id) {
        SysDept dept = deptRepository.findById(id)
                .orElseThrow(() -> new BusinessException(ResultCode.NOT_FOUND, "部门不存在"));

        if (dept.getIsRoot() != null && dept.getIsRoot() == 1) {
            throw new BusinessException(ResultCode.VALIDATION_ERROR, "根部门不可删除");
        }
        if (deptRepository.existsByOrgIdAndParentId(dept.getOrgId(), id)) {
            throw new BusinessException(ResultCode.DEPT_HAS_CHILDREN);
        }
        if (employeeRepository.existsByDeptId(id)) {
            throw new BusinessException(ResultCode.DEPT_HAS_EMPLOYEES);
        }
        if (postRepository.existsByDeptId(id)) {
            throw new BusinessException(ResultCode.DEPT_HAS_CHILDREN, "部门下存在岗位，无法删除");
        }

        dept.setDeleted(1);
        dept.setUpdatedAt(Instant.now());
        deptRepository.save(dept);
    }

    /**
     * V40 锚点校验：linkedOrgId 非空时必须指向存在的组织、同租户、且 ≠ 部门自身 org_id（拒绝自环）。
     */
    private void validateLinkedOrg(Long tenantId, Long deptOrgId, Long linkedOrgId) {
        if (linkedOrgId == null) {
            return;
        }
        if (linkedOrgId.equals(deptOrgId)) {
            throw new BusinessException(ResultCode.VALIDATION_ERROR, "不能将部门对应到自身所属组织（锚点自环）");
        }
        SysOrg linked = orgRepository.findById(linkedOrgId)
                .orElseThrow(() -> new BusinessException(ResultCode.NOT_FOUND, "对应组织不存在"));
        if (!tenantId.equals(linked.getTenantId())) {
            throw new BusinessException(ResultCode.VALIDATION_ERROR, "对应组织不属于该租户");
        }
    }

    /** 批量解析锚点组织名（一次 findAllById，避免 N+1）。 */
    private Map<Long, String> resolveLinkedOrgNames(List<SysDept> depts) {
        Set<Long> linkedIds = depts.stream()
                .map(SysDept::getLinkedOrgId)
                .filter(Objects::nonNull)
                .collect(Collectors.toSet());
        if (linkedIds.isEmpty()) {
            return Map.of();
        }
        return orgRepository.findAllById(linkedIds).stream()
                .collect(Collectors.toMap(SysOrg::getId, SysOrg::getName, (a, b) -> a));
    }

    /** V54 批量解析部门类型名（一次 findAllById，供 deptTypeName 展示）。 */
    private Map<Long, String> buildDeptTypeNameMap(List<SysDept> depts) {
        Set<Long> typeIds = depts.stream()
                .map(SysDept::getDeptTypeId)
                .filter(Objects::nonNull)
                .collect(Collectors.toSet());
        if (typeIds.isEmpty()) {
            return Map.of();
        }
        return deptTypeRepository.findAllById(typeIds).stream()
                .collect(Collectors.toMap(SysDeptType::getId, SysDeptType::getName, (a, b) -> a));
    }

    private DeptPierceVO toPierceVo(SysDept dept, Map<Long, List<SysDept>> parentMap,
                                    String orgName, Map<Long, String> orgNames,
                                    Map<Long, String> deptTypeNameMap) {
        List<DeptPierceVO> children = parentMap.getOrDefault(dept.getId(), List.of()).stream()
                .map(d -> toPierceVo(d, parentMap, orgName, orgNames, deptTypeNameMap))
                .toList();
        Long linked = dept.getLinkedOrgId();
        // V54 部门类型（穿透只读行同样携带，与 tree 对齐）
        String deptTypeId = dept.getDeptTypeId() != null ? String.valueOf(dept.getDeptTypeId()) : null;
        String deptTypeName = dept.getDeptTypeId() != null ? deptTypeNameMap.get(dept.getDeptTypeId()) : null;
        return new DeptPierceVO(
                String.valueOf(dept.getId()),
                String.valueOf(dept.getOrgId()),
                orgName,
                String.valueOf(dept.getParentId()),
                dept.getCode(),
                dept.getName(),
                deptTypeId,
                deptTypeName,
                dept.getSort(),
                dept.getStatus(),
                dept.getIsRoot(),
                linked != null ? String.valueOf(linked) : null,
                linked != null ? orgNames.get(linked) : null,
                children.isEmpty() ? null : children);
    }

    private void relocate(SysDept dept, Long newParentId) {
        if (dept.getIsRoot() != null && dept.getIsRoot() == 1) {
            throw new BusinessException(ResultCode.VALIDATION_ERROR, "根部门不可移动");
        }
        if (Objects.equals(newParentId, dept.getId())) {
            throw new BusinessException(ResultCode.VALIDATION_ERROR, "不能将部门移动到自身下");
        }
        if (newParentId == 0L) {
            throw new BusinessException(ResultCode.VALIDATION_ERROR, "不能移动为根部门");
        }

        SysDept newParent = deptRepository.findById(newParentId)
                .orElseThrow(() -> new BusinessException(ResultCode.NOT_FOUND, "目标父部门不存在"));
        if (!newParent.getOrgId().equals(dept.getOrgId())) {
            throw new BusinessException(ResultCode.VALIDATION_ERROR, "不能跨组织移动部门");
        }
        if (newParent.getLinkedOrgId() != null) {
            throw new BusinessException(ResultCode.VALIDATION_ERROR, "不能将部门移动到已关联组织的部门下");
        }

        List<Long> descendantIds = deptRepository.findDescendantIds(dept.getOrgId(), String.valueOf(dept.getId()));
        if (descendantIds.contains(newParentId)) {
            throw new BusinessException(ResultCode.VALIDATION_ERROR, "不能将部门移动到其子部门下");
        }

        String oldCode = dept.getCode();
        String newCode = generateCode(dept.getOrgId(), newParentId, dept.getId());
        dept.setParentId(newParentId);
        dept.setAncestors(buildAncestors(newParent));
        dept.setCode(newCode);
        dept.setIsRoot(0);

        if (descendantIds.isEmpty()) {
            return;
        }

        List<SysDept> descendants = deptRepository.findAllById(descendantIds);
        descendants.sort(Comparator.comparingInt(d -> d.getCode() == null ? 0 : d.getCode().length()));
        Instant now = Instant.now();
        for (SysDept child : descendants) {
            String childCode = child.getCode();
            if (childCode != null && childCode.startsWith(oldCode)) {
                child.setCode(newCode + childCode.substring(oldCode.length()));
            }
            child.setAncestors(rebuildAncestors(child.getParentId()));
            child.setUpdatedAt(now);
        }
        deptRepository.saveAll(descendants);
    }

    /**
     * 层级编码：根为 0001；子节点 = 父 code + 同级 4 位序号（ADR-011）。
     */
    String generateCode(Long orgId, Long parentId, Long excludeId) {
        String prefix = "";
        if (parentId != null && parentId != 0L) {
            SysDept parent = deptRepository.findById(parentId)
                    .orElseThrow(() -> new BusinessException(ResultCode.NOT_FOUND, "父部门不存在"));
            prefix = parent.getCode() == null ? "" : parent.getCode();
        }

        List<SysDept> siblings = deptRepository.findByOrgIdAndParentId(orgId, parentId);
        int maxSeq = 0;
        for (SysDept sibling : siblings) {
            if (excludeId != null && excludeId.equals(sibling.getId())) {
                continue;
            }
            String code = sibling.getCode();
            if (code == null) {
                continue;
            }
            String suffix;
            if (prefix.isEmpty()) {
                if (code.length() != 4) {
                    continue;
                }
                suffix = code;
            } else {
                if (!code.startsWith(prefix) || code.length() != prefix.length() + 4) {
                    continue;
                }
                suffix = code.substring(prefix.length());
            }
            try {
                maxSeq = Math.max(maxSeq, Integer.parseInt(suffix));
            } catch (NumberFormatException ignored) {
                // skip malformed
            }
        }
        return prefix + String.format("%04d", maxSeq + 1);
    }

    private String buildAncestors(SysDept parent) {
        return parent.getAncestors() + "," + parent.getId();
    }

    private String rebuildAncestors(Long parentId) {
        if (parentId == null || parentId == 0L) {
            return "0";
        }
        SysDept parent = deptRepository.findById(parentId)
                .orElseThrow(() -> new BusinessException(ResultCode.NOT_FOUND, "父部门不存在"));
        return buildAncestors(parent);
    }

    /** 树递归构造：children 由 parentMap 递归展开；isLeaf 按「有无子部门」计算。 */
    private DeptVO toVoTree(SysDept dept, Map<Long, List<SysDept>> parentMap, Map<Long, String> orgNames,
                            Map<Long, String> deptTypeNameMap) {
        List<DeptVO> children = parentMap.getOrDefault(dept.getId(), List.of()).stream()
                .map(d -> toVoTree(d, parentMap, orgNames, deptTypeNameMap))
                .toList();
        int isLeaf = children.isEmpty() ? 1 : 0;
        return buildVo(dept, orgNames, deptTypeNameMap, isLeaf, children);
    }

    /** 单节点构造（getById / create / update）：无 children；isLeaf 由调用方显式传入。 */
    private DeptVO toVoSingle(SysDept dept, Map<Long, String> orgNames, Map<Long, String> deptTypeNameMap, int isLeaf) {
        return buildVo(dept, orgNames, deptTypeNameMap, isLeaf, List.of());
    }

    private DeptVO buildVo(SysDept dept, Map<Long, String> orgNames, Map<Long, String> deptTypeNameMap,
                           int isLeaf, List<DeptVO> children) {
        Long linked = dept.getLinkedOrgId();
        String deptTypeName = dept.getDeptTypeId() != null ? deptTypeNameMap.get(dept.getDeptTypeId()) : null;
        return new DeptVO(
                String.valueOf(dept.getId()),
                String.valueOf(dept.getTenantId()),
                String.valueOf(dept.getOrgId()),
                String.valueOf(dept.getParentId()),
                dept.getCode(),
                dept.getName(),
                String.valueOf(dept.getCategoryId()),
                dept.getAncestors(),
                dept.getSort(),
                dept.getStatus(),
                dept.getIsRoot(),
                dept.getLeaderEmployeeId() != null ? String.valueOf(dept.getLeaderEmployeeId()) : null,
                linked != null ? String.valueOf(linked) : null,
                linked != null ? orgNames.get(linked) : null,
                dept.getDeptTypeId() != null ? String.valueOf(dept.getDeptTypeId()) : null,
                deptTypeName,
                dept.getEstablishmentCount(),
                isLeaf,
                dept.getCreatedAt(),
                dept.getUpdatedAt(),
                children.isEmpty() ? null : children);
    }
}
