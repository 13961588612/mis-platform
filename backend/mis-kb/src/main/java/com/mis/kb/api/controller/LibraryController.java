package com.mis.kb.api.controller;

import com.mis.common.core.result.Result;
import com.mis.common.security.context.LoginUser;
import com.mis.common.security.context.SecurityContextHolder;
import com.mis.kb.api.dto.KbLibraryCreateRequest;
import com.mis.kb.api.dto.KbLibraryDetailVO;
import com.mis.kb.api.dto.KbLibraryUpdateRequest;
import com.mis.kb.api.dto.KbLibraryVO;
import com.mis.kb.domain.model.RagSettings;
import com.mis.kb.domain.service.KbLibraryService;
import com.mis.kb.domain.service.RagSettingsService;
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

/** 知识库管理（内部端点，供 BFF 聚合）。 */
@RestController
@RequestMapping("/internal/v1/kb/libraries")
public class LibraryController {

    private final KbLibraryService libraryService;
    private final RagSettingsService ragSettingsService;

    public LibraryController(KbLibraryService libraryService, RagSettingsService ragSettingsService) {
        this.libraryService = libraryService;
        this.ragSettingsService = ragSettingsService;
    }

    @GetMapping
    public Result<List<KbLibraryVO>> list(@RequestParam(required = false) Long categoryId) {
        return Result.ok(libraryService.list(categoryId));
    }

    @GetMapping("/{id}")
    public Result<KbLibraryVO> get(@PathVariable Long id) {
        return Result.ok(libraryService.get(id));
    }

    /**
     * 知识库详情聚合（L-06）。
     *
     * <p>一次返回「基本信息 + 文档数 + 授权摘要 + RAG 设置」，供详情页三个 Tab 首屏共用，
     * 避免前端进页面就打三四个请求。{@code aclSummary.subjectName} 在 mis-kb 侧为 {@code null}，
     * 由 BFF 回填——领域服务不该为了显示一个名字去远程 IAM 拉 N 次。
     *
     * @param id 知识库 id
     * @return 详情聚合视图
     */
    @GetMapping("/{id}/detail")
    public Result<KbLibraryDetailVO> detail(@PathVariable Long id) {
        return Result.ok(ragSettingsService.detail(id));
    }

    /**
     * 读取知识库 RAG 设置（L-08）。
     *
     * @param id 知识库 id
     * @return 已用默认值补齐的设置
     */
    @GetMapping("/{id}/engine/settings")
    public Result<RagSettings> getEngineSettings(@PathVariable Long id) {
        return Result.ok(ragSettingsService.get(id));
    }

    /**
     * 保存知识库 RAG 设置并同步引擎（L-08，依赖 X-03 修复）。
     *
     * <p>引擎同步失败<b>不回滚</b>本地保存，仅记 error 日志；口径见
     * {@link RagSettingsService} 类级说明。
     *
     * @param id       知识库 id
     * @param settings 待保存设置
     * @return 落库后生效的设置
     */
    @PutMapping("/{id}/engine/settings")
    public Result<RagSettings> updateEngineSettings(
            @PathVariable Long id, @RequestBody RagSettings settings) {
        return Result.ok(ragSettingsService.save(id, settings));
    }

    @PostMapping
    public Result<KbLibraryVO> create(@Valid @RequestBody KbLibraryCreateRequest request) {
        // owner 缺省为当前登录用户
        KbLibraryCreateRequest effective = request.owner() != null
                ? request
                : new KbLibraryCreateRequest(
                        request.categoryId(), request.name(), request.secrecy(),
                        currentUserId(), request.settings());
        return Result.ok(libraryService.create(effective));
    }

    @PutMapping("/{id}")
    public Result<KbLibraryVO> update(@PathVariable Long id, @Valid @RequestBody KbLibraryUpdateRequest request) {
        return Result.ok(libraryService.update(id, request));
    }

    @DeleteMapping("/{id}")
    public Result<Void> delete(@PathVariable Long id) {
        libraryService.delete(id);
        return Result.ok();
    }

    private Long currentUserId() {
        return SecurityContextHolder.getOptional().map(LoginUser::getUserId).orElse(null);
    }
}
