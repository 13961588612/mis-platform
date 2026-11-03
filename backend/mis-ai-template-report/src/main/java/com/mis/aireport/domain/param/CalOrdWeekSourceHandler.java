package com.mis.aireport.domain.param;

import com.mis.aireport.domain.entity.AiParamSource;
import com.mis.aireport.domain.entity.AiReportCalendarWeek;
import com.mis.aireport.domain.repository.AiReportCalendarWeekRepository;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;

import java.time.LocalDate;
import java.util.List;
import java.util.Map;

@Component("CalOrdWeekSourceHandler")
public class CalOrdWeekSourceHandler implements ParamSourceHandler {

    private final AiReportCalendarWeekRepository weekRepository;

    public CalOrdWeekSourceHandler(AiReportCalendarWeekRepository weekRepository) {
        this.weekRepository = weekRepository;
    }

    @Override
    public String beanName() {
        return "CalOrdWeekSourceHandler";
    }

    @Override
    public ParamResolveResult resolve(Long userId, AiParamSource source) {
        int lookback = configInt(source, "lookback_weeks", 26);
        LocalDate from = LocalDate.now().minusWeeks(lookback);
        List<AiReportCalendarWeek> weeks =
                weekRepository.findByEnabledAndWeekStartGreaterThanEqualOrderByWeekStartDesc(1, from);
        List<ParamOption> options = weeks.stream()
                .map(w -> new ParamOption(w.getOrdWeek(), w.getLabel()))
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
                && weekRepository.findByOrdWeekAndEnabled(value.trim(), 1).isPresent();
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
