package com.mis.recon.job;

import com.mis.recon.service.pull.ReconRunner;
import lombok.Setter;
import lombok.extern.slf4j.Slf4j;
import org.quartz.DisallowConcurrentExecution;
import org.quartz.JobExecutionContext;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.scheduling.quartz.QuartzJobBean;

/**
 * 对账 Job（F109）：scenario_code 经 JobDataMap 注入（参照 PullJob T04 模式）。
 * <p>@DisallowConcurrentExecution：同一场景并发对账由 ReconRunner running map 互斥兜底，Job 级再加防重入。</p>
 */
@Slf4j
@Setter
@DisallowConcurrentExecution
public class ReconJob extends QuartzJobBean {

    private String scenarioCode;

    @Autowired
    private ReconRunner reconRunner;

    @Override
    protected void executeInternal(JobExecutionContext context) {
        if (scenarioCode == null || scenarioCode.isBlank()) {
            log.error("recon job without scenario_code, skip");
            return;
        }
        try {
            reconRunner.run(scenarioCode);
        } catch (Exception e) {
            log.error("recon job failed scenario={}", scenarioCode, e);
        }
    }
}
