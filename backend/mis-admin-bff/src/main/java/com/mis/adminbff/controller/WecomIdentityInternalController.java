package com.mis.adminbff.controller;

import com.mis.adminbff.client.IamWebClient;
import com.mis.adminbff.client.model.IamUserVO;
import com.mis.common.core.result.Result;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 企微身份绑定的内部查询面（ai-platform Worker 消费）。
 *
 * <p>对应设计 {@code wecom-user-binding-design.md} §10：首次无绑定时，
 * 按 {@code tenantId + phone} 反查 MIS 正常用户，仅 {@code exact-one} 才认。
 *
 * <p><b>安全</b>：路径落在 {@code /internal/**} 之下，由
 * {@code InternalServiceTrustInterceptor} 强制校验 {@code X-Platform-Token} + 来源网段；
 * 不经 mis-gateway（网关只路由 {@code /api/v1/**}），绝不暴露公网。
 */
@RestController
@RequestMapping("/internal/wecom")
public class WecomIdentityInternalController {

    private static final Logger log = LoggerFactory.getLogger(WecomIdentityInternalController.class);

    private final IamWebClient iamWebClient;

    public WecomIdentityInternalController(IamWebClient iamWebClient) {
        this.iamWebClient = iamWebClient;
    }

    /**
     * 按租户 + 手机号反查唯一 MIS 用户。
     *
     * @param tenantId MIS 租户 ID
     * @param phone    手机号
     * @return {@code {matched, user_id?, username?, reason?}}
     */
    @GetMapping("/user-by-phone")
    public Result<Map<String, Object>> userByPhone(
            @RequestParam("tenantId") Long tenantId,
            @RequestParam("phone") String phone) {
        Map<String, Object> data = new LinkedHashMap<>();
        if (tenantId == null || phone == null || phone.isBlank()) {
            data.put("matched", false);
            data.put("reason", "invalid_param");
            return Result.ok(data);
        }
        List<IamUserVO> users = iamWebClient.findNormalUsersByPhone(tenantId, phone);
        if (users == null || users.isEmpty()) {
            data.put("matched", false);
            data.put("reason", "not_found");
            return Result.ok(data);
        }
        if (users.size() > 1) {
            log.info("企微手机号匹配歧义: tenantId={}, count={}", tenantId, users.size());
            data.put("matched", false);
            data.put("reason", "ambiguous");
            return Result.ok(data);
        }
        IamUserVO user = users.get(0);
        Long userId = parseUserId(user.id());
        if (userId == null) {
            data.put("matched", false);
            data.put("reason", "invalid_user_id");
            return Result.ok(data);
        }
        data.put("matched", true);
        data.put("user_id", userId);
        data.put("username", user.username());
        return Result.ok(data);
    }

    private static Long parseUserId(String raw) {
        String trimmed = raw == null ? "" : raw.trim();
        if (trimmed.isEmpty()) {
            return null;
        }
        try {
            return Long.valueOf(trimmed);
        } catch (NumberFormatException ex) {
            return null;
        }
    }
}
