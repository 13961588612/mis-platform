package com.mis.recon.util;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * record_key / 匹配键模板表达式求值（三层键·存储层）。
 * <p>语法：{field} 占位；复合键 {f1}_{f2}（分隔符为模板字面量，可 `_` / `-` / 自定义文本）。</p>
 * <ul>
 *   <li>evaluate：Java 侧现算，源行数据 → 拼接键；缺失字段 → null（键不可缺，上层记 error 行）</li>
 *   <li>extractFields：按出现顺序提取 {field}，供 DbDialect 键集分页取默认 pk 列（T04-spec G3）</li>
 * </ul>
 */
public final class KeyExprEvaluator {

    private static final Pattern FIELD = Pattern.compile("\\{([A-Za-z0-9_]+)\\}");

    private KeyExprEvaluator() {
    }

    /**
     * 模板表达式 → 拼接值。
     *
     * @param expr record_key_expression（如 "{order_no}" 或 "{order_no}_{pay_channel}"）
     * @param row  源行数据（key=输出列名/源字段名，value 任意类型）
     * @return 拼接键；表达式含缺失字段 → null
     */
    public static String evaluate(String expr, Map<String, Object> row) {
        if (expr == null || expr.isBlank() || row == null) {
            return null;
        }
        Matcher m = FIELD.matcher(expr);
        StringBuilder sb = new StringBuilder(expr.length());
        int last = 0;
        while (m.find()) {
            sb.append(expr, last, m.start());
            String field = m.group(1);
            Object value = row.get(field);
            if (value == null) {
                return null;   // 键不可缺
            }
            sb.append(value);
            last = m.end();
        }
        sb.append(expr, last, expr.length());
        return sb.toString();
    }

    /**
     * 提取模板全部 {field}（按出现顺序，去重由调用方自理）。
     */
    public static List<String> extractFields(String expr) {
        List<String> fields = new ArrayList<>();
        if (expr == null) {
            return fields;
        }
        Matcher m = FIELD.matcher(expr);
        while (m.find()) {
            fields.add(m.group(1));
        }
        return fields;
    }
}
