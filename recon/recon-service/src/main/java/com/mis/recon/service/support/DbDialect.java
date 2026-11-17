package com.mis.recon.service.support;

/**
 * 源库方言适配（F83，技术适配 §2.7）。
 * <ul>
 *   <li>分页：不在 SQL 中拼分页子句，统一由调用方 JDBC setMaxRows(limit) 限行
 *       （Oracle 11g 不支持 FETCH FIRST；嵌套 ROWNUM 包装对部分 11g 解析敏感；
 *       MySQL/PG 也无完全一致的分页语法，setMaxRows 全方言兼容）</li>
 *   <li>键集分页：二元组 (time_field, keyset_pk_field)（T04-spec G3），禁 OFFSET</li>
 *   <li>时钟探针：mysql NOW(3) / oracle SYSTIMESTAMP / pg now()</li>
 * </ul>
 */
public enum DbDialect {

    mysql {
        @Override
        public String clockProbeSql() {
            return "SELECT NOW(3)";
        }

        @Override
        public String quote(String ident) {
            // MySQL 标识符须用反引号；双引号默认是字符串字面量（除非 ANSI_QUOTES）
            return "`" + ident + "`";
        }
    },
    postgresql {
        @Override
        public String clockProbeSql() {
            return "SELECT now()";
        }
    },
    oracle {
        @Override
        public String clockProbeSql() {
            return "SELECT SYSTIMESTAMP FROM DUAL";
        }

        @Override
        public String quote(String ident) {
            // Oracle 不加引号的标识符折叠为大写且大小写不敏感；双引号反而强制区分大小写，
            // 会与标准大写列名（PAY_TIME）匹配不上 → ORA-00904。故原样返回。
            return ident;
        }

        /**
         * Oracle 键集分页：表别名禁用 AS 关键字；别名须字母开头（Oracle 未加引号标识符
         * 不允许以下划线等开头，否则 ORA-00911 无效字符）；分页交给 JDBC setMaxRows。
         */
        @Override
        public String wrapKeyset(String sql, Object[] windowArgs, String timeField, String pkField, int limit) {
            String qT = quote(timeField);
            String qP = quote(pkField);
            return "SELECT * FROM ( " + sql + " ) t"
                    + " WHERE t." + qT + " > ? OR (t." + qT + " = ? AND t." + qP + " > ?)"
                    + " ORDER BY t." + qT + ", t." + qP;
        }
    };

    /** 时钟探针 SQL（源库当前时间，clock_skew 用）。 */
    public abstract String clockProbeSql();

    /**
     * 键集分页包装（G3）：窗口 SQL 作为子查询，外层加二元组键集过滤 + 排序。
     * <p>不拼接 LIMIT/ROWNUM——行数上限由调用方 JDBC setMaxRows(limit) 控制
     * （见 SourceFetcher，与 SQL 检测同逻辑，全部方言兼容）。</p>
     * <p>SQL 形态（PG/MySQL）：</p>
     * <pre>
     * SELECT * FROM ( 原窗口SQL ) AS t
     * WHERE t."time_field" &gt; ? OR (t."time_field" = ? AND t."pk_field" &gt; ?)
     * ORDER BY t."time_field", t."pk_field"
     * </pre>
     * 参数序：{windowArgs..., lastTime, lastTime, lastPk}（limit 由 JDBC 控制，不入参）。
     *
     * @param sql       原窗口 SQL（已绑定 :p_start/:p_end → ?）
     * @param windowArgs 窗口参数值（SqlParamBinder 产出的 args，前置）
     * @param timeField 键集时间列（ds.time_field）
     * @param pkField   键集第二列（keyset_pk_field）
     * @param limit     每批行数上限（由调用方经 setMaxRows 施加）
     */
    public String wrapKeyset(String sql, Object[] windowArgs, String timeField, String pkField, int limit) {
        String qT = quote(timeField);
        String qP = quote(pkField);
        return "SELECT * FROM ( " + sql + " ) AS t"
                + " WHERE t." + qT + " > ? OR (t." + qT + " = ? AND t." + qP + " > ?)"
                + " ORDER BY t." + qT + ", t." + qP;
    }

    /**
     * 标识符引用：PG 双引号（保留大小写）；MySQL 反引号；Oracle 原样返回（不加引号折叠大写、大小写不敏感）。
     */
    public String quote(String ident) {
        return "\"" + ident + "\"";
    }

    /** 按连接 type 解析；非法抛 IllegalArgumentException（调用方转 7008）。 */
    public static DbDialect from(String type) {
        for (DbDialect d : values()) {
            if (d.name().equalsIgnoreCase(type)) {
                return d;
            }
        }
        throw new IllegalArgumentException("不支持的连接类型: " + type);
    }
}
