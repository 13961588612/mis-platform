package com.mis.recon.domain.enums;

import com.mis.recon.common.BizException;
import com.mis.recon.common.ErrorCode;

/**
 * 配置类枚举（F25）：常量名即 DDL 落库值（code=name，G18），JSON 序列化用 Jackson 默认 name()。
 * 非法值抛 BizException(6211) 且 message 带合法值列表（前端可直接展示）。
 */
public final class ConfigEnums {

    private ConfigEnums() {
    }

    /** 取数方式（MVP 只实现 db） */
    public enum FetchType {
        db, api, custom;

        public static FetchType from(String value) {
            return parse(FetchType.class, value, "db/api/custom");
        }

        public String code() {
            return name();
        }
    }

    /** 业务库类型（决定分页方言） */
    public enum ConnectionType {
        mysql, oracle, postgresql;

        public static ConnectionType from(String value) {
            return parse(ConnectionType.class, value, "mysql/oracle/postgresql");
        }

        public String code() {
            return name();
        }
    }

    /** 匹配策略（fuzzy 全量保留，仅界面收敛可选项） */
    public enum MatchStrategy {
        exact_key, composite_key, sum_check, fuzzy, chain, custom, custom_check;

        public static MatchStrategy from(String value) {
            return parse(MatchStrategy.class, value, "exact_key/composite_key/sum_check/fuzzy/chain/custom/custom_check");
        }

        public String code() {
            return name();
        }
    }

    /** 同键多行策略 */
    public enum MultiRowPolicy {
        aggregate, latest, reject;

        public static MultiRowPolicy from(String value) {
            return parse(MultiRowPolicy.class, value, "aggregate/latest/reject");
        }

        public String code() {
            return name();
        }
    }

    /** 消费模式 */
    public enum ConsumeMode {
        incremental, time_window;

        public static ConsumeMode from(String value) {
            return parse(ConsumeMode.class, value, "incremental/time_window");
        }

        public String code() {
            return name();
        }
    }

    /** 数据就绪门类型 */
    public enum GateType {
        flag_query, row_count_delta, app_callback, stability_window;

        public static GateType from(String value) {
            return parse(GateType.class, value, "flag_query/row_count_delta/app_callback/stability_window");
        }

        public String code() {
            return name();
        }
    }

    /** 退款标记规则 */
    public enum RefundSignRule {
        same_table_negative, same_table_type_col, separate_table, none;

        public static RefundSignRule from(String value) {
            return parse(RefundSignRule.class, value, "same_table_negative/same_table_type_col/separate_table/none");
        }

        public String code() {
            return name();
        }
    }

    /** 数据粒度 */
    public enum Grain {
        row, aggregated;

        public static Grain from(String value) {
            return parse(Grain.class, value, "row/aggregated");
        }

        public String code() {
            return name();
        }
    }

    /** 删除模式 */
    public enum DeleteMode {
        unknown, none, soft, physical;

        public static DeleteMode from(String value) {
            return parse(DeleteMode.class, value, "unknown/none/soft/physical");
        }

        public String code() {
            return name();
        }
    }

    private static <E extends Enum<E>> E parse(Class<E> type, String value, String legal) {
        if (value == null) {
            throw new BizException(ErrorCode.INVALID_ENUM_VALUE, type.getSimpleName() + " 不能为空");
        }
        try {
            return Enum.valueOf(type, value.trim());
        } catch (IllegalArgumentException e) {
            throw new BizException(ErrorCode.INVALID_ENUM_VALUE, type.getSimpleName() + " 非法: " + value + "，合法值: " + legal);
        }
    }
}
