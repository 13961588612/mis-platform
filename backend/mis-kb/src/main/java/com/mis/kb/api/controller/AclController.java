package com.mis.kb.api.controller;

import com.mis.common.core.result.Result;
import com.mis.common.security.context.LoginUser;
import com.mis.common.security.context.SecurityContextHolder;
import com.mis.kb.api.dto.KbAclCreateRequest;
import com.mis.kb.api.dto.KbAclVO;
import com.mis.kb.api.dto.LegacyAclInventoryVO;
import com.mis.kb.domain.service.KbAclService;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/** 访问控制（内部端点，供 BFF 聚合）。 */
@RestController
@RequestMapping("/internal/v1/kb/libraries")
public class AclController {

    private final KbAclService aclService;

    public AclController(KbAclService aclService) {
        this.aclService = aclService;
    }

    @GetMapping("/{libraryId}/acls")
    public Result<List<KbAclVO>> list(@PathVariable Long libraryId) {
        return Result.ok(aclService.list(libraryId));
    }

    @PostMapping("/{libraryId}/acls")
    public Result<KbAclVO> grant(@PathVariable Long libraryId, @Valid @RequestBody KbAclCreateRequest request) {
        return Result.ok(aclService.grant(currentUserId(), libraryId, request));
    }

    @DeleteMapping("/acls/{id}")
    public Result<Void> revoke(@PathVariable Long id) {
        aclService.revoke(currentUserId(), id);
        return Result.ok();
    }

    /**
     * KBP-10 存量 manage/acl 只读清单（运营清理依据，只读不清理）。
     *
     * <p><b>注意路径层级：</b>与 {@code DELETE /acls/{id}} 同层级（本控制器类级前缀为
     * {@code /internal/v1/kb/libraries}），故实际路径为
     * {@code GET /internal/v1/kb/libraries/acls/inventory}，由 BFF 端点
     * {@code /api/v1/kb/acls/inventory} 代理。
     *
     * <p><b>权限：</b>mis-kb 侧前置 {@code isGlobalAdmin}（非全局管理员 40311），
     * BFF 侧另有 {@code kb:acl:revoke} 权限码兜底（双闸门）。
     *
     * @param libraryId   按库维度过滤；缺省 = 不限制
     * @param subjectType 按主体类型过滤；缺省 = 不限制
     * @param subjectId   按主体 id 过滤；缺省 = 不限制
     * @return 存量 manage/acl 授权清单（mis-kb 侧 subjectName 恒为 null，BFF 回填）
     */
    @GetMapping("/acls/inventory")
    public Result<List<LegacyAclInventoryVO>> inventory(
            @RequestParam(required = false) Long libraryId,
            @RequestParam(required = false) String subjectType,
            @RequestParam(required = false) Long subjectId) {
        return Result.ok(aclService.listLegacyInventory(
                currentUserId(), libraryId, subjectType, subjectId));
    }

    private Long currentUserId() {
        return SecurityContextHolder.getOptional().map(LoginUser::getUserId).orElse(null);
    }
}
