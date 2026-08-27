package com.mis.recon.domain.runtime;

import lombok.Builder;
import lombok.Data;

import java.util.List;

/**
 * 数据异常行（anomaly）：空匹配键 / multi_row reject（T05-spec §3 / §18.2）。
 * <p>身份：空键 → "__nullkey__:ds:record_key"；reject → 真实匹配键（一组一条差异，锚挂全部行）。</p>
 */
@Data
@Builder
public class AnomalyRow {

    private String matchKeyHash;           // 差异身份哈希（空键=__nullkey__ 兜底；reject=真实键）
    private String matchKeyDisplay;        // 可读值（空键=__nullkey__:ds:record_key；reject=匹配键）
    private String rawKey;                 // 原始键（空串表示空键）
    private String reason;                 // empty_key / multi_row_reject
    private List<LedgerRow> leftRows;      // 左侧命中的行（锚 side=left）
    private List<LedgerRow> rightRows;     // 右侧命中的行（锚 side=right）
}
