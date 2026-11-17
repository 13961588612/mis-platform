package com.mis.recon.domain.dto;

import lombok.Builder;
import lombok.Data;

import java.util.List;
import java.util.Map;

/**
 * 取数 SQL 检测响应：成功返回列 + 样例行 + 统计；失败返回错误信息（ok=false）。
 */
@Data
@Builder
public class SqlTestResp {

    private boolean ok;

    /** 结果列名（按返回顺序） */
    private List<String> columns;

    /** 样例行（列名→值） */
    private List<Map<String, Object>> rows;

    /** 本批返回行数 */
    private int rowCount;

    /** 执行耗时 ms */
    private long costMs;

    /** ok=false 时的错误信息 */
    private String message;
}