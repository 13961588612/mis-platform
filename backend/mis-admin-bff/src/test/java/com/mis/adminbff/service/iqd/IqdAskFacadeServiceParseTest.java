package com.mis.adminbff.service.iqd;

import com.mis.adminbff.dto.iqd.IqdAskResponse;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

class IqdAskFacadeServiceParseTest {

    @Test
    @DisplayName("自然语言权限说明填成 45204 失败帧，而不是 Jackson 词法错误")
    void unstructuredScopeDeniedBecomesFailedFrame() {
        IqdAskResponse resp = new IqdAskResponse();
        String prose = "查询未执行成功，无法返回门店清单。错误码 `45204`，当前角色没有可问数据范围。";

        IqdAskFacadeService.fillUnstructuredWorkerText(resp, prose);

        assertEquals("failed", resp.getStatus());
        assertEquals("45204", resp.getErrorCode());
        assertEquals(prose, resp.getErrorMessage());
        assertEquals(prose, resp.getAnswerSummary());
        assertEquals("deny", resp.getScope().decision());
    }

    @Test
    @DisplayName("正文没有 452xx 时归为 45299")
    void unstructuredWithoutCode() {
        IqdAskResponse resp = new IqdAskResponse();
        IqdAskFacadeService.fillUnstructuredWorkerText(resp, "暂时无法回答");
        assertEquals("45299", resp.getErrorCode());
        assertTrue(resp.getScope() == null || resp.getScope().decision() == null);
    }
}
