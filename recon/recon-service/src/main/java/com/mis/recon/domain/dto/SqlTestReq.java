package com.mis.recon.domain.dto;

import jakarta.validation.constraints.NotBlank;
import lombok.Data;

/**
 * 取数 SQL 检测请求（表单未保存的临时 SQL，不入库）。
 */
@Data
public class SqlTestReq {
    /** 连接编码，用于解析源库连接池数据源与方言 */
    @NotBlank
    private String connCode;

    /** 待测拉取 SQL，可用 :p_start / :p_end（缺省时后端给最近一天窗口兜底） */
    @NotBlank
    private String sql;

    /** 可选窗口起始 yyyy-MM-dd HH:mm:ss；缺省 = 当前时刻前推 1 天 */
    private String start;

    /** 可选窗口结束 yyyy-MM-dd HH:mm:ss；缺省 = 当前时刻 */
    private String end;

    /** 返回样例行数上限（默认 10，上限 100） */
    private Integer limit;
}