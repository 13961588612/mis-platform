package com.mis.recon.service.support;

import com.mis.recon.common.BizException;
import com.mis.recon.common.ErrorCode;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * SQL 参数绑定器（F84，G2 归一）。
 * <p>把命名参数 / 花括号占位符翻译为 JDBC 预编译 `?`：</p>
 * <ul>
 *   <li>命名参数：`:p_start` / `:p_end` / `:p_last_pk`（配置文档 + T03 V20 校验口径，权威）</li>
 *   <li>花括号兼容：`{time_start}` / `{time_end}` / `{record_key}`（需求说明书 UI 口径）</li>
 * </ul>
 * <p>禁字符串拼接、禁自写 DATE_FORMAT/TO_DATE（共享知识 #4）；时间参数传 java.sql.Timestamp。</p>
 */
public final class SqlParamBinder {

    /** 绑定结果：全 ? 占位 SQL + 按出现序参数值。 */
    public static class BoundSql {
        public final String sql;
        public final Object[] args;
        BoundSql(String sql, Object[] args) {
            this.sql = sql;
            this.args = args;
        }
    }

    private static final Pattern NAMED = Pattern.compile("(?<![A-Za-z0-9_]):([A-Za-z0-9_]+)");
    private static final Pattern BRACED = Pattern.compile("\\{([A-Za-z0-9_]+)\\}");

    private SqlParamBinder() {
    }

    /**
     * 绑定命名/花括号占位符。
     *
     * @param sql    含占位符的 SQL 模板
     * @param params 参数值 Map（key：p_start / p_end / p_last_pk / record_key / time_start / time_end）
     * @return BoundSql
     * @throws BizException 7007：占位符无对应参数值
     */
    public static BoundSql bind(String sql, Map<String, Object> params) {
        // 归一化换行：把 Windows 回车符 \r 统一为 \n（语义不变）。
        // Oracle JDBC 把 \r 判为非法字符（ORA-00911），从文档/表单复制的 fetch_sql 常带 \r\n。
        sql = sql.replace("\r\n", "\n").replace('\r', '\n');
        StringBuilder sb = new StringBuilder(sql.length() + 16);
        List<Object> args = new ArrayList<>();
        int last = 0;
        Matcher m = NAMED.matcher(sql);
        while (m.find()) {
            sb.append(sql, last, m.start()).append('?');
            args.add(resolve(m.group(1), params));
            last = m.end();
        }
        sb.append(sql, last, sql.length());
        String afterNamed = sb.toString();
        // 花括号兼容（命名参数替换后再处理花括号，两者不会重叠）
        sb.setLength(0);
        last = 0;
        Matcher b = BRACED.matcher(afterNamed);
        while (b.find()) {
            sb.append(afterNamed, last, b.start()).append('?');
            args.add(resolve(b.group(1), params));
            last = b.end();
        }
        sb.append(afterNamed, last, afterNamed.length());
        return new BoundSql(sb.toString(), args.toArray());
    }

    private static Object resolve(String key, Map<String, Object> params) {
        if (params.containsKey(key)) {
            return params.get(key);
        }
        // 同义键归一：time_start/p_start、time_end/p_end 等价
        String alias = switch (key) {
            case "time_start" -> "p_start";
            case "time_end" -> "p_end";
            default -> key;
        };
        if (params.containsKey(alias)) {
            return params.get(alias);
        }
        throw new BizException(ErrorCode.WINDOW_PARAM_BIND_FAILED, "占位符无绑定值: " + key);
    }
}
