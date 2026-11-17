package com.mis.recon.domain.runtime;

import lombok.Builder;
import lombok.Data;

import java.util.List;
import java.util.Map;

/**
 * 诊断上下文（T05-spec §10）：diff_diagnosis_json 三阶段快照输入。
 */
@Data
@Builder
public class DiagnosisContext {

    private String checkName;
    private String matchKeyHash;
    private String matchKeyDisplay;
    private Integer multiRowGroupSize;
    private Boolean matchedIndexHit;
    private String unmatchedSide;            // left/right/null

    private int comparedFields;
    private List<Mismatch> mismatches;       // compare_phase.mismatches

    private String diffTypeDecided;          // verdict_phase
    private String reason;
    private Long pendingPeerPullRunId;
    private String upgradeCondition;         // peer_advanced / timeout / none
    private String resumeReason;             // resolved 原因（identity_migrated 等，MVP 空）

    /** 自定义实现诊断上下文（strategy=custom 附带；合并进 diff_diagnosis_json 根级 custom_context，§13.2） */
    private Map<String, Object> customContext;
}
