package com.mis.kb.api.controller;

import com.mis.common.core.result.Result;
import com.mis.kb.api.dto.KbDocumentUploadResponse;
import com.mis.kb.api.dto.KbDocumentVO;
import com.mis.kb.api.dto.KbReparseAllResult;
import com.mis.kb.domain.model.DocumentChunkConfig;
import com.mis.kb.domain.service.KbDocumentService;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

import java.util.List;

/** 文档管理（内部端点，供 BFF 聚合）。 */
@RestController
@RequestMapping("/internal/v1/kb/libraries")
public class DocumentController {

    private final KbDocumentService documentService;

    public DocumentController(KbDocumentService documentService) {
        this.documentService = documentService;
    }

    @GetMapping("/{libraryId}/documents")
    public Result<List<KbDocumentVO>> list(@PathVariable Long libraryId) {
        return Result.ok(documentService.list(libraryId));
    }

    @GetMapping("/{libraryId}/documents/{id}")
    public Result<KbDocumentVO> get(@PathVariable Long libraryId, @PathVariable Long id) {
        return Result.ok(documentService.get(id));
    }

    @PostMapping("/{libraryId}/documents")
    public Result<KbDocumentUploadResponse> upload(
            @PathVariable Long libraryId,
            @RequestParam("file") MultipartFile file,
            @RequestParam(required = false) String chunkMethod,
            @RequestParam(required = false) Integer chunkTokenNum,
            @RequestParam(required = false) String separator) {
        return Result.ok(documentService.upload(
                libraryId, file, new DocumentChunkConfig(chunkMethod, chunkTokenNum, separator)));
    }

    /** 更新文档级切片配置（kb_settings_model_chunk；改参触发重解析）。 */
    @PutMapping("/{libraryId}/documents/{id}/chunk-config")
    public Result<Void> updateChunkConfig(
            @PathVariable Long libraryId,
            @PathVariable Long id,
            @RequestBody DocumentChunkConfig config) {
        documentService.updateChunkConfig(id, config);
        return Result.ok();
    }

    @PutMapping("/{libraryId}/documents/{id}/enable")
    public Result<Void> setEnabled(
            @PathVariable Long libraryId,
            @PathVariable Long id,
            @RequestParam boolean enabled) {
        documentService.setEnabled(id, enabled);
        return Result.ok();
    }

    @PostMapping("/{libraryId}/documents/{id}/reparse")
    public Result<Void> reparse(@PathVariable Long libraryId, @PathVariable Long id) {
        documentService.reparse(id);
        return Result.ok();
    }

    /**
     * 库级一键全部重解析（P1-1：换嵌入模型后全量重解析恢复检索）。
     *
     * <p>遍历该库全部文档逐个触发重解析；单文档失败不中断其余，返回结构化结果
     * （成功/失败/跳过 + 失败明细）。字面量段 {@code reparse-all} 与
     * {@code /{id}/reparse} 无路由冲突（Spring 字面量优先）。
     */
    @PostMapping("/{libraryId}/documents/reparse-all")
    public Result<KbReparseAllResult> reparseAll(@PathVariable Long libraryId) {
        return Result.ok(documentService.reparseAll(libraryId));
    }

    @DeleteMapping("/{libraryId}/documents/{id}")
    public Result<Void> delete(@PathVariable Long libraryId, @PathVariable Long id) {
        documentService.delete(id);
        return Result.ok();
    }
}
