package com.mis.org.service;

import com.mis.common.core.exception.BusinessException;
import com.mis.common.core.exception.ResultCode;
import com.mis.org.domain.entity.SysDept;
import com.mis.org.domain.entity.SysPost;
import com.mis.org.domain.entity.SysPostType;
import com.mis.org.domain.repository.SysDeptRepository;
import com.mis.org.domain.repository.SysEmployeePostRepository;
import com.mis.org.domain.repository.SysPostRepository;
import com.mis.org.domain.repository.SysPostTypeRepository;
import com.mis.org.dto.PostCreateRequest;
import com.mis.org.dto.PostTypeVO;
import com.mis.org.dto.PostUpdateRequest;
import com.mis.org.dto.PostVO;
import com.mis.org.support.IdGenerator;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.List;

/**
 * 岗位维护：CRUD + 启停 + 按部门/类型筛选 + 删除引用校验（物理删）。
 */
@Service
public class PostService {

    private final SysPostRepository postRepository;
    private final SysPostTypeRepository postTypeRepository;
    private final SysEmployeePostRepository employeePostRepository;
    private final SysDeptRepository deptRepository;

    public PostService(
            SysPostRepository postRepository,
            SysPostTypeRepository postTypeRepository,
            SysEmployeePostRepository employeePostRepository,
            SysDeptRepository deptRepository) {
        this.postRepository = postRepository;
        this.postTypeRepository = postTypeRepository;
        this.employeePostRepository = employeePostRepository;
        this.deptRepository = deptRepository;
    }

    @Transactional(readOnly = true)
    public List<PostVO> list(Long tenantId, Long deptId, Long postTypeId, Integer status) {
        return postRepository.findByTenantId(tenantId).stream()
                .filter(p -> deptId == null || deptId.equals(p.getDeptId()))
                .filter(p -> postTypeId == null || postTypeId.equals(p.getPostTypeId()))
                .filter(p -> status == null || status.equals(p.getStatus()))
                .map(this::toVo)
                .toList();
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

    @Transactional(readOnly = true)
    public List<PostTypeVO> listTypes(Long tenantId) {
        return postTypeRepository.findByTenantIdAndStatus(tenantId, 1).stream()
                .map(t -> new PostTypeVO(
                        String.valueOf(t.getId()),
                        String.valueOf(t.getTenantId()),
                        t.getCode(),
                        t.getName(),
                        t.getSort(),
                        t.getStatus()))
                .toList();
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
        if (!postTypeRepository.existsById(postTypeId)) {
            throw new BusinessException(ResultCode.NOT_FOUND, "岗位类型不存在");
        }
    }

    private PostVO toVo(SysPost p) {
        String deptName = deptRepository.findById(p.getDeptId()).map(SysDept::getName).orElse(null);
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
                p.getStatus());
    }
}
