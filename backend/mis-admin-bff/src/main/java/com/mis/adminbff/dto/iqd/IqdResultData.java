package com.mis.adminbff.dto.iqd;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.List;

/**
 * 问数结果数据集（与 Python {@code models/iqd_schema.py::ResultData} 同构，§4.3）。
 *
 * @param columns   列元数据
 * @param rows      数据行（每行与 columns 顺序对应）
 * @param rowCount  行数
 * @param truncated 超出 1000 行/50 列上限时置 true
 */
public record IqdResultData(
        List<IqdColumnMeta> columns,
        List<List<Object>> rows,
        @JsonProperty("row_count") Integer rowCount,
        Boolean truncated) {
}
