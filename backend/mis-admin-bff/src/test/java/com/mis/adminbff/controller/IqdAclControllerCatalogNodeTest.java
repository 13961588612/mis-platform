package com.mis.adminbff.controller;

import com.mis.adminbff.client.AiPlatformClient;
import com.mis.adminbff.service.iqd.IqdFacadeService;
import com.mis.common.core.exception.BusinessException;
import com.mis.common.core.exception.ResultCode;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import java.util.Map;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * {@code PUT /api/v1/iqd/catalog/node} 的连接 id 传参回归测试（MockMvc standaloneSetup）。
 *
 * <p><b>为什么钉这个</b>：前端 {@code updateIqdCatalogNode} 把 connectionId 放在 **query 参数**
 * （body 里没有 {@code connection_id}），而 BFF 早先只从 body 读 → 拿到 null 后拼出
 * {@code ?connectionId=}（空值）→ mis-iqd 的 {@code StringToNumber} 把空串转成 null →
 * {@code MissingServletRequestParameterException} → 前端只看到 {@code 50000 系统错误}，
 * 完全看不出是「连接 id 丢了」（2026-09-27 实测于 connectionId=900001）。
 *
 * <p>故此处同时钉两条：① query 参数必须透传进 facade；② 缺参数时是明确的 40001，
 * 而不是含混的 50000。
 */
class IqdAclControllerCatalogNodeTest {

    private static final String BODY = "{\"item_key\":\"col:sales\",\"kind\":\"column\","
            + "\"patch\":{\"description\":\"营业额\"},\"base_revision\":1,\"idempotency_key\":\"k1\"}";

    private IqdFacadeService facade;
    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        facade = mock(IqdFacadeService.class);
        mockMvc = MockMvcBuilders
                .standaloneSetup(new IqdAclController(facade, mock(AiPlatformClient.class)))
                .build();
    }

    @Test
    @DisplayName("query 参数 connectionId 透传进 facade（不再只看 body 的 connection_id）")
    void passesQueryConnectionIdToFacade() throws Exception {
        when(facade.updateCatalogNode(eq(900001L), any(), any(), any()))
                .thenReturn(Map.of("edit_revision", 2, "edit_status", "EDITED_UNSYNCED"));

        mockMvc.perform(put("/api/v1/iqd/catalog/node")
                        .param("connectionId", "900001")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(BODY))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.edit_revision").value(2));

        verify(facade).updateCatalogNode(eq(900001L), any(), any(), any());
    }

    @Test
    @DisplayName("缺 connectionId → 40001（明确参数错误，而不是 50000 系统错误）")
    void missingConnectionIdIsValidationError() throws Exception {
        when(facade.updateCatalogNode(isNull(), any(), any(), any()))
                .thenThrow(new BusinessException(ResultCode.VALIDATION_ERROR, "connectionId 不能为空"));

        mockMvc.perform(put("/api/v1/iqd/catalog/node")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(BODY))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(ResultCode.VALIDATION_ERROR.getCode()))
                .andExpect(jsonPath("$.message").value("connectionId 不能为空"));
    }
}
