package com.mis.recon.common;

/**
 * 错误码枚举（G2）：码段 1xxx=通用 / 2xxx=连接 / 3xxx=数据源 / 4xxx=场景 / 5xxx=check / 6xxx=校验 V 规则。
 * 6xxx 段只放「配置保存校验」类错误，前端对 6201~6210 可直接映射到表单校验提示。
 */
public enum ErrorCode {

    // ---- 通用 1xxx ----
    SUCCESS(0, "成功"),
    PARAM_ERROR(1001, "参数校验失败"),
    RESOURCE_NOT_FOUND(1002, "资源不存在"),
    REQUEST_BODY_INVALID(1003, "请求体格式错误"),
    SYSTEM_ERROR(1999, "系统内部错误"),

    // ---- 连接 2xxx ----
    CONN_CODE_EXISTS(2001, "连接编码已存在"),
    CONN_REFERENCED(2002, "连接已被数据源引用，无法删除"),
    CONN_NOT_FOUND(2003, "连接不存在"),
    CONN_TEST_FAILED(2004, "测试连接失败"),

    // ---- 数据源 3xxx ----
    DS_CODE_EXISTS(3001, "数据源编码已存在"),
    DS_NOT_FOUND(3002, "数据源不存在"),
    DS_TEST_FAILED(3003, "数据源测试失败"),
    DS_REFERENCED(3004, "数据源已被 check 引用，无法删除"),   // 预留（T03 不实现删除引用拦截）
    DS_RECORD_KEY_INVALID(3005, "记录键表达式非法"),

    // ---- 场景 4xxx ----
    SCENARIO_CODE_EXISTS(4001, "场景编码已存在"),
    SCENARIO_NOT_FOUND(4002, "场景不存在"),

    // ---- check 5xxx ----
    CHECK_NOT_FOUND(5001, "检查不存在"),
    CHECK_NAME_FROZEN(5002, "check_name 创建后不可修改"),
    ALIAS_CONFLICT(5003, "数据源别名场景内冲突"),
    CHECK_NAME_EXISTS(5004, "场景内检查名已存在"),

    // ---- 校验 V 规则 6xxx ----
    V20_WINDOW_PARAM_MISSING(6201, "取数 SQL 必须包含窗口参数"),
    V21_TOLERANCE_FRACTION(6202, "金额容差必须为整数（单位=分），填小数拒绝"),
    V22_AGG_SQL_HAS_WINDOW(6203, "聚合 SQL 禁止包含窗口参数 :p_start/:p_end"),
    V33_NON_MONETARY_PRIMARY(6204, "积分数/非货币计量字段不能作 primary"),
    V34_UNION_COLUMN_ALIGN(6205, "UNION 多表取数禁止 SELECT *，两侧必须显式列名并按名对齐"),
    V35_UNION_AMOUNT_TYPE(6206, "UNION 两侧金额字段类型必须一致"),
    CONSUME_MODE_MIXED(6207, "同一 check 内所有数据源消费模式必须一致（A-R2-04）"),
    RECORD_KEY_BLANK(6208, "record_key_expression 不能为空或空白"),
    TIME_FIELD_MISMATCH(6209, "consume_json 显式 time_field 与数据源声明不一致"),
    WINDOW_RANGE_INVALID(6210, "存在 time_window 数据源时汇总窗口必填且 end > start"),
    INVALID_ENUM_VALUE(6211, "枚举值非法"),
    SQL_PLACEHOLDER_INVALID(6212, "取数 SQL 占位符不合法"),
    CRON_INVALID(6213, "cron 表达式非法"),
    CUSTOM_CLASS_BLANK(6214, "自定义类名必填"),
    CUSTOM_CLASS_NOT_FOUND(6215, "自定义类不存在"),
    CUSTOM_INTERFACE_MISMATCH(6216, "自定义类未实现对应接口"),
    CUSTOM_CONFIG_INVALID(6217, "自定义参数 JSON 格式错误"),
    FETCH_API_CONFIG_INVALID(6218, "api 取数配置非法"),

    // ---- 拉取引擎 7xxx ----
    PULL_IN_PROGRESS(7001, "该数据源正在拉取中，请勿重复触发"),
    PULL_FAILED(7002, "拉取失败"),
    PULL_DS_DISABLED(7003, "数据源未启用，无法拉取"),
    FETCH_SQL_MISSING(7004, "取数 SQL 未配置或拉取模式暂不支持"),
    FETCH_ONE_SQL_MISSING(7005, "fetch_one_sql 未配置，无法单条重拉"),
    RECORD_KEY_MISSING(7006, "记录键求值失败（模板字段缺失）"),
    WINDOW_PARAM_BIND_FAILED(7007, "窗口参数绑定失败"),
    CONN_NOT_READY(7008, "连接不可用或已禁用"),
    FETCH_API_ERROR(7014, "api 取数失败"),

    // ---- 对账引擎 7xxx（T05） ----
    STRATEGY_NOT_SUPPORTED(7009, "匹配策略暂不支持（已支持 exact_key/composite_key/sum_check/custom）"),
    COMPARE_MODE_NOT_SUPPORTED(7010, "比较模式暂不支持"),
    COMPARE_FIELD_MISSING(7011, "比较字段缺失（record_data 中不存在）"),
    NUMBER_PARSE_FAILED(7012, "数值解析失败（比较/聚合值非法）"),
    RECON_IN_PROGRESS(7013, "该场景正在对账中，请勿重复触发");

    private final int code;
    private final String message;

    ErrorCode(int code, String message) {
        this.code = code;
        this.message = message;
    }

    public int getCode() {
        return code;
    }

    public String getMessage() {
        return message;
    }
}
