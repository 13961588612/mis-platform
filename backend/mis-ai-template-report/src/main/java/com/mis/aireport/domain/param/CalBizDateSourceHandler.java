package com.mis.aireport.domain.param;

import com.mis.aireport.domain.entity.AiParamSource;
import com.mis.aireport.domain.entity.AiReportCalendarDay;
import com.mis.aireport.domain.repository.AiReportCalendarDayRepository;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;

import java.time.LocalDate;
import java.util.List;
import java.util.Map;

@Component("CalBizDateSourceHandler")
public class CalBizDateSourceHandler implements ParamSourceHandler {

    private final AiReportCalendarDayRepository dayRepository;

    public CalBizDateSourceHandler(AiReportCalendarDayRepository dayRepository) {
        this.dayRepository = dayRepository;
    }

    @Override
    public String beanName() {
        return "CalBizDateSourceHandler";
    }

    @Override
    public ParamResolveResult resolve(Long userId, AiParamSource source) {
        int lookback = configInt(source, "lookback_days", 90);
        LocalDate from = LocalDate.now().minusDays(lookback);
        List<AiReportCalendarDay> days =
                dayRepository.findByEnabledAndBizDateGreaterThanEqualOrderByBizDateDesc(1, from);
        List<ParamOption> options = days.stream()
                .map(d -> new ParamOption(d.getBizDate().toString(), d.getLabel()))
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
        try {
            LocalDate date = LocalDate.parse(value.trim());
            return dayRepository.findById(date).filter(d -> d.getEnabled() != null && d.getEnabled() == 1).isPresent();
        } catch (Exception ex) {
            return false;
        }
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
