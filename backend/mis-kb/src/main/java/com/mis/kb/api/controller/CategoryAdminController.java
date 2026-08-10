package com.mis.kb.api.controller;

import com.mis.common.core.result.Result;
import com.mis.common.security.context.LoginUser;
import com.mis.common.security.context.SecurityContextHolder;
import com.mis.kb.api.dto.KbCategoryAdminCreateRequest;
import com.mis.kb.api.dto.KbCategoryAdminVO;
import com.mis.kb.domain.service.KbCategoryAdminService;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/**
 * 分类节点管理员授权端点（内部，供 BFF 聚合；知识库域一期）。
 *
 * <p>管辖校验在 Service 层（{@code assertNodeManage}）：谁设置/回收管理员谁须先管该节点；
 * 本层只负责从 {@link SecurityContextHolder} 取当前用户（BFF {@code loginContextHeaders()}
 * 已透传 X-User-Id）。
 */
@RestController
@RequestMapping("/internal/v1/kb")
public class CategoryAdminController {

    private final KbCategoryAdminService categoryAdminService;

    public CategoryAdminController(KbCategoryAdminService categoryAdminService) {
        this.categoryAdminService = categoryAdminService;
    }

    @GetMapping("/categories/{id}/admins")
    public Result<List<KbCategoryAdminVO>> list(@PathVariable Long id) {
        return Result.ok(categoryAdminService.list(id, currentUserId()));
    }

    @PostMapping("/categories/{id}/admins")
    public Result<KbCategoryAdminVO> grant(
            @PathVariable Long id, @Valid @RequestBody KbCategoryAdminCreateRequest request) {
        return Result.ok(categoryAdminService.grant(id, request, currentUserId()));
    }

    @DeleteMapping("/category-admins/{adminId}")
    public Result<Void> revoke(@PathVariable Long adminId) {
        categoryAdminService.revoke(adminId, currentUserId());
        return Result.ok();
    }

    private Long currentUserId() {
        return SecurityContextHolder.getOptional().map(LoginUser::getUserId).orElse(null);
    }
}
