package com.mis.kb.api.controller;

import com.mis.kb.api.dto.KbReparseAllResult;
import com.mis.kb.domain.model.KbResultCode;
import com.mis.kb.domain.service.KbDocumentService;
import com.mis.kb.support.KbBusinessException;
import com.mis.common.security.context.LoginUser;
import com.mis.common.security.context.SecurityContextHolder;
import com.mis.common.web.exception.GlobalExceptionHandler;
import org.junit.jupiter.api.AfterEach;
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
 *
 * <p>知识库域一期：写操作双闸门之二（管辖校验）在 Service 层，Controller 只负责把
 * {@link SecurityContextHolder} 的用户 id 透传给 Service，故用例需先注入登录上下文。
 */
class DocumentControllerReparseAllTest {

    private static final long USER = 42L;

    private KbDocumentService documentService;
    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        documentService = mock(KbDocumentService.class);
        mockMvc = MockMvcBuilders.standaloneSetup(new DocumentController(documentService))
                .setControllerAdvice(new GlobalExceptionHandler())
                .build();
        LoginUser user = new LoginUser();
        user.setUserId(USER);
        user.setTenantId(1L);
        user.setAppId(91010L);
        user.setUsername("tester");
        SecurityContextHolder.setLoginUser(user);
    }

    @AfterEach
    void tearDown() {
        SecurityContextHolder.clear();
    }

    @Test
    @DisplayName("POST /documents/reparse-all 命中库级重解析并包装结构化结果")
    void reparseAllRoutesAndWrapsResult() throws Exception {
        KbReparseAllResult result = new KbReparseAllResult(
                1L, 3, 2, 1, 0,
                List.of(new KbReparseAllResult.FailedDocument(99L, "a.pdf", "boom")));
        when(documentService.reparseAll(1L, false, USER)).thenReturn(result);

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

        verify(documentService).reparseAll(1L, false, USER);
    }

    @Test
    @DisplayName("onlyFailed=true 透传给 Service（Q8：仅重试失败文档，不新增独立端点）")
    void onlyFailedQueryParamRoutesToService() throws Exception {
        when(documentService.reparseAll(3L, true, USER))
                .thenReturn(new KbReparseAllResult(3L, 2, 2, 0, 0, List.of()));

        mockMvc.perform(post("/internal/v1/kb/libraries/3/documents/reparse-all")
                        .param("onlyFailed", "true"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.libraryId").value(3))
                .andExpect(jsonPath("$.data.success").value(2));

        verify(documentService).reparseAll(3L, true, USER);
    }

    @Test
    @DisplayName("空库结果同样经 Result 包装（success=0）")
    void emptyLibraryResultWraps() throws Exception {
        when(documentService.reparseAll(2L, false, USER)).thenReturn(new KbReparseAllResult(2L, 0, 0, 0, 0, List.of()));

        mockMvc.perform(post("/internal/v1/kb/libraries/2/documents/reparse-all"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.total").value(0))
                .andExpect(jsonPath("$.data.failedDocuments").isArray())
                .andExpect(jsonPath("$.data.failedDocuments").isEmpty());

        verify(documentService).reparseAll(2L, false, USER);
    }

    @Test
    @DisplayName("知识库不存在：走统一异常通道返回业务错误码")
    void libraryNotFoundPropagatesErrorChannel() throws Exception {
        when(documentService.reparseAll(404L, false, USER)).thenThrow(
                new KbBusinessException(KbResultCode.KB_LIBRARY_NOT_FOUND));

        mockMvc.perform(post("/internal/v1/kb/libraries/404/documents/reparse-all"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(KbResultCode.KB_LIBRARY_NOT_FOUND.getCode()));

        verify(documentService).reparseAll(404L, false, USER);
    }
}
