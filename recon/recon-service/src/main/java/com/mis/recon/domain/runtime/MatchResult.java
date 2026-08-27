package com.mis.recon.domain.runtime;

import lombok.Builder;
import lombok.Data;

import java.util.List;
import java.util.Map;

/**
 * 匹配结果（F91 产出）：配对 + 单侧缺失 + 数据异常（T05-spec §3）。
 */
@Data
@Builder
public class MatchResult {

    private List<MatchPair> pairs;                 // 两侧同键（参与比较）
    private List<LedgerRow> unmatchedLeft;         // 左侧有、右侧无（仅左侧行）
    private List<LedgerRow> unmatchedRight;        // 右侧有、左侧无（仅右侧行）
    private List<AnomalyRow> anomalies;            // 空键 / multi_row reject

    /** 自定义实现可选诊断上下文（strategy=custom 附带，合并进 diff_diagnosis_json；不提供则默认空诊断，§13.2） */
    private Map<String, Object> diagnosisContext;

    public int pairCount() {
        return pairs == null ? 0 : pairs.size();
    }

    public int anomalyCount() {
        return anomalies == null ? 0 : anomalies.size();
    }
}
