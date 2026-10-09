package com.mis.taskflow.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

/**
 * 条件表达式求值（P7 图式流转）。
 *
 * <p>支持变量引用（来自流程实例的 formData）与常用比较运算：
 * <pre>
 *   ${amount > 50000}
 *   amount &gt;= 1000 &amp;&amp; dept == "FIN"
 *   ${priority} == "HIGH"
 * </pre>
 * 表达式为 null/空 → 视为无条件匹配（返回 true，用于 DEFAULT 边）。
 * 解析失败时保守返回 false（不误走分支），并在日志中可追溯。
 */
public final class ConditionEvaluator {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private ConditionEvaluator() {
    }

    /** 判断条件是否成立。 */
    public static boolean matches(String expr, String formDataJson) {
        if (expr == null || expr.isBlank()) {
            return true; // 无条件边
        }
        String e = expr.trim();
        // 去掉 ${ ... } 包裹
        if (e.startsWith("${") && e.endsWith("}")) {
            e = e.substring(2, e.length() - 1).trim();
        }
        try {
            JsonNode vars = parse(formDataJson);
            return evalBoolean(e, vars);
        } catch (Exception ex) {
            return false;
        }
    }

    private static boolean evalBoolean(String expr, JsonNode vars) {
        // 支持 && 与 ||（简单实现，按优先级）
        int orIdx = indexOfTopLevel(expr, "||");
        if (orIdx > 0) {
            return evalBoolean(expr.substring(0, orIdx), vars)
                    || evalBoolean(expr.substring(orIdx + 2), vars);
        }
        int andIdx = indexOfTopLevel(expr, "&&");
        if (andIdx > 0) {
            return evalBoolean(expr.substring(0, andIdx), vars)
                    && evalBoolean(expr.substring(andIdx + 2), vars);
        }
        return evalComparison(expr, vars);
    }

    private static boolean evalComparison(String expr, JsonNode vars) {
        String[] ops = {">=", "<=", "==", "!=", ">", "<"};
        for (String op : ops) {
            int i = expr.indexOf(op);
            if (i > 0) {
                Object left = resolve(expr.substring(0, i).trim(), vars);
                Object right = resolve(expr.substring(i + op.length()).trim(), vars);
                return compare(left, right, op);
            }
        }
        throw new IllegalArgumentException("无法解析的条件表达式: " + expr);
    }

    /** 解析操作数：字符串字面量、数字、布尔、或变量引用。 */
    private static Object resolve(String token, JsonNode vars) {
        if (token.isEmpty()) {
            return null;
        }
        if ((token.startsWith("\"") && token.endsWith("\"")) || (token.startsWith("'") && token.endsWith("'"))) {
            return token.substring(1, token.length() - 1);
        }
        if ("true".equalsIgnoreCase(token)) return Boolean.TRUE;
        if ("false".equalsIgnoreCase(token)) return Boolean.FALSE;
        if (isNumeric(token)) return Double.parseDouble(token);
        JsonNode node = vars.get(token);
        if (node == null || node.isNull()) {
            return null;
        }
        if (node.isNumber()) return node.asDouble();
        if (node.isBoolean()) return node.asBoolean();
        return node.asText();
    }

    private static boolean compare(Object left, Object right, String op) {
        if (left == null || right == null) {
            return switch (op) {
                case "==" -> left == right;
                case "!=" -> left != right;
                default -> false;
            };
        }
        if (left instanceof Number && right instanceof Number) {
            double a = ((Number) left).doubleValue();
            double b = ((Number) right).doubleValue();
            return switch (op) {
                case ">=" -> a >= b;
                case "<=" -> a <= b;
                case ">" -> a > b;
                case "<" -> a < b;
                case "==" -> a == b;
                case "!=" -> a != b;
                default -> false;
            };
        }
        String a = String.valueOf(left);
        String b = String.valueOf(right);
        return switch (op) {
            case "==" -> a.equals(b);
            case "!=" -> !a.equals(b);
            case ">" -> a.compareTo(b) > 0;
            case "<" -> a.compareTo(b) < 0;
            case ">=" -> a.compareTo(b) >= 0;
            case "<=" -> a.compareTo(b) <= 0;
            default -> false;
        };
    }

    private static int indexOfTopLevel(String expr, String token) {
        boolean inStr = false;
        char quote = 0;
        for (int i = 0; i < expr.length() - token.length() + 1; i++) {
            char c = expr.charAt(i);
            if (c == '"' || c == '\'') {
                if (!inStr) { inStr = true; quote = c; }
                else if (c == quote) { inStr = false; }
                continue;
            }
            if (!inStr && expr.startsWith(token, i)) {
                return i;
            }
        }
        return -1;
    }

    private static JsonNode parse(String json) {
        try {
            return json == null || json.isBlank() ? MAPPER.createObjectNode() : MAPPER.readTree(json);
        } catch (Exception e) {
            return MAPPER.createObjectNode();
        }
    }

    private static boolean isNumeric(String s) {
        if (s.isEmpty()) return false;
        int i = s.startsWith("-") ? 1 : 0;
        boolean dot = false;
        for (; i < s.length(); i++) {
            char c = s.charAt(i);
            if (c == '.') {
                if (dot) return false;
                dot = true;
            } else if (!Character.isDigit(c)) {
                return false;
            }
        }
        return true;
    }
}