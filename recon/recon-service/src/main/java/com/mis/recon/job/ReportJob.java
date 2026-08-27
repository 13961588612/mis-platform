package com.mis.recon.job;

import com.mis.recon.service.report.ReportRunner;
import lombok.Setter;
import lombok.extern.slf4j.Slf4j;
import org.quartz.DisallowConcurrentExecution;
import org.quartz.JobExecutionContext;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.scheduling.quartz.QuartzJobBean;

/**
 * 报告 Job（F110，T07-spec §8）：scenario_code 经 JobDataMap 注入，misfire=skip（SchedulerManager 注册）。
 */
@Slf4j
@Setter
@DisallowConcurrentExecution
public class ReportJob extends QuartzJobBean {

    private String scenarioCode;

    @Autowired
    private ReportRunner reportRunner;

    @Override
    protected void executeInternal(JobExecutionContext context) {
        if (scenarioCode == null || scenarioCode.isBlank()) {
            log.error("report job without scenario_code, skip");
            return;
        }
        try {
            reportRunner.run(scenarioCode);
        } catch (Exception e) {
            log.error("report job failed scenario={}", scenarioCode, e);
        }
    }
}