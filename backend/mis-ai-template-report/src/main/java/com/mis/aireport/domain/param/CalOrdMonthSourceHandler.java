package com.mis.aireport.domain.param;

import com.mis.aireport.domain.entity.AiParamSource;
import com.mis.aireport.domain.entity.AiReportCalendarMonth;
import com.mis.aireport.domain.repository.AiReportCalendarMonthRepository;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;

import java.time.LocalDate;
import java.util.List;
import java.util.Map;

@Component("CalOrdMonthSourceHandler")
public class CalOrdMonthSourceHandler implements ParamSourceHandler {

    private final AiReportCalendarMonthRepository monthRepository;

    public CalOrdMonthSourceHandler(AiReportCalendarMonthRepository monthRepository) {
        this.monthRepository = monthRepository;
    }

    @Override
    public String beanName() {
        return "CalOrdMonthSourceHandler";
    }

    @Override
    public ParamResolveResult resolve(Long userId, AiParamSource source) {
        int lookback = configInt(source, "lookback_months", 18);
        LocalDate from = LocalDate.now().minusMonths(lookback).withDayOfMonth(1);
        List<AiReportCalendarMonth> months =
                monthRepository.findByEnabledAndMonthStartGreaterThanEqualOrderByMonthStartDesc(1, from);
        List<ParamOption> options = months.stream()
                .map(m -> new ParamOption(m.getOrdMonth(), m.getLabel()))
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
        return StringUtils.hasText(value)
                && monthRepository.findByOrdMonthAndEnabled(value.trim(), 1).isPresent();
    }

    private static int configInt(AiParamSource source, String key, int defaultValue) {
        Map<String, Object> cfg = source.getConfigJson();
        if (cfg == null || cfg.get(key) == null) {
            return defaultValue;
        }
        try {
            return Integer.parseInt(String.valueOf(cfg.get(key)));
        } catch (NumberFormatException ex) {
            return defaultValue;
        }
    }
}
