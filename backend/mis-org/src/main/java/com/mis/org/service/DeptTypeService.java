package com.mis.org.service;

import com.mis.common.core.exception.BusinessException;
import com.mis.common.core.exception.ResultCode;
import com.mis.org.domain.entity.SysDept;
import com.mis.org.domain.entity.SysDeptType;
import com.mis.org.domain.repository.SysDeptRepository;
import com.mis.org.domain.repository.SysDeptTypeRepository;
import com.mis.org.dto.DeptTypeCreateRequest;
import com.mis.org.dto.DeptTypeTreeNodeVO;
import com.mis.org.dto.DeptTypeUpdateRequest;
import com.mis.org.dto.DeptTypeVO;
import com.mis.org.support.IdGenerator;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * 部门类型：多层化父级树 + 显式 isLeaf（不按子节点推导）+ 防自环。
 * 镜像 PostService 的 type 方法（listTypes / listTypeTree / createType / updateType / deleteType）。
 */
@Service
public class DeptTypeService {

    private final SysDeptTypeRepository deptTypeRepository;
    private final SysDeptRepository deptRepository;

    public DeptTypeService(SysDeptTypeRepository deptTypeRepository, SysDeptRepository deptRepository) {
        this.deptTypeRepository = deptTypeRepository;
        this.deptRepository = deptRepository;
    }

    /**
     * 部门类型全量列表（含禁用）+ 引用计数（referenceCount）。
     *
     * @param tenantId 租户
     * @param status   可选：null=全量；1=仅启用
     */
    @Transactional(readOnly = true)
    public List<DeptTypeVO> listTypes(Long tenantId, Integer status) {
        List<SysDeptType> types = status == null
                ? deptTypeRepository.findByTenantId(tenantId)
                : deptTypeRepository.findByTenantIdAndStatus(tenantId, status);
        if (types.isEmpty()) {
            return List.of();
        }
        Map<Long, Long> refCounts = types.stream()
                .collect(Collectors.toMap(SysDeptType::getId, t -> deptRepository.countByDeptTypeId(t.getId())));
        return types.stream()
                .map(t -> toTypeVo(t, refCounts.getOrDefault(t.getId(), 0L)))
                .toList();
    }

    /**
     * 部门类型树：按 parent_id 递归组装（顶层 parentId=0）。
     *
     * @param tenantId 租户
     * @param status   可选：null=全量；1=仅启用
     */
    @Transactional(readOnly = true)
    public List<DeptTypeTreeNodeVO> listTypeTree(Long tenantId, Integer status) {
        List<SysDeptType> types = status == null
                ? deptTypeRepository.findByTenantId(tenantId)
                : deptTypeRepository.findByTenantIdAndStatus(tenantId, status);
        if (types.isEmpty()) {
            return List.of();
        }
        Map<Long, Long> refCounts = types.stream()
                .collect(Collectors.toMap(SysDeptType::getId, t -> deptRepository.countByDeptTypeId(t.getId())));
        Map<Long, List<SysDeptType>> childrenByParent = types.stream()
                .collect(Collectors.groupingBy(SysDeptType::getParentId));
        return buildTypeTree(childrenByParent, 0L, refCounts);
    }

