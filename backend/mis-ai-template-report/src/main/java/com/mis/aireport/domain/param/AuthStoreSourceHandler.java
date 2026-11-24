package com.mis.aireport.domain.param;

import com.mis.aireport.client.IamUserClient;
import com.mis.aireport.datasource.spm.bigdata.SpmSlotFetchService;
import com.mis.aireport.datasource.spm.bigdata.SpmSlotOption;
import com.mis.aireport.domain.entity.AiParamSource;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;

import java.util.List;

/**
 * 超市权限门店：经 {@code spm-big-data} JDBC（{@code quser} → 权限表 → 门店维）。
 * 租户管理员 / IAM 数据范围「全部」且权限表无店时，回退在营全量，避免 prepare-card 40321。
 */
@Component("AuthStoreSourceHandler")
public class AuthStoreSourceHandler implements ParamSourceHandler {

    private static final Logger log = LoggerFactory.getLogger(AuthStoreSourceHandler.class);

    private final SpmSlotFetchService slotFetchService;
    private final IamUserClient iamUserClient;

    public AuthStoreSourceHandler(SpmSlotFetchService slotFetchService, IamUserClient iamUserClient) {
        this.slotFetchService = slotFetchService;
        this.iamUserClient = iamUserClient;
    }

    @Override
    public String beanName() {
        return "AuthStoreSourceHandler";
    }

    @Override
    public ParamResolveResult resolve(Long userId, AiParamSource source) {
        List<ParamOption> options = listStores(userId).stream().map(this::toOption).toList();
        String defaultValue = options.isEmpty() ? null : options.get(0).value();
        return new ParamResolveResult(
                source.getSourceCode(),
                source.getValueType(),
                source.getWireKey(),
                source.getName(),
                options,
                defaultValue);
    }

    @Override
    public boolean accepts(Long userId, AiParamSource source, String value) {
        if (!StringUtils.hasText(value)) {
            return false;
        }
        return listStores(userId).stream().anyMatch(o -> value.equals(o.value()));
    }

    private List<SpmSlotOption> listStores(Long userId) {
        List<SpmSlotOption> authorized = slotFetchService.fetchAuthorizedStores(userId);
        if (!authorized.isEmpty()) {
            return authorized;
        }
        if (!iamUserClient.hasUnrestrictedStoreAccess(userId)) {
            return List.of();
        }
        List<SpmSlotOption> all = slotFetchService.fetchAllStores(userId);
        log.info("auth-store fallback to all operating stores userId={} size={}", userId, all.size());
        return all;
    }

    private ParamOption toOption(SpmSlotOption o) {
        return new ParamOption(o.value(), o.label(), o.extra());
    }
}
