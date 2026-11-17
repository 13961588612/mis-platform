package com.mis.recon.util;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * 表达式求值器（F24，T05-spec-sum-check §5）：sum_check 勾稽用四则运算（+ - * / ( )）求值。
 * <p>递归下降解析（tokenize → expression/term/factor 三级），运算全用 BigDecimal：</p>
 * <ul>
 *   <li>失败（缺失字段/非法语法/除零/括号不配对/空表达式）一律返回 null，不抛异常；</li>
 *   <li>操作数：alias.field 字段引用（取 fieldValues 键，缺失 → null）或十进制数字；</li>
 *   <li>单目负号 -x 实现为 0 - x；单目正号不支持（a + + b 视为非法）；</li>
 *   <li>除法：结果按 6 位小数 HALF_UP（与 CompareEngine 比例容差除法口径一致）；除零 → null。</li>
 * </ul>
 */
public final class ExpressionEvaluator {

    /** 除法结果小数位（金额除法精度，共享知识 #1 金额三态律 P-2） */
    private static final int DIVIDE_SCALE = 6;

    private ExpressionEvaluator() {
    }

    /**
     * 求值表达式；任何失败返回 null。
     *
     * @param expr        表达式，如 "orders.total_amount" / "orders.a + orders.b - orders.c"
     * @param fieldValues 字段值 map（键 = alias.field）；null 安全
     */
    public static BigDecimal evaluate(String expr, Map<String, BigDecimal> fieldValues) {
        if (expr == null || expr.isBlank()) {
            return null;
        }
        List<Token> tokens = tokenize(expr);
        if (tokens == null || tokens.isEmpty()) {
            return null;
        }
        Parser parser = new Parser(tokens, fieldValues);
        BigDecimal value = parser.parseExpression();
        // 表达式必须完整消费全部 token；残留说明语法非法（如 "a b"）
        if (value == null || !parser.atEnd()) {
            return null;
        }
        return value;
    }

    // ---- 词法 ----

    private enum TokenType { NUMBER, FIELD, OP }

    private static class Token {
        final TokenType type;
        final String text;
        final BigDecimal number;

        Token(TokenType type, String text, BigDecimal number) {
            this.type = type;
            this.text = text;
            this.number = number;
        }
    }

    /** 分词：空白跳过；数字 / alias.field 标识符 / 运算符；未知字符 → null（非法）。 */
    private static List<Token> tokenize(String expr) {
        List<Token> tokens = new ArrayList<>();
        int i = 0;
        int n = expr.length();
        while (i < n) {
            char ch = expr.charAt(i);
            if (Character.isWhitespace(ch)) {
                i++;
                continue;
            }
            if (Character.isDigit(ch) || (ch == '.' && i + 1 < n && Character.isDigit(expr.charAt(i + 1)))) {
                int j = i;
                while (j < n && (Character.isDigit(expr.charAt(j)) || expr.charAt(j) == '.')) {
                    j++;
                }
                String num = expr.substring(i, j);
                try {
                    tokens.add(new Token(TokenType.NUMBER, num, new BigDecimal(num)));
                } catch (NumberFormatException e) {
                    return null;
                }
                i = j;
                continue;
            }
            if (Character.isLetter(ch) || ch == '_') {
                int j = i;
                while (j < n && (Character.isLetterOrDigit(expr.charAt(j))
                        || expr.charAt(j) == '_' || expr.charAt(j) == '.')) {
                    j++;
                }
                tokens.add(new Token(TokenType.FIELD, expr.substring(i, j), null));
                i = j;
                continue;
            }
            if ("+-*/()".indexOf(ch) >= 0) {
                tokens.add(new Token(TokenType.OP, String.valueOf(ch), null));
                i++;
                continue;
            }
            return null;
        }
        return tokens;
    }

    // ---- 语法（递归下降） ----

    private static class Parser {
        private final List<Token> tokens;
        private final Map<String, BigDecimal> fieldValues;
        private int pos;

        Parser(List<Token> tokens, Map<String, BigDecimal> fieldValues) {
            this.tokens = tokens;
            this.fieldValues = fieldValues;
        }

        boolean atEnd() {
            return pos >= tokens.size();
        }

        boolean isOp(String... ops) {
            Token t = peek();
            if (t == null || t.type != TokenType.OP) {
                return false;
            }
            for (String op : ops) {
                if (op.equals(t.text)) {
                    return true;
                }
            }
            return false;
        }

        Token peek() {
            return atEnd() ? null : tokens.get(pos);
        }

        /** expression := term (('+' | '-') term)* */
        BigDecimal parseExpression() {
            BigDecimal left = parseTerm();
            if (left == null) {
                return null;
            }
            while (isOp("+", "-")) {
                String op = peek().text;
                pos++;
                BigDecimal right = parseTerm();
                if (right == null) {
                    return null;
                }
                left = "+".equals(op) ? left.add(right) : left.subtract(right);
            }
            return left;
        }

        /** term := factor (('*' | '/') factor)* */
        BigDecimal parseTerm() {
            BigDecimal left = parseFactor();
            if (left == null) {
                return null;
            }
            while (isOp("*", "/")) {
                String op = peek().text;
                pos++;
                BigDecimal right = parseFactor();
                if (right == null) {
                    return null;
                }
                if ("*".equals(op)) {
                    left = left.multiply(right);
                } else {
                    if (right.compareTo(BigDecimal.ZERO) == 0) {
                        return null;   // 除零 → 失败
                    }
                    left = left.divide(right, DIVIDE_SCALE, RoundingMode.HALF_UP);
                }
            }
            return left;
        }

        /** factor := '-' factor | '(' expression ')' | NUMBER | FIELD */
        BigDecimal parseFactor() {
            if (isOp("-")) {
                pos++;
                BigDecimal v = parseFactor();
                return v == null ? null : BigDecimal.ZERO.subtract(v);   // 单目负号 = 0 - x
            }
            Token t = peek();
            if (t == null) {
                return null;
            }
            if (t.type == TokenType.NUMBER) {
                pos++;
                return t.number;
            }
            if (t.type == TokenType.FIELD) {
                pos++;
                return fieldValues == null ? null : fieldValues.get(t.text);   // 缺失字段 → null
            }
            if (isOp("(")) {
                pos++;
                BigDecimal v = parseExpression();
                if (v == null) {
                    return null;
                }
                if (!isOp(")")) {
                    return null;   // 括号不配对
                }
                pos++;
                return v;
            }
            return null;   // 非法 token（含单目正号 +）
        }
    }
}
