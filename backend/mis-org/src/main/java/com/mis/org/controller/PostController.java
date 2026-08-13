package com.mis.org.controller;

import com.mis.common.core.result.Result;
import com.mis.org.dto.PostCreateRequest;
import com.mis.org.dto.PostTypeVO;
import com.mis.org.dto.PostUpdateRequest;
import com.mis.org.dto.PostVO;
import com.mis.org.service.PostService;
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
 * 岗位内部端点：/internal/v1/posts* + /internal/v1/post-types（BFF 透传对象）。
 */
@RestController
@RequestMapping("/internal/v1")
public class PostController {

    private final PostService postService;

    public PostController(PostService postService) {
        this.postService = postService;
    }

    @GetMapping("/posts")
    public Result<List<PostVO>> list(
            @RequestParam Long tenantId,
            @RequestParam(required = false) Long deptId,
            @RequestParam(required = false) Long postTypeId,
            @RequestParam(required = false) Integer status) {
        return Result.ok(postService.list(tenantId, deptId, postTypeId, status));
    }

    @GetMapping("/posts/{id}")
    public Result<PostVO> get(@PathVariable Long id) {
        return Result.ok(postService.getById(id));
    }

    @PostMapping("/posts")
    public Result<PostVO> create(@Valid @RequestBody PostCreateRequest request) {
        return Result.ok(postService.create(request));
    }

    @PutMapping("/posts/{id}")
    public Result<PostVO> update(@PathVariable Long id, @Valid @RequestBody PostUpdateRequest request) {
        return Result.ok(postService.update(id, request));
    }

    @DeleteMapping("/posts/{id}")
    public Result<Void> delete(@PathVariable Long id) {
        postService.delete(id);
        return Result.ok();
    }

    @GetMapping("/post-types")
    public Result<List<PostTypeVO>> listTypes(@RequestParam Long tenantId) {
        return Result.ok(postService.listTypes(tenantId));
    }
}
