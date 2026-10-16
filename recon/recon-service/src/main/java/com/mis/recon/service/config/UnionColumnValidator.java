package com.mis.recon.service.config;

import com.mis.recon.common.BizException;
import com.mis.recon.common.ErrorCode;
import org.springframework.util.StringUtils;

import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * V34 UNION 列名对齐律的文本级校验（ConfigValidationService 子功能拆分，满足单文件 300 行门禁）。
 * 顶层 UNION 正则切分，括号内/字符串内 UNION 的精确处理为 T04 增强项（规格风险 9）；
 * MVP 取数 SQL 为受控模板，文本级覆盖验收场景。
 */
final class UnionColumnValidator {

    private static final Pattern UNION_RE = Pattern.compile("(?i)\\bUNION\\b");

    private UnionColumnValidator() {
    }

    /** 校验失败抛 6205；无 UNION 或无法切分时静默返回。 */
    static void validate(String sql) {
        if (!StringUtils.hasText(sql)) {
            return;
        }
        Matcher m = UNION_RE.matcher(sql);
        if (!m.find()) {
            return;
        }
        String leftCols = extractSelectColumns(sql.substring(0, m.start()));
        String rightCols = extractSelectColumns(sql.substring(m.end()));
        if (leftCols == null || rightCols == null) {
            return;
        }
        String[] l = leftCols.split(",");
        String[] r = rightCols.split(",");
        for (String[] arr : new String[][]{l, r}) {
            for (String col : arr) {
                if (col.trim().equals("*")) {
                    throw new BizException(ErrorCode.V34_UNION_COLUMN_ALIGN,
                            "UNION 多表取数禁止 SELECT *，两侧必须显式列出列名并按名对齐。列名漂移会导致 UNION 按位置对齐时语义错位。");
                }
            }
        }
        if (l.length != r.length) {
            throw new BizException(ErrorCode.V34_UNION_COLUMN_ALIGN, "UNION 两侧列数不相等，无法按列名对齐");
        }
        for (int i = 0; i < l.length; i++) {
            if (!normalizeColumn(l[i]).equals(normalizeColumn(r[i]))) {
                throw new BizException(ErrorCode.V34_UNION_COLUMN_ALIGN,
                        "UNION 两侧列名未按名对齐: " + l[i].trim() + " vs " + r[i].trim());
            }
        }
    }

    /** 供 UnionAmountTypeValidator（V35 T04）复用：提取 SELECT 列清单。 */
    static String extractSelectColumns(String side) {
        int sel = indexOfIgnoreCase(side, "select");
        if (sel < 0) {
            return null;
        }
        int from = indexOfIgnoreCase(side, " from ");
        int join = indexOfIgnoreCase(side, " join ");
        int end = from >= 0 && join >= 0 ? Math.min(from, join) : Math.max(from, join);
        if (end <= sel) {
            return null;
        }
        String cols = side.substring(sel + 6, end).trim();
        if (cols.regionMatches(true, 0, "all", 0, 3)) {
            cols = cols.substring(3).trim();
        }
        if (cols.regionMatches(true, 0, "distinct", 0, 8)) {
            cols = cols.substring(8).trim();
        }
        return cols;
    }

    /** 供 UnionAmountTypeValidator（V35 T04）复用：列名规范化（去别名/表前缀/转小写）。 */
    static String normalizeColumn(String col) {
        String c = col.trim();
        int as = indexOfIgnoreCase(c, " as ");
        if (as >= 0) {
            c = c.substring(0, as).trim();
        }
        int dot = c.lastIndexOf('.');
        if (dot >= 0) {
            c = c.substring(dot + 1).trim();
        }
        return c.toLowerCase();
    }

    private static int indexOfIgnoreCase(String text, String word) {
        return text.toLowerCase().indexOf(word.toLowerCase());
    }
}
