package com.mis.recon.domain.dto;

import com.mis.recon.domain.config.ReconCheck;
import com.mis.recon.domain.config.ReconCompareRule;
import com.mis.recon.domain.config.ReconMatchRule;
import lombok.Data;

/**
 * 检查详情聚合响应（GET /checks/{scenarioCode}/{checkName}）：check + matchRule + compareRule 三表组装。
 */
@Data
public class CheckDetailResp {

    private ReconCheck check;
    private ReconMatchRule matchRule;
    private ReconCompareRule compareRule;
}