    private List<DeptTypeTreeNodeVO> buildTypeTree(
            Map<Long, List<SysDeptType>> childrenByParent, Long parentId, Map<Long, Long> refCounts) {
        List<SysDeptType> children = childrenByParent.get(parentId);
        if (children == null) {
            return List.of();
        }
        final Long pid = parentId;
        return children.stream()
                .sorted(Comparator.comparing(SysDeptType::getSort, Comparator.nullsLast(Integer::compareTo)))
                .map(t -> new DeptTypeTreeNodeVO(
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
     * 新增部门类型：code 租户内唯一；parentId 默认 0；isLeaf 显式写入（默认 1）。
     * 挂到非根父级时，父必须已是非末级（分类）；不再推导/回写父 isLeaf。
     */
    @Transactional
    public DeptTypeVO createType(DeptTypeCreateRequest request) {
        deptTypeRepository.findByTenantIdAndCode(request.tenantId(), request.code())
                .ifPresent(t -> {
                    throw new BusinessException(ResultCode.VALIDATION_ERROR, "部门类型编码已存在");
                });
        Long parentId = request.parentId() != null ? request.parentId() : 0L;
        requireParentAllowsChildren(request.tenantId(), parentId);
        int isLeaf = normalizeIsLeaf(request.isLeaf(), 1);

        Instant now = Instant.now();
        SysDeptType type = new SysDeptType();
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
        deptTypeRepository.save(type);
        return toTypeVo(type, 0L);
    }

    /**
     * 编辑部门类型：name/sort/status + 可选 parentId / isLeaf。
     * parentId 变更防环，且新父须为非末级；isLeaf 显式写入，附带有子/有引用约束。
     */
    @Transactional
    public DeptTypeVO updateType(Long id, DeptTypeUpdateRequest request) {
        SysDeptType type = deptTypeRepository.findById(id)
                .orElseThrow(() -> new BusinessException(ResultCode.NOT_FOUND, "部门类型不存在"));

        if (request.parentId() != null) {
            Long newParentId = request.parentId();
            if (newParentId.equals(id)) {
                throw new BusinessException(ResultCode.VALIDATION_ERROR, "部门类型不能挂载到自身");
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
        deptTypeRepository.save(type);

        long refs = deptRepository.countByDeptTypeId(id);
        return toTypeVo(type, refs);
    }

    /**
     * 删除部门类型：仅末级（isLeaf=1）可删；有子节点或被部门引用时硬拦截。不回写父 isLeaf。
     */
    @Transactional
    public void deleteType(Long id) {
        SysDeptType type = deptTypeRepository.findById(id)
                .orElseThrow(() -> new BusinessException(ResultCode.NOT_FOUND, "部门类型不存在"));
        if (type.getIsLeaf() == null || type.getIsLeaf() != 1) {
            throw new BusinessException(ResultCode.VALIDATION_ERROR, "非末级类型不可删除；请先改为末级，或先处理其子类型");
        }
        if (deptTypeRepository.existsByTenantIdAndParentId(type.getTenantId(), id)) {
            throw new BusinessException(ResultCode.VALIDATION_ERROR, "仍存在子类型，不可删除");
        }
        long refs = deptRepository.countByDeptTypeId(id);
        if (refs > 0) {
            throw new BusinessException(409, "部门类型已被 " + refs + " 个部门引用，禁止删除");
        }
        deptTypeRepository.delete(type);
    }

    /** 挂子：父为 0 表示根级；非 0 时父必须存在且 isLeaf=0。 */
    private void requireParentAllowsChildren(Long tenantId, Long parentId) {
        if (parentId == null || parentId == 0) {
            return;
        }
        SysDeptType parent = deptTypeRepository.findById(parentId)
                .orElseThrow(() -> new BusinessException(ResultCode.NOT_FOUND, "上级部门类型不存在"));
        if (!parent.getTenantId().equals(tenantId)) {
            throw new BusinessException(ResultCode.VALIDATION_ERROR, "上级部门类型不属于该租户");
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
        if (deptTypeRepository.existsByTenantIdAndParentId(tenantId, id)) {
            throw new BusinessException(ResultCode.VALIDATION_ERROR, "存在子类型时不可标记为末级，请先删除或移走子类型");
        }
    }

    private void requireCanMarkAsNonLeaf(Long id) {
        long refs = deptRepository.countByDeptTypeId(id);
        if (refs > 0) {
            throw new BusinessException(ResultCode.VALIDATION_ERROR, "已被部门引用的类型不可改为非末级（分类）");
        }
    }

    /**
     * 判断 candidateParentId 是否为 selfId 的子孙（含直接子），用于 updateType 防环。
     */
    private boolean isDescendant(Long tenantId, Long candidateParentId, Long selfId) {
        List<SysDeptType> all = deptTypeRepository.findByTenantId(tenantId);
        Map<Long, List<Long>> childMap = all.stream()
                .collect(Collectors.groupingBy(
                        t -> t.getParentId() != null ? t.getParentId() : 0L,
                        Collectors.mapping(SysDeptType::getId, Collectors.toList())));
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

    private DeptTypeVO toTypeVo(SysDeptType t, long refCount) {
        return new DeptTypeVO(
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
}
