package com.mis.recon.domain.runtime;

import lombok.Builder;
import lombok.Data;

import java.util.List;

/**
 * 匹配对（F54）：同匹配键两侧行集合 + multi_row 分组信息（T05-spec §3）。
 * <p>组内行数>1 时由 multi_row 策略处理：aggregate/latest 压为单行参与比较，reject 转 anomaly。</p>
 */
@Data
@Builder
public class MatchPair {

    private String matchKeyHash;           // 归一后匹配键 SHA-256（差异身份列）
    private String matchKeyDisplay;        // 归一后匹配键可读值（展示）

    private String rawKey;                 // 未归一匹配键原文（诊断）
    private List<String> transformChain;   // 归一规则描述（诊断，[{field,rule,before,after}] 序列化）

    private List<LedgerRow> leftRows;      // 左侧行（multi_row 聚合前全量）
    private List<LedgerRow> rightRows;     // 右侧行

    private LedgerRow leftSingle;          // 压行后参与比较的左侧（aggregate/latest）
    private LedgerRow rightSingle;         // 压行后参与比较的右侧

    private Integer multiRowGroupSize;     // 同键行数（诊断；>1 且 aggregate/latest 时记录）

    public int leftSize() {
        return leftRows == null ? 0 : leftRows.size();
    }

    public int rightSize() {
        return rightRows == null ? 0 : rightRows.size();
    }
}
