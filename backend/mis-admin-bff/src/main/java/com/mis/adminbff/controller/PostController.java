package com.mis.adminbff.controller;

import com.mis.adminbff.client.model.PostTypeVO;
import com.mis.adminbff.client.model.PostVO;
import com.mis.adminbff.dto.PostCreateRequest;
import com.mis.adminbff.dto.PostTypeCreateRequest;
import com.mis.adminbff.dto.PostTypeUpdateRequest;
import com.mis.adminbff.dto.PostUpdateRequest;
import com.mis.adminbff.service.OrgFacadeService;
import com.mis.common.core.result.Result;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/**
 * 岗位 BFF 端点：/api/v1/posts* + /api/v1/post-types。
 */
@RestController
@RequestMapping("/api/v1")
public class PostController {

    private final OrgFacadeService orgFacadeService;

    public PostController(OrgFacadeService orgFacadeService) {
        this.orgFacadeService = orgFacadeService;
    }

    @GetMapping("/posts")
    public Result<List<PostVO>> list(
            @RequestParam(required = false) Long deptId,
            @RequestParam(required = false) Long postTypeId,
            @RequestParam(required = false) Integer status) {
        return Result.ok(orgFacadeService.listPosts(deptId, postTypeId, status));
    }

    @GetMapping("/posts/{id}")
    public Result<PostVO> get(@PathVariable Long id) {
        return Result.ok(orgFacadeService.getPost(id));
    }

    @PostMapping("/posts")
    public Result<PostVO> create(@Valid @RequestBody PostCreateRequest request) {
        return Result.ok(orgFacadeService.createPost(request));
    }

    @PutMapping("/posts/{id}")
    public Result<PostVO> update(@PathVariable Long id, @Valid @RequestBody PostUpdateRequest request) {
        return Result.ok(orgFacadeService.updatePost(id, request));
    }

    @DeleteMapping("/posts/{id}")
    public Result<Void> delete(@PathVariable Long id) {
        orgFacadeService.deletePost(id);
        return Result.ok();
    }

    /**
     * 岗位类型列表：status 可选（null=全量含禁用，1=仅启用）；返回含 referenceCount。
     */
    @GetMapping("/post-types")
    public Result<List<PostTypeVO>> listTypes(@RequestParam(required = false) Integer status) {
        return Result.ok(orgFacadeService.listPostTypes(status));
    }

    @PostMapping("/post-types")
    public Result<PostTypeVO> createType(@Valid @RequestBody PostTypeCreateRequest request) {
        return Result.ok(orgFacadeService.createPostType(request));
    }

    @PutMapping("/post-types/{id}")
    public Result<PostTypeVO> updateType(@PathVariable Long id, @Valid @RequestBody PostTypeUpdateRequest request) {
        return Result.ok(orgFacadeService.updatePostType(id, request));
    }

    @DeleteMapping("/post-types/{id}")
    public Result<Void> deleteType(@PathVariable Long id) {
        orgFacadeService.deletePostType(id);
        return Result.ok();
    }
}
