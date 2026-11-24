package com.mis.adminbff.controller;

import com.mis.adminbff.client.IamWebClient;
import com.mis.adminbff.client.model.AppVO;
import com.mis.adminbff.config.ImapProperties;
import com.mis.adminbff.config.SpmProperties;
import com.mis.adminbff.dto.AppUpdateRequest;
import com.mis.adminbff.dto.AppView;
import com.mis.adminbff.support.IntranetAddresses;
import com.mis.adminbff.support.RequestContext;
import com.mis.common.core.result.Result;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.ArrayList;
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
     *
     * <p>T01：智能体运营控制台（{@code agent}）加入白名单。配套前置条件：
     * <ul>
     *   <li>{@code V19__agent_ops_seed.sql} 已写入 {@code sys_app(92010, 'agent')}，
     *       且 {@code runtime='host'}、{@code status=1}、{@code kind='subsystem'}
     *       （{@link #list} 只拉 {@code kind=subsystem} 的应用）；</li>
     *   <li>前端已注册 {@code /agent/*} 路由与 {@code HOST_APP_LANDING.agent}，
     *       否则卡片可点但会落到空白页。</li>
     * </ul>
     * 本常量是编译期硬编码，<b>只跑迁移不重新部署 BFF 不会生效</b>。
     *
     * <p>V77：问数独立门户应用（{@code iqd}，sys_app 93010）加入白名单，
     * 否则门户「问数」卡片不可点击（见 iqd-standalone-app-design.md D5）。
     * 改完本常量后必须重新部署 BFF 才能生效。
     */
    private static final Set<String> ENTERABLE_CODES = Set.of("system", "kb", "agent", "iqd", "finance");

    private final IamWebClient iamWebClient;
    private final SpmProperties spmProperties;
    private final ImapProperties imapProperties;

    public AppController(IamWebClient iamWebClient, SpmProperties spmProperties, ImapProperties imapProperties) {
        this.iamWebClient = iamWebClient;
        this.spmProperties = spmProperties;
        this.imapProperties = imapProperties;
    }

    @GetMapping
    public Result<List<AppView>> list(HttpServletRequest request) {
        Long tenantId = RequestContext.requireTenantId();
        List<AppVO> apps = iamWebClient.listApps(tenantId, "subsystem");
        boolean intranet = IntranetAddresses.isIntranetClient(request, extraCidrs());
        List<AppView> views = apps.stream().map((app) -> toView(app, intranet)).toList();
        return Result.ok(views);
    }

    @PutMapping("/{id}")
    public Result<AppView> update(@PathVariable Long id, @RequestBody AppUpdateRequest request, HttpServletRequest http) {
        AppVO updated = iamWebClient.updateApp(id, request);
        boolean intranet = IntranetAddresses.isIntranetClient(http, extraCidrs());
        return Result.ok(toView(updated, intranet));
    }

    private AppView toView(AppVO app, boolean intranet) {
        // 可进入性：remote / iframe 子应用由壳子容器（/remote/:code、iframe 页面）承载，天然可进；
        // host 应用仍走白名单（本仓已实现路由才可进）。
        String runtime = app.runtime() != null ? app.runtime() : "host";
        boolean intranetOnly = ("spm".equals(app.code()) && spmProperties.isIntranetOnly())
                || ("imap".equals(app.code()) && imapProperties.isIntranetOnly());
        boolean enterable = (app.status() == null || app.status() == 1) && (
                "remote".equalsIgnoreCase(runtime) || "iframe".equalsIgnoreCase(runtime)
                        || ("host".equalsIgnoreCase(runtime) && ENTERABLE_CODES.contains(app.code())));
        if (intranetOnly && !intranet) {
            enterable = false;
        }
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
                enterable,
                intranetOnly,
                app.mfeRemote());
    }

    private List<String> extraCidrs() {
        List<String> merged = new ArrayList<>();
        if (spmProperties.getExtraAllowedCidrs() != null) {
            merged.addAll(spmProperties.getExtraAllowedCidrs());
        }
        if (imapProperties.getExtraAllowedCidrs() != null) {
            merged.addAll(imapProperties.getExtraAllowedCidrs());
        }
        return merged;
    }
}
