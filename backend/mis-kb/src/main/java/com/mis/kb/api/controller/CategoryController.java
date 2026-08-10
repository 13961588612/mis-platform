package com.mis.kb.api.controller;

import com.mis.common.core.result.Result;
import com.mis.common.security.context.LoginUser;
import com.mis.common.security.context.SecurityContextHolder;
import com.mis.kb.api.dto.KbCategoryCreateRequest;
import com.mis.kb.api.dto.KbCategoryMoveRequest;
import com.mis.kb.api.dto.KbCategoryUpdateRequest;
import com.mis.kb.api.dto.KbCategoryVO;
import com.mis.kb.domain.service.KbCategoryService;
import com.mis.kb.domain.service.NodeAdminResolver;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Set;

/**
 * 分类管理（内部端点，供 BFF 聚合）。
 *
 * <p>知识库域一期新增：{@code GET /manageable-ids}（管辖节点列表）、
 * {@code PUT /{id}/move}（移动，防环 + 管辖校验）。当前用户从
 * {@link SecurityContextHolder} 取（BFF {@code loginContextHeaders()} 已透传 X-User-Id）。
 */
@RestController
@RequestMapping("/internal/v1/kb/categories")
public class CategoryController {

    private final KbCategoryService categoryService;
    private final NodeAdminResolver nodeAdminResolver;

    public CategoryController(KbCategoryService categoryService, NodeAdminResolver nodeAdminResolver) {
        this.categoryService = categoryService;
        this.nodeAdminResolver = nodeAdminResolver;
    }

    @GetMapping
    public Result<List<KbCategoryVO>> list() {
        return Result.ok(categoryService.listAll());
    }

    @PostMapping
    public Result<KbCategoryVO> create(@Valid @RequestBody KbCategoryCreateRequest request) {
        return Result.ok(categoryService.create(request, currentUserId()));
    }

    @PutMapping("/{id}")
    public Result<KbCategoryVO> update(@PathVariable Long id, @Valid @RequestBody KbCategoryUpdateRequest request) {
        return Result.ok(categoryService.update(id, request, currentUserId()));
    }

    @DeleteMapping("/{id}")
    public Result<Void> delete(@PathVariable Long id) {
        categoryService.delete(id, currentUserId());
        return Result.ok();
    }

    /** 管辖节点 id 列表（本人可管理的全部节点 = 授权节点的子树并集；全局管理员 = 全量）。 */
    @GetMapping("/manageable-ids")
    public Result<Set<Long>> manageableIds() {
        return Result.ok(nodeAdminResolver.resolveManageableCategoryIds(currentUserId()));
    }

    /** 移动分类节点（管辖 + 防环，经 NodeAdminResolver.assertCanMove）。 */
    @PutMapping("/{id}/move")
    public Result<KbCategoryVO> move(
            @PathVariable Long id, @Valid @RequestBody KbCategoryMoveRequest request) {
        return Result.ok(categoryService.move(id, request.newParentId(), currentUserId()));
    }

    private Long currentUserId() {
        return SecurityContextHolder.getOptional().map(LoginUser::getUserId).orElse(null);
    }
}
