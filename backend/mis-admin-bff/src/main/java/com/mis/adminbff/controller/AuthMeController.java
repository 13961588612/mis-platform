package com.mis.adminbff.controller;

import com.mis.adminbff.client.IamWebClient;
import com.mis.adminbff.client.model.IamRoleVO;
import com.mis.adminbff.client.model.IamUserVO;
import com.mis.adminbff.dto.MeVO;
import com.mis.adminbff.service.MenuAggregateService;
import com.mis.adminbff.support.RequestContext;
import com.mis.common.core.result.Result;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
@RequestMapping("/api/v1/auth")
public class AuthMeController {

    private final IamWebClient iamWebClient;
    private final MenuAggregateService menuAggregateService;

    public AuthMeController(IamWebClient iamWebClient, MenuAggregateService menuAggregateService) {
        this.iamWebClient = iamWebClient;
        this.menuAggregateService = menuAggregateService;
    }

    @GetMapping("/me")
    public Result<MeVO> me() {
        Long userId = RequestContext.requireLoginUser().getUserId();
        IamUserVO user = iamWebClient.getUser(userId);
        List<String> permissions = menuAggregateService.currentPermissions();
        List<String> roles = user.roles() == null
                ? List.of()
                : user.roles().stream().map(IamRoleVO::code).toList();
        return Result.ok(new MeVO(
                user.id(),
                user.username(),
                user.realName(),
                user.avatarUrl(),
                roles,
                null,
                permissions));
    }
}
