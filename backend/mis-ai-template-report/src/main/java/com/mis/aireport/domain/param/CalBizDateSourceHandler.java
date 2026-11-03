package com.mis.aireport.domain.param;

import com.mis.aireport.datasource.spm.bigdata.SpmSlotFetchService;
import com.mis.aireport.datasource.spm.bigdata.SpmSlotOption;
import com.mis.aireport.domain.entity.AiParamSource;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;

import java.util.List;

/**
 * 超市经营日：经 {@code spm-big-data} SQL（ADS 日表），不经本地日历表。
 */
@Component("CalBizDateSourceHandler")
public class CalBizDateSourceHandler implements ParamSourceHandler {

    private final SpmSlotFetchService slotFetchService;

    public CalBizDateSourceHandler(SpmSlotFetchService slotFetchService) {
        this.slotFetchService = slotFetchService;
    }

    @Override
    public String beanName() {
        return "CalBizDateSourceHandler";
    }

    @Override
    public ParamResolveResult resolve(Long userId, AiParamSource source) {
        List<ParamOption> options = slotFetchService.fetchBizDatesDefaultWindow(userId).stream()
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
        return slotFetchService.fetchBizDatesDefaultWindow(userId).stream()
                .anyMatch(o -> value.equals(o.value()));
    }

    private ParamOption toOption(SpmSlotOption o) {
        return new ParamOption(o.value(), o.label(), o.extra());
    }
}
