package com.mis.kb.domain.service;

import com.mis.common.core.exception.BusinessException;
import com.mis.common.core.exception.ResultCode;
import com.mis.kb.api.dto.KbCategoryAdminCreateRequest;
import com.mis.kb.api.dto.KbCategoryAdminVO;
import com.mis.kb.domain.entity.KbCategory;
import com.mis.kb.domain.entity.KbCategoryAdmin;
import com.mis.kb.domain.model.KbResultCode;
import com.mis.kb.domain.model.SubjectType;
import com.mis.kb.domain.repository.KbCategoryAdminRepository;
import com.mis.kb.domain.repository.KbCategoryRepository;
import com.mis.kb.support.IdGenerator;
import com.mis.kb.support.KbBusinessException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.List;

/**
 * 分类节点管理员授权服务（知识库域一期，D2）。
 *
 * <p>授权/回收前置校验：<b>谁设置管理员谁须先管该节点</b>（{@code assertNodeManage}，
 * 沿祖先链 + 全局短路）。移除管理员后其名下已建子目录保留、仅失权（O-1）；
 * 删除节点时授权行由 FK CASCADE 级联清理，本服务不负责。
 */
@Service
public class KbCategoryAdminService {

    private final KbCategoryAdminRepository adminRepository;
    private final KbCategoryRepository categoryRepository;
    private final NodeAdminResolver nodeAdminResolver;

    public KbCategoryAdminService(
            KbCategoryAdminRepository adminRepository,
            KbCategoryRepository categoryRepository,
            NodeAdminResolver nodeAdminResolver) {
        this.adminRepository = adminRepository;
        this.categoryRepository = categoryRepository;
        this.nodeAdminResolver = nodeAdminResolver;
    }

    /**
     * 列出某节点的管理员授权；读列表同样需要管理该节点。
     */
    @Transactional(readOnly = true)
    public List<KbCategoryAdminVO> list(Long categoryId, Long userId) {
        requireCategory(categoryId);
        nodeAdminResolver.assertNodeManage(userId, categoryId);
        return adminRepository.findByCategoryId(categoryId).stream().map(this::toVo).toList();
    }

    /**
     * 新增管理员授权（UK 去重）。
     */
    @Transactional
    public KbCategoryAdminVO grant(Long categoryId, KbCategoryAdminCreateRequest req, Long userId) {
        requireCategory(categoryId);
        if (!SubjectType.isValid(req.subjectType())) {
            throw new BusinessException(ResultCode.VALIDATION_ERROR, "主体类型非法（应为 user/role/dept）");
        }
        nodeAdminResolver.assertNodeManage(userId, categoryId);
        if (adminRepository.existsByCategoryIdAndSubjectTypeAndSubjectId(
                categoryId, req.subjectType(), req.subjectId())) {
            throw new KbBusinessException(KbResultCode.KB_CATEGORY_ADMIN_EXISTS);
        }
        Instant now = Instant.now();
        KbCategoryAdmin entity = new KbCategoryAdmin();
        entity.setId(IdGenerator.nextId());
        entity.setCategoryId(categoryId);
        entity.setSubjectType(req.subjectType());
        entity.setSubjectId(req.subjectId());
        entity.setCreatedBy(userId);
        entity.setCreatedAt(now);
        entity.setUpdatedAt(now);
        return toVo(adminRepository.save(entity));
    }

    /**
     * 移除管理员授权；回收者须先管该节点。
     */
    @Transactional
    public void revoke(Long adminId, Long userId) {
        KbCategoryAdmin entity = adminRepository.findById(adminId)
                .orElseThrow(() -> new BusinessException(ResultCode.NOT_FOUND, "分类管理员授权不存在"));
        nodeAdminResolver.assertNodeManage(userId, entity.getCategoryId());
        adminRepository.delete(entity);
    }

    private KbCategory requireCategory(Long categoryId) {
        return categoryRepository.findById(categoryId)
                .orElseThrow(() -> new KbBusinessException(KbResultCode.KB_CATEGORY_NOT_FOUND));
    }

    private KbCategoryAdminVO toVo(KbCategoryAdmin e) {
        return new KbCategoryAdminVO(
                e.getId(), e.getCategoryId(), e.getSubjectType(), e.getSubjectId(),
                e.getCreatedBy(), e.getCreatedAt(), e.getUpdatedAt());
    }
}
