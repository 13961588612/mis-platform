package com.mis.kb.domain.service;

import com.mis.common.core.exception.BusinessException;
import com.mis.common.core.exception.ResultCode;
import com.mis.kb.api.dto.KbCategoryCreateRequest;
import com.mis.kb.api.dto.KbCategoryUpdateRequest;
import com.mis.kb.api.dto.KbCategoryVO;
import com.mis.kb.domain.entity.KbCategory;
import com.mis.kb.domain.model.KbResultCode;
import com.mis.kb.domain.repository.KbCategoryRepository;
import com.mis.kb.domain.repository.KbLibraryRepository;
import com.mis.kb.support.IdGenerator;
import com.mis.kb.support.KbBusinessException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

import java.time.Instant;
import java.util.List;

/** 分类服务（C-01~07）。 */
@Service
public class KbCategoryService {

    private final KbCategoryRepository categoryRepository;
    private final KbLibraryRepository libraryRepository;

    public KbCategoryService(KbCategoryRepository categoryRepository, KbLibraryRepository libraryRepository) {
        this.categoryRepository = categoryRepository;
        this.libraryRepository = libraryRepository;
    }

    @Transactional(readOnly = true)
    public List<KbCategoryVO> listAll() {
        return categoryRepository.findAll().stream().map(this::toVo).toList();
    }

    @Transactional
    public KbCategoryVO create(KbCategoryCreateRequest req) {
        Instant now = Instant.now();
        KbCategory entity = new KbCategory();
        entity.setId(IdGenerator.nextId());
        entity.setParentId(req.parentId());
        entity.setName(req.name().trim());
        entity.setEnabled(req.enabled());
        entity.setSort(req.sort() != null ? req.sort() : 0);
        entity.setRemark(trimToNull(req.remark()));
        entity.setCreatedAt(now);
        entity.setUpdatedAt(now);
        return toVo(categoryRepository.save(entity));
    }

    @Transactional
    public KbCategoryVO update(Long id, KbCategoryUpdateRequest req) {
        KbCategory entity = require(id);
        entity.setName(req.name().trim());
        entity.setEnabled(req.enabled());
        if (req.sort() != null) {
            entity.setSort(req.sort());
        }
        entity.setRemark(trimToNull(req.remark()));
        entity.setUpdatedAt(Instant.now());
        return toVo(categoryRepository.save(entity));
    }

    @Transactional
    public void delete(Long id) {
        KbCategory entity = require(id);
        if (categoryRepository.existsByParentId(id) || libraryRepository.existsByCategoryId(id)) {
            throw new KbBusinessException(KbResultCode.KB_CATEGORY_HAS_CHILDREN);
        }
        categoryRepository.delete(entity);
    }

    private KbCategory require(Long id) {
        return categoryRepository.findById(id)
                .orElseThrow(() -> new KbBusinessException(KbResultCode.KB_CATEGORY_NOT_FOUND));
    }

    private KbCategoryVO toVo(KbCategory e) {
        return new KbCategoryVO(
                e.getId(), e.getParentId(), e.getName(), e.getEnabled(),
                e.getSort(), e.getRemark(), e.getCreatedAt(), e.getUpdatedAt());
    }

    private static String trimToNull(String v) {
        return StringUtils.hasText(v) ? v.trim() : null;
    }
}
