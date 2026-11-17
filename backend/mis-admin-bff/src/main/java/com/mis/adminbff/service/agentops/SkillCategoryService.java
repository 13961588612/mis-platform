package com.mis.adminbff.service.agentops;

import com.mis.adminbff.dto.agentops.SkillCategoryBindRequest;
import com.mis.adminbff.dto.agentops.SkillCategorySaveRequest;
import com.mis.adminbff.dto.agentops.SkillCategoryTreeVO;
import com.mis.adminbff.dto.agentops.SkillCategoryVO;
import com.mis.common.core.exception.BusinessException;
import com.mis.common.core.exception.ResultCode;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 技能池分类树（平台库 {@code ai_skill_category}），与 ai-platform {@code Skill.category} 解耦。
 */
@Service
public class SkillCategoryService {

    private final SkillCategoryRepository repository;

    public SkillCategoryService(SkillCategoryRepository repository) {
        this.repository = repository;
    }

    @Transactional(readOnly = true)
    public SkillCategoryTreeVO tree() {
        return new SkillCategoryTreeVO(SkillCategoryTrees.build(repository.findAll()), repository.findBinds());
    }

    @Transactional
    public SkillCategoryVO create(SkillCategorySaveRequest dto) {
        String name = dto.name().trim();
        long parentId = normalizeParent(dto.parentId());
        assertParentExists(parentId);
        if (SkillCategoryTrees.wouldCycle(repository.parentById(), null, parentId)) {
            throw new BusinessException(ResultCode.VALIDATION_ERROR, "不能把分类挂到自己的子孙下");
        }
        int sort = dto.sortOrder() == null ? 0 : dto.sortOrder();
        long id = repository.insert(parentId, name, sort);
        return repository.findById(id).orElseThrow();
    }

    @Transactional
    public SkillCategoryVO update(long id, SkillCategorySaveRequest dto) {
        SkillCategoryVO existing = repository.findById(id)
                .orElseThrow(() -> new BusinessException(ResultCode.NOT_FOUND, "分类不存在"));
        String name = dto.name().trim();
        long parentId = dto.parentId() == null ? existing.getParentId() : normalizeParent(dto.parentId());
        assertParentExists(parentId);
        if (SkillCategoryTrees.wouldCycle(repository.parentById(), id, parentId)) {
            throw new BusinessException(ResultCode.VALIDATION_ERROR, "不能把分类挂到自己的子孙下");
        }
        int sort = dto.sortOrder() == null ? existing.getSortOrder() : dto.sortOrder();
        repository.update(id, parentId, name, sort);
        return repository.findById(id).orElseThrow();
    }

    @Transactional
    public void delete(long id) {
        repository.findById(id).orElseThrow(() -> new BusinessException(ResultCode.NOT_FOUND, "分类不存在"));
        if (repository.existsChildren(id)) {
            throw new BusinessException(ResultCode.VALIDATION_ERROR, "存在子分类，无法删除");
        }
        if (repository.existsBinds(id)) {
            throw new BusinessException(ResultCode.VALIDATION_ERROR, "分类下仍有技能，无法删除");
        }
        repository.delete(id);
    }

    @Transactional
    public void bind(String skillId, SkillCategoryBindRequest request) {
        if (skillId == null || skillId.isBlank()) {
            throw new BusinessException(ResultCode.VALIDATION_ERROR, "技能 ID 不能为空");
        }
        Long categoryId = request == null ? null : request.categoryId();
        if (categoryId == null || categoryId <= 0) {
            repository.deleteBind(skillId.trim());
            return;
        }
        repository.findById(categoryId)
                .orElseThrow(() -> new BusinessException(ResultCode.NOT_FOUND, "分类不存在"));
        repository.upsertBind(skillId.trim(), categoryId);
    }

    /** 技能删除后去掉绑定，避免孤儿。 */
    @Transactional
    public void unbindSkill(String skillId) {
        if (skillId == null || skillId.isBlank()) {
            return;
        }
        repository.deleteBind(skillId.trim());
    }

    private static long normalizeParent(Long parentId) {
        if (parentId == null || parentId < 0) {
            return SkillCategoryTrees.ROOT_PARENT_ID;
        }
        return parentId;
    }

    private void assertParentExists(long parentId) {
        if (parentId == SkillCategoryTrees.ROOT_PARENT_ID) {
            return;
        }
        repository.findById(parentId)
                .orElseThrow(() -> new BusinessException(ResultCode.VALIDATION_ERROR, "上级分类不存在"));
    }
}
