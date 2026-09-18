package com.mis.adminbff.controller;

import com.mis.adminbff.client.IamWebClient;
import com.mis.adminbff.client.model.IamUserVO;
import com.mis.adminbff.dto.finance.LegacyAuthMeVO;
import com.mis.adminbff.support.RequestContext;
import com.mis.common.core.exception.BusinessException;
import com.mis.common.core.exception.ResultCode;
import com.mis.common.core.result.Result;
import org.springframework.util.StringUtils;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 老 auth 凭 MIS Access JWT 回查当前用户手机号。
 *
 * <p>契约：{@code docs/integration/mis-legacy-auth-me.md}。
 * 只返回 JWT 主体本人资料；不做「按手机号查用户」。
 * 判权：sys_api 挂 permission=NULL 菜单 → authOnly（登录即可）。
 */
@RestController
@RequestMapping("/api/v1/integration/legacy-auth")
public class LegacyAuthMeController {

    private final IamWebClient iamWebClient;

    public LegacyAuthMeController(IamWebClient iamWebClient) {
        this.iamWebClient = iamWebClient;
    }

    @GetMapping("/me")
    public Result<LegacyAuthMeVO> me() {
        Long userId = RequestContext.requireLoginUser().getUserId();
        IamUserVO user = iamWebClient.getUser(userId);
        if (user == null) {
            throw new BusinessException(ResultCode.NOT_FOUND, "用户不存在");
        }
        String phone = StringUtils.hasText(user.phone()) ? user.phone().trim() : null;
        return Result.ok(new LegacyAuthMeVO(
                user.id(),
                user.tenantId(),
                user.appId(),
                user.username(),
                user.realName(),
                phone,
                user.status()));
    }
}
