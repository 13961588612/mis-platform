package com.mis.kb.api.controller;

import com.mis.common.core.result.Result;
import com.mis.kb.api.dto.KbAclCreateRequest;
import com.mis.kb.api.dto.KbAclVO;
import com.mis.kb.domain.service.KbAclService;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
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
        return Result.ok(aclService.grant(libraryId, request));
    }

    @DeleteMapping("/acls/{id}")
    public Result<Void> revoke(@PathVariable Long id) {
        aclService.revoke(id);
        return Result.ok();
    }
}
