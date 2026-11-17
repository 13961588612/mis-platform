package com.mis.recon.service.config;

import com.mis.recon.common.BizException;
import com.mis.recon.common.ErrorCode;
import com.mis.recon.service.support.ConnectionPoolManager;
import org.springframework.util.StringUtils;

import javax.sql.DataSource;
import java.sql.Connection;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * V35 UNION 金额字段类型校验（T04 落地，2026-08-29）。
 * <p>文本层 V34 只保证 UNION 两侧列名按名对齐；本类连源库 DatabaseMetaData 校验两侧
 * 同名列的字段类型档位一致（精确小数 DECIMAL/NUMERIC/NUMBER/MONEY 与整数 INTEGER 族不得混拼），
 * 防止 UNION 隐式转换导致金额精度丢失/错位。</p>
 * <p>宽容性（保持 T03「能力可及子集」）：连接失败 / 元数据查询异常 / 列查不到 / 任一侧
 * 为非数值档位（浮点、字符串等）时一律静默放行，不阻塞配置保存。</p>
 */
final class UnionAmountTypeValidator {

    private static final Pattern UNION_RE = Pattern.compile("(?i)\\bUNION\\b");
    /** 每侧第一个 FROM/JOIN 表（MVP 单表/简单 JOIN 取首表；子查询表名视为复杂场景放行）。 */
    private static final Pattern TABLE_RE =
            Pattern.compile("(?i)\\b(?:from|join)\\s+([A-Za-z0-9_\"`\\[\\]]+(?:\\.[A-Za-z0-9_\"`\\[\\]]+)?)");

    private UnionAmountTypeValidator() {
    }

    /** 校验失败抛 6206；无 UNION / 无连接 / 查不到类型 / 非数值档位时静默放行。 */
    static void validate(ConnectionPoolManager pool, String connCode, String sql) {
        if (pool == null || !StringUtils.hasText(connCode) || !StringUtils.hasText(sql)) {
            return;
        }
        Matcher m = UNION_RE.matcher(sql);
        if (!m.find()) {
            return;
        }
        String leftSql = sql.substring(0, m.start());
        String rightSql = sql.substring(m.end());
        String leftCols = UnionColumnValidator.extractSelectColumns(leftSql);
        String rightCols = UnionColumnValidator.extractSelectColumns(rightSql);
        String leftTable = extractTable(leftSql);
        String rightTable = extractTable(rightSql);
        if (leftCols == null || rightCols == null || leftTable == null || rightTable == null) {
            return;
        }
        String[] l = leftCols.split(",");
        String[] r = rightCols.split(",");
        if (l.length != r.length) {
            return;   // 列数不等已由 V34 拦截
        }
        DataSource ds;
        try {
            ds = pool.getDataSource(connCode);
        } catch (RuntimeException e) {
            return;   // 连接不可用：宽容放行
        }
        if (ds == null) {
            return;
        }
        try (Connection c = ds.getConnection()) {
            for (int i = 0; i < l.length; i++) {
                String colL = UnionColumnValidator.normalizeColumn(l[i]);
                String colR = UnionColumnValidator.normalizeColumn(r[i]);
                String t1 = resolveColumnType(c, leftTable, colL);
                String t2 = resolveColumnType(c, rightTable, colR);
                if (t1 == null || t2 == null) {
                    continue;   // 查不到：宽容放行
                }
                if (!compatible(t1, t2)) {
                    throw new BizException(ErrorCode.V35_UNION_AMOUNT_TYPE,
                            "UNION 两侧金额字段类型必须一致: " + leftTable + "." + colL + "=" + t1
                                    + " vs " + rightTable + "." + colR + "=" + t2);
                }
            }
        } catch (SQLException e) {
            // 元数据查询异常：宽容放行
        }
    }

    /** 提取每侧第一个 FROM/JOIN 表（含 schema 前缀则整体返回，调用方切分）。 */
    private static String extractTable(String side) {
        Matcher m = TABLE_RE.matcher(side);
        return m.find() ? stripQuotes(m.group(1)) : null;
    }

    private static String stripQuotes(String name) {
        return name.replace("\"", "").replace("`", "").replace("[", "").replace("]", "");
    }

    /** 经 JDBC DatabaseMetaData 查列类型（跨 mysql/postgresql/oracle 统一）。查不到返回 null。 */
    private static String resolveColumnType(Connection c, String table, String column) {
        String schema = null;
        String tbl = table;
        int dot = table.indexOf('.');
        if (dot > 0) {
            schema = table.substring(0, dot);
            tbl = table.substring(dot + 1);
        }
        try {
            ResultSet rs = c.getMetaData().getColumns(null, schema, tbl, column);
            if (rs == null) {
                return null;
            }
            try (rs) {
                return rs.next() ? rs.getString("TYPE_NAME") : null;
            }
        } catch (SQLException e) {
            return null;
        }
    }

    /** 数值档位：精确小数 / 整数 / 其他。金额错配只在两档之间判定，OTHER 一律放行。 */
    private static String numericKind(String typeName) {
        String t = typeName == null ? "" : typeName.toUpperCase(Locale.ROOT).trim();
        return switch (t) {
            case "DECIMAL", "NUMERIC", "NUMBER", "MONEY", "SMALLMONEY", "DEC", "FIXED" -> "EXACT_DECIMAL";
            case "TINYINT", "SMALLINT", "INT", "INTEGER", "BIGINT", "MEDIUMINT",
                    "INT1", "INT2", "INT4", "INT8", "SMALLSERIAL", "SERIAL", "BIGSERIAL" -> "INTEGER";
            default -> "OTHER";
        };
    }

    /** 两侧同为精确小数或同为整数则兼容；任一侧非数值档位（浮点/字符串等）则放行。 */
    private static boolean compatible(String t1, String t2) {
        String k1 = numericKind(t1);
        String k2 = numericKind(t2);
        if ("OTHER".equals(k1) || "OTHER".equals(k2)) {
            return true;
        }
        return k1.equals(k2);
    }
}
