package com.mis.adminbff.controller;

import com.mis.adminbff.dto.internal.InternalAskIdentityVO;
import com.mis.adminbff.service.IdentityAskContext;
import com.mis.adminbff.service.IdentityContextService;
import com.mis.common.core.exception.BusinessException;
import com.mis.common.core.exception.ResultCode;
import com.mis.common.core.result.Result;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * Copilot / iframe 入站回源：按 userId 返回与测试问数相同的 {@code X-Mis-*} 快照。
 *
 * <p>路径落在 {@code /internal/**}，由 {@code InternalServiceTrustInterceptor}
 * 校验 {@code X-Platform-Token}；不经 mis-gateway 公网入口。
 */
@RestController
@RequestMapping("/internal/identity")
public class InternalIdentityController {

    private static final Logger log = LoggerFactory.getLogger(InternalIdentityController.class);

    private final IdentityContextService identityContextService;

    public InternalIdentityController(IdentityContextService identityContextService) {
        this.identityContextService = identityContextService;
    }

    /**
     * 查询指定用户的问数身份头。
     *
     * @param userId MIS userId
     * @return {@code {code:0, data:{userId, headers:{...}}}}
     */
    @GetMapping("/ask-context")
    public Result<InternalAskIdentityVO> askContext(@RequestParam("userId") String userId) {
        Long parsed = parseUserId(userId);
        IdentityAskContext ctx = identityContextService.resolve(parsed, null);
        log.debug("内部问数身份查询: userId={}, headers={}", parsed, ctx.headers().keySet());
        return Result.ok(new InternalAskIdentityVO(parsed, ctx.headers()));
    }

    private static Long parseUserId(String raw) {
        String trimmed = raw == null ? "" : raw.trim();
        if (trimmed.isEmpty()) {
            throw new BusinessException(ResultCode.VALIDATION_ERROR, "缺少 userId");
        }
        try {
            return Long.valueOf(trimmed);
        } catch (NumberFormatException ex) {
            throw new BusinessException(ResultCode.VALIDATION_ERROR, "非法的 userId: " + trimmed);
        }
    }
}
