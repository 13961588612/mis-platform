package com.mis.adminbff.controller;

import com.mis.adminbff.client.IamWebClient;
import com.mis.adminbff.client.model.AppVO;
import com.mis.adminbff.dto.AppView;
import com.mis.adminbff.support.RequestContext;
import com.mis.common.core.result.Result;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Set;

@RestController
@RequestMapping("/api/v1/apps")
public class AppController {

    /**
     * 本仓已实现、可进入的 host 子系统 code。
     *
     * <p>I-01：知识库（{@code kb}）在 P1 完成前端页面与路由后加入白名单，
     * 门户卡片由「不可进入」变为可点击。<b>仅加入白名单还不够</b>——
     * 该 app 必须在 IAM 侧存在且 {@code runtime=host}、{@code status=1}，
     * 否则这里加了也不会变可进入（见 {@link #toView} 的三重判断）。
     */
    private static final Set<String> ENTERABLE_CODES = Set.of("system", "kb");

    private final IamWebClient iamWebClient;

    public AppController(IamWebClient iamWebClient) {
        this.iamWebClient = iamWebClient;
    }

    @GetMapping
    public Result<List<AppView>> list() {
        Long tenantId = RequestContext.requireTenantId();
        List<AppVO> apps = iamWebClient.listApps(tenantId, "subsystem");
        List<AppView> views = apps.stream().map(this::toView).toList();
        return Result.ok(views);
    }

    private AppView toView(AppVO app) {
        boolean enterable = ENTERABLE_CODES.contains(app.code())
                && "host".equalsIgnoreCase(app.runtime() != null ? app.runtime() : "host")
                && (app.status() == null || app.status() == 1);
        return new AppView(
                app.id(),
                app.tenantId(),
                app.code(),
                app.name(),
                app.icon(),
                app.basePath(),
                app.description(),
                app.portalGroup(),
                app.kind(),
                app.runtime(),
                app.sort(),
                app.status(),
                enterable);
    }
}
