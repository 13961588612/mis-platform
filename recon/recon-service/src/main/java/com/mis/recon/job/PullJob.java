package com.mis.recon.job;

import com.mis.recon.service.pull.PullRunner;
import lombok.Setter;
import lombok.extern.slf4j.Slf4j;
import org.quartz.DisallowConcurrentExecution;
import org.quartz.JobExecutionContext;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.scheduling.quartz.QuartzJobBean;

/**
 * 拉取 Job（F108）：ds_code 经 JobDataMap 注入（QuartzJobBean 的 BeanWrapper 机制），
 * PullRunner 由 SpringBeanJobFactory 自动装配（T01 QuartzConfig）。
 * <p>@DisallowConcurrentExecution：同 ds 并行拉取由 PullRunner 互斥兜底（G6），Job 级再加防重入。</p>
 */
@Slf4j
@Setter
@DisallowConcurrentExecution
public class PullJob extends QuartzJobBean {

    private String dsCode;

    @Autowired
    private PullRunner pullRunner;

    @Override
    protected void executeInternal(JobExecutionContext context) {
        if (dsCode == null || dsCode.isBlank()) {
            log.error("pull job without ds_code, skip");
            return;
        }
        try {
            pullRunner.run(dsCode);
        } catch (Exception e) {
            // run 内部已收尾 pull_run(failed)，此处只记日志（Quartz Job 抛异常会记 misfire）
            log.error("pull job failed ds={}", dsCode, e);
        }
    }
}
