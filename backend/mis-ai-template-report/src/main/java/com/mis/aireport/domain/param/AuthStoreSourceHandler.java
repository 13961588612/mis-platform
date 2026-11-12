package com.mis.aireport.domain.param;

import com.mis.aireport.datasource.spm.bigdata.SpmSlotFetchService;
import com.mis.aireport.datasource.spm.bigdata.SpmSlotOption;
import com.mis.aireport.domain.entity.AiParamSource;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;

import java.util.List;

/**
 * 超市权限门店：经 {@code spm-big-data} JDBC SQL，不经 IAM。
 */
@Component("AuthStoreSourceHandler")
public class AuthStoreSourceHandler implements ParamSourceHandler {

    private final SpmSlotFetchService slotFetchService;

    public AuthStoreSourceHandler(SpmSlotFetchService slotFetchService) {
        this.slotFetchService = slotFetchService;
    }

    @Override
    public String beanName() {
        return "AuthStoreSourceHandler";
    }

    @Override
    public ParamResolveResult resolve(Long userId, AiParamSource source) {
        List<ParamOption> options = slotFetchService.fetchAuthorizedStores(userId).stream()
                .map(this::toOption)
                .toList();
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
        return slotFetchService.fetchAuthorizedStores(userId).stream()
                .anyMatch(o -> value.equals(o.value()));
    }

    private ParamOption toOption(SpmSlotOption o) {
        return new ParamOption(o.value(), o.label(), o.extra());
    }
}
