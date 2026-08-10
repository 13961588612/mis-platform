package com.mis.kb.api.controller;

import com.mis.kb.api.dto.KbReparseAllResult;
import com.mis.kb.domain.model.KbResultCode;
import com.mis.kb.domain.service.KbDocumentService;
import com.mis.kb.support.KbBusinessException;
import com.mis.common.web.exception.GlobalExceptionHandler;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import java.util.List;

import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * {@link DocumentController} 库级一键重解析端点路由与结果包装测试（P1-1）。
 *
 * <p>沿用 BFF {@code KbSynonymControllerTest} 同款 standaloneSetup + 真
 * {@link GlobalExceptionHandler}：验「Controller 不 catch + 异常处理器写回 code」的组合。
 */
class DocumentControllerReparseAllTest {

    private KbDocumentService documentService;
    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        documentService = mock(KbDocumentService.class);
        mockMvc = MockMvcBuilders.standaloneSetup(new DocumentController(documentService))
                .setControllerAdvice(new GlobalExceptionHandler())
                .build();
    }

    @Test
    @DisplayName("POST /documents/reparse-all 命中库级重解析并包装结构化结果")
    void reparseAllRoutesAndWrapsResult() throws Exception {
        KbReparseAllResult result = new KbReparseAllResult(
                1L, 3, 2, 1, 0,
                List.of(new KbReparseAllResult.FailedDocument(99L, "a.pdf", "boom")));
        when(documentService.reparseAll(1L)).thenReturn(result);

        mockMvc.perform(post("/internal/v1/kb/libraries/1/documents/reparse-all"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.libraryId").value(1))
                .andExpect(jsonPath("$.data.total").value(3))
                .andExpect(jsonPath("$.data.success").value(2))
                .andExpect(jsonPath("$.data.failed").value(1))
                .andExpect(jsonPath("$.data.skipped").value(0))
                .andExpect(jsonPath("$.data.failedDocuments[0].documentId").value(99))
                .andExpect(jsonPath("$.data.failedDocuments[0].title").value("a.pdf"))
                .andExpect(jsonPath("$.data.failedDocuments[0].reason").value("boom"));

        verify(documentService).reparseAll(1L);
    }

    @Test
    @DisplayName("空库结果同样经 Result 包装（success=0）")
    void emptyLibraryResultWraps() throws Exception {
        when(documentService.reparseAll(2L)).thenReturn(new KbReparseAllResult(2L, 0, 0, 0, 0, List.of()));

        mockMvc.perform(post("/internal/v1/kb/libraries/2/documents/reparse-all"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.total").value(0))
                .andExpect(jsonPath("$.data.failedDocuments").isArray())
                .andExpect(jsonPath("$.data.failedDocuments").isEmpty());

        verify(documentService).reparseAll(2L);
    }

    @Test
    @DisplayName("知识库不存在：走统一异常通道返回业务错误码")
    void libraryNotFoundPropagatesErrorChannel() throws Exception {
        when(documentService.reparseAll(404L)).thenThrow(
                new KbBusinessException(KbResultCode.KB_LIBRARY_NOT_FOUND));

        mockMvc.perform(post("/internal/v1/kb/libraries/404/documents/reparse-all"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(KbResultCode.KB_LIBRARY_NOT_FOUND.getCode()));

        verify(documentService).reparseAll(404L);
    }
}
