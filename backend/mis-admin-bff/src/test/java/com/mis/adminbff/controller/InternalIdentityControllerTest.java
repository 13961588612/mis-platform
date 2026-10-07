package com.mis.adminbff.controller;

import com.mis.adminbff.dto.internal.InternalAskIdentityVO;
import com.mis.adminbff.service.IdentityAskContext;
import com.mis.adminbff.service.IdentityContextService;
import com.mis.common.core.exception.BusinessException;
import com.mis.common.core.exception.ResultCode;
import com.mis.common.core.result.Result;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class InternalIdentityControllerTest {

    @Mock
    private IdentityContextService identityContextService;

    @InjectMocks
    private InternalIdentityController controller;

    @Test
    @DisplayName("返回 code=0 且 data.headers 含 X-Mis-Roles")
    void returnsHeaders() {
        when(identityContextService.resolve(1001L, null)).thenReturn(
                new IdentityAskContext(1001L, Map.of(
                        IdentityContextService.HEADER_MIS_ROLES,
                        "[{\"id\":\"81\",\"code\":\"IT-TESTER\"}]")));

        Result<InternalAskIdentityVO> result = controller.askContext("1001");

        assertEquals(ResultCode.SUCCESS.getCode(), result.getCode());
        assertEquals(1001L, result.getData().userId());
        assertEquals("[{\"id\":\"81\",\"code\":\"IT-TESTER\"}]",
                result.getData().headers().get("X-Mis-Roles"));
        verify(identityContextService).resolve(eq(1001L), isNull());
    }

    @Test
    @DisplayName("userId 非数字 → 40001，不查身份源")
    void nonNumericRejected() {
        BusinessException ex = assertThrows(BusinessException.class, () -> controller.askContext("abc"));
        assertEquals(ResultCode.VALIDATION_ERROR.getCode(), ex.getCode());
        verify(identityContextService, never()).resolve(anyLong(), anyLong());
    }
}
