package com.mis.recon.util;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 相对窗口表达式解析（与前端 check-form RELATIVE_PRESETS 同口径，参考《对账框架V3》§6.3）：
 * <ul>
 *   <li>{recon_time}：运行时刻 now</li>
 *   <li>{recon_time}-Nd：now 往前 N 天（前端「自定义 N 天前 ~ 结束」）</li>
 *   <li>{yesterday_start} / {yesterday_end}：昨天全天，[昨日00:00, 今日00:00) 半开区间（台账查询 record_time &lt; end）</li>
 *   <li>{trans_date}：今日 00:00</li>
 *   <li>{month_start}：本月 1 日 00:00</li>
 *   <li>{last_month_start} / {last_month_end}：上个月，[上月1日00:00, 本月1日00:00)</li>
 * </ul>
 * 其余一律按绝对时间 yyyy-MM-dd HH:mm:ss 由调用方解析。
 */
public final class WindowExprResolver {

    private static final Pattern RECON_TIME_OFFSET = Pattern.compile("^\\{recon_time\\}-(\\d+)d$");

    private WindowExprResolver() {
    }

    /** 是否为受支持的相对窗口表达式（花括号包裹）；否则视为绝对时间串。 */
    public static boolean isRelative(String expr) {
        if (expr == null || expr.isBlank()) {
            return false;
        }
        String e = expr.trim();
        return e.startsWith("{") && e.endsWith("}");
    }

    /**
     * 相对表达式 → 绝对时间；无法识别返回 null。
     *
     * @param expr 相对表达式（如 {yesterday_start}、{recon_time}-7d）
     * @param now  解析基准时刻（运行时刻 / 校验时刻）
     */
    public static LocalDateTime resolve(String expr, LocalDateTime now) {
        if (expr == null || expr.isBlank()) {
            return null;
        }
        String e = expr.trim();
        LocalDate today = now.toLocalDate();
        switch (e) {
            case "{recon_time}":
                return now;
            case "{yesterday_start}":
                return today.minusDays(1).atStartOfDay();
            case "{yesterday_end}":
                return today.atStartOfDay();
            case "{trans_date}":
                return today.atStartOfDay();
            case "{month_start}":
                return today.withDayOfMonth(1).atStartOfDay();
            case "{last_month_start}":
                return today.withDayOfMonth(1).minusMonths(1).atStartOfDay();
            case "{last_month_end}":
                return today.withDayOfMonth(1).atStartOfDay();
            default:
                Matcher m = RECON_TIME_OFFSET.matcher(e);
                if (m.matches()) {
                    return now.minusDays(Long.parseLong(m.group(1)));
                }
                return null;
        }
    }
}
