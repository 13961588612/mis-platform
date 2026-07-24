package com.mis.adminbff.security;

import com.mis.adminbff.client.SystemWebClient;
import com.mis.adminbff.client.model.ApiPermissionRuleDTO;
import com.mis.common.security.permission.ApiPermissionRegistry;
import com.mis.common.security.permission.ApiPermissionRule;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.List;

@Component
public class ApiPermissionRegistryLoader {

    private static final Logger log = LoggerFactory.getLogger(ApiPermissionRegistryLoader.class);

    private final SystemWebClient systemWebClient;
    private final ApiPermissionRegistry registry;

    public ApiPermissionRegistryLoader(SystemWebClient systemWebClient, ApiPermissionRegistry registry) {
        this.systemWebClient = systemWebClient;
        this.registry = registry;
    }

    public void reload() {
        List<ApiPermissionRuleDTO> rows = systemWebClient.apiPermissionRegistry();
        List<ApiPermissionRule> rules = new ArrayList<>();
        if (rows != null) {
            for (ApiPermissionRuleDTO row : rows) {
                rules.add(new ApiPermissionRule(
                        row.httpMethod(),
                        row.pathPattern(),
                        row.permission(),
                        row.authOnly()));
            }
        }
        registry.replaceAll(rules);
        log.info("ApiPermissionRegistry 已加载 {} 条规则", registry.size());
    }
}
