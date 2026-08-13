package com.mis.kb.api.controller;

import com.mis.common.security.context.LoginUser;
import com.mis.common.security.context.SecurityContextHolder;
import com.mis.common.web.exception.GlobalExceptionHandler;
import com.mis.kb.domain.service.KbQaService;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * {@link QaController} 会话删除端点路由测试。
 *
 * <p>沿用 {@code DocumentControllerReparseAllTest} 同款 standaloneSetup + 真
 * {@link GlobalExceptionHandler}：验「Controller 透传 currentUserId → Service、
 * 返回 {@code Result.ok(null)} 包装」的组合。
 */
class QaControllerTest {

    private static final long USER = 42L;

    private KbQaService qaService;
    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        qaService = mock(KbQaService.class);
        mockMvc = MockMvcBuilders.standaloneSetup(new QaController(qaService))
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
    @DisplayName("DELETE /internal/v1/kb/qa/sessions/{id} 透传当前用户并返回 ok")
    void deleteSessionRoutesAndWrapsOk() throws Exception {
        mockMvc.perform(delete("/internal/v1/kb/qa/sessions/7"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0));

        verify(qaService).deleteSession(7L, USER);
    }
}
