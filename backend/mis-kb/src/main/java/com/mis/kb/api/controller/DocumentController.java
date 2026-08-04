package com.mis.kb.api.controller;

import com.mis.common.core.result.Result;
import com.mis.kb.api.dto.KbDocumentUploadResponse;
import com.mis.kb.api.dto.KbDocumentVO;
import com.mis.kb.domain.service.KbDocumentService;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
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
            @RequestParam("file") MultipartFile file) {
        return Result.ok(documentService.upload(libraryId, file));
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

    @DeleteMapping("/{libraryId}/documents/{id}")
    public Result<Void> delete(@PathVariable Long libraryId, @PathVariable Long id) {
        documentService.delete(id);
        return Result.ok();
    }
}
