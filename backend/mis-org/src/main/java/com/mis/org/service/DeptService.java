package com.mis.org.service;

import com.mis.common.core.exception.BusinessException;
import com.mis.common.core.exception.ResultCode;
import com.mis.org.domain.entity.SysDept;
import com.mis.org.domain.repository.SysDeptRepository;
import com.mis.org.domain.repository.SysEmployeeRepository;
import com.mis.org.domain.repository.SysOrgRepository;
import com.mis.org.domain.repository.SysPostRepository;
import com.mis.org.dto.DeptCreateRequest;
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
import java.util.stream.Collectors;

/**
 * 组织内部门树：层级 code（ADR-011/013）与 ancestors 维护。
 */
@Service
public class DeptService {

    private final SysDeptRepository deptRepository;
    private final SysOrgRepository orgRepository;
    private final SysEmployeeRepository employeeRepository;
    private final SysPostRepository postRepository;

    public DeptService(SysDeptRepository deptRepository,
                       SysOrgRepository orgRepository,
                       SysEmployeeRepository employeeRepository,
                       SysPostRepository postRepository) {
        this.deptRepository = deptRepository;
        this.orgRepository = orgRepository;
        this.employeeRepository = employeeRepository;
        this.postRepository = postRepository;
    }

    @Transactional(readOnly = true)
    public List<DeptVO> tree(Long orgId) {
        List<SysDept> all = deptRepository.findByOrgIdAndStatus(orgId, 1);
        Map<Long, List<SysDept>> parentMap = all.stream()
                .collect(Collectors.groupingBy(SysDept::getParentId));
        List<SysDept> roots = parentMap.getOrDefault(0L, List.of());
        return roots.stream()
                .map(d -> toVo(d, parentMap))
                .toList();
    }

    @Transactional(readOnly = true)
    public DeptVO getById(Long id) {
        SysDept dept = deptRepository.findById(id)
                .orElseThrow(() -> new BusinessException(ResultCode.NOT_FOUND, "部门不存在"));
        return toVo(dept, Map.of());
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
        dept.setDeleted(0);
        dept.setCreatedAt(now);
        dept.setUpdatedAt(now);
        deptRepository.save(dept);
        return toVo(dept, Map.of());
    }

    @Transactional
    public DeptVO update(Long id, DeptUpdateRequest request) {
        SysDept dept = deptRepository.findById(id)
                .orElseThrow(() -> new BusinessException(ResultCode.NOT_FOUND, "部门不存在"));
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
        if (request.leaderEmployeeId() != null) {
            dept.setLeaderEmployeeId(request.leaderEmployeeId());
        }

        if (request.parentId() != null && !request.parentId().equals(dept.getParentId())) {
            relocate(dept, request.parentId());
        }

        dept.setUpdatedAt(Instant.now());
        deptRepository.save(dept);
        return toVo(dept, Map.of());
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

    private DeptVO toVo(SysDept dept, Map<Long, List<SysDept>> parentMap) {
        List<DeptVO> children = parentMap.getOrDefault(dept.getId(), List.of()).stream()
                .map(d -> toVo(d, parentMap))
                .toList();
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
                dept.getCreatedAt(),
                dept.getUpdatedAt(),
                children.isEmpty() ? null : children);
    }
}
