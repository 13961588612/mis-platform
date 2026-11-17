package com.mis.adminbff.controller;

import com.mis.adminbff.dto.agentops.SkillCategoryBindRequest;
import com.mis.adminbff.dto.agentops.SkillCategorySaveRequest;
import com.mis.adminbff.dto.agentops.SkillCategoryTreeVO;
import com.mis.adminbff.dto.agentops.SkillCategoryVO;
import com.mis.adminbff.service.agentops.SkillCategoryService;
import com.mis.common.core.result.Result;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 技能分类树（V170，真值在平台库，不透传 ai-platform）。
 *
 * <p>路径须与 {@code sys_api} 93234–93238 逐字一致。
 */
@RestController
@RequestMapping("/api/v1/agent-ops")
public class AgentOpsSkillCategoryController {

    private final SkillCategoryService skillCategoryService;

    public AgentOpsSkillCategoryController(SkillCategoryService skillCategoryService) {
        this.skillCategoryService = skillCategoryService;
    }

    @GetMapping("/skill-categories")
    public Result<SkillCategoryTreeVO> tree() {
        return Result.ok(skillCategoryService.tree());
    }

    @PostMapping("/skill-categories")
    public Result<SkillCategoryVO> create(@Valid @RequestBody SkillCategorySaveRequest request) {
        return Result.ok(skillCategoryService.create(request));
    }

    @PutMapping("/skill-categories/{id}")
    public Result<SkillCategoryVO> update(
            @PathVariable("id") Long id, @Valid @RequestBody SkillCategorySaveRequest request) {
        return Result.ok(skillCategoryService.update(id, request));
    }

    @DeleteMapping("/skill-categories/{id}")
    public Result<Void> delete(@PathVariable("id") Long id) {
        skillCategoryService.delete(id);
        return Result.ok();
    }

    @PutMapping("/skills/{id}/category")
    public Result<Void> bind(
            @PathVariable("id") String skillId, @RequestBody(required = false) SkillCategoryBindRequest request) {
        skillCategoryService.bind(skillId, request);
        return Result.ok();
    }
}
