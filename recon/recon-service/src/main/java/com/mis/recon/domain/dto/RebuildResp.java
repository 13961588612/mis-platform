package com.mis.recon.domain.dto;

import lombok.AllArgsConstructor;
import lombok.Data;

import java.util.List;

/**
 * 数据源重建结果摘要（ops/datasource/{dsCode}/rebuild 响应）。
 * <p>语义：清空该数据源台账/拉取水位，清理引用它的 check 的游标/配对索引/差异，
 * 再按覆盖窗口全量重拉。返回受影响 check 列表，调用方需手动重跑对应场景对账。</p>
 */
@Data
@AllArgsConstructor
public class RebuildResp {
    /** 本次重建拉取的 pull_run id */
    private long pullRunId;
    /** 删除的台账行数 */
    private int deletedSourceRecords;
    /** 删除的拉取运行记录数 */
    private int deletedPullRuns;
    /** 受影响（引用该数据源）的 check 数 */
    private int affectedCheckCount;
    /** 受影响场景编码（去重，需手动重跑对账） */
    private List<String> affectedScenarios;
}
