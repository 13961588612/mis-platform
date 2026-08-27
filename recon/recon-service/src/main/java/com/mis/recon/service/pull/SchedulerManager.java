package com.mis.recon.service.pull;

import com.mis.recon.domain.config.ReconDatasource;
import com.mis.recon.domain.config.ReconScenario;
import com.mis.recon.job.ConfirmJob;
import com.mis.recon.job.PullJob;
import com.mis.recon.job.ReconJob;
import com.mis.recon.job.ReportJob;
import com.mis.recon.repository.DatasourceRepository;
import com.mis.recon.repository.ScenarioRepository;
import lombok.extern.slf4j.Slf4j;
import org.quartz.CronScheduleBuilder;
import org.quartz.CronTrigger;
import org.quartz.JobBuilder;
import org.quartz.JobDetail;
import org.quartz.JobKey;
import org.quartz.Scheduler;
import org.quartz.SchedulerException;
import org.quartz.TriggerBuilder;
import org.quartz.TriggerKey;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;

import java.util.List;

/**
 * 调度管理器（F112）：pull（ds.pull_cron）+ recon（scenario.cron_expr）+ report（scenario.report_cron）
 * 动态注册；启动加载 enabled 且 cron 非空的 ds/scenario 全量注册，配置保存后 refresh（配置即对账）。
 * <p>Quartz 未装配（调度开关 false）时经 ObjectProvider 降级，不阻塞启动。</p>
 */
@Slf4j
@Component
public class SchedulerManager {

    private final ObjectProvider<Scheduler> schedulerProvider;
    private final DatasourceRepository datasourceRepository;
    private final ScenarioRepository scenarioRepository;

    /** 巡检 cron（两轮确认 + 僵尸巡检，全局固定频率；默认每 10 分钟）。 */
    @Value("${recon.confirm-cron:0 */10 * * * ?}")
    private String confirmCron;

    public SchedulerManager(ObjectProvider<Scheduler> schedulerProvider,
                            DatasourceRepository datasourceRepository,
                            ScenarioRepository scenarioRepository) {
        this.schedulerProvider = schedulerProvider;
        this.datasourceRepository = datasourceRepository;
        this.scenarioRepository = scenarioRepository;
    }

    /** 启动加载（ApplicationReadyEvent：scheduler 已 auto-startup，QRTZ 表已就绪）。 */
    @EventListener(ApplicationReadyEvent.class)
    public void init() {
        ensureSchedulerStarted();
        int pullJobs = 0;
        for (ReconDatasource ds : datasourceRepository.findByEnabledAndPullCronIsNotNull()) {
            try {
                refreshPullJob(ds.getDsCode(), ds.getPullCron(), true);
                pullJobs++;
            } catch (Exception e) {
                log.warn("register pull job failed ds={}", ds.getDsCode(), e);
            }
        }
        int reconJobs = 0;
        for (ReconScenario scenario : scenarioRepository.findByEnabled(1)) {
            if (!StringUtils.hasText(scenario.getCronExpr())) {
                continue;
            }
            try {
                refreshReconJob(scenario.getScenarioCode(), scenario.getCronExpr(), true);
                reconJobs++;
            } catch (Exception e) {
                log.warn("register recon job failed scenario={}", scenario.getScenarioCode(), e);
            }
        }
        int reportJobs = 0;
        for (ReconScenario scenario : scenarioRepository.findByEnabled(1)) {
            if (!StringUtils.hasText(scenario.getReportCron())) {
                continue;
            }
            try {
                refreshReportJob(scenario.getScenarioCode(), scenario.getReportCron(), true);
                reportJobs++;
            } catch (Exception e) {
                log.warn("register report job failed scenario={}", scenario.getScenarioCode(), e);
            }
        }
        int confirmJobs = registerConfirmJob() ? 1 : 0;
        log.info("scheduler manager init: registered {} pull jobs, {} recon jobs, {} report jobs, {} confirm job",
                pullJobs, reconJobs, reportJobs, confirmJobs);
    }

    /**
     * 兜底启动调度器：Boot 的 spring.quartz.auto-startup 在部分启动时序下未真正 start
     * （QuartzSchedulerThread 停留在 paused 等待），此处显式 start 保证调度循环运行。
     * start() 幂等：已启动时无副作用。
     */
    private void ensureSchedulerStarted() {
        Scheduler scheduler = schedulerProvider.getIfAvailable();
        if (scheduler == null) {
            return;   // 调度开关关闭（未装配），跳过
        }
        try {
            if (scheduler.isInStandbyMode()) {
                log.info("scheduler is in standby, calling start() explicitly (auto-startup did not engage)");
                scheduler.start();
                log.info("scheduler started explicitly");
            } else {
                log.info("scheduler already started (auto-startup engaged)");
            }
        } catch (SchedulerException e) {
            log.error("start scheduler failed", e);
        }
    }

    /** 巡检 Job 注册（T06-spec §8）：固定 cron，应用配置可覆盖；返回是否注册成功。 */
    public boolean registerConfirmJob() {
        Scheduler scheduler = schedulerProvider.getIfAvailable();
        if (scheduler == null) {
            return false;
        }
        try {
            JobKey jobKey = new JobKey("confirm-inspect");
            JobDetail job = JobBuilder.newJob(ConfirmJob.class)
                    .withIdentity(jobKey)
                    .storeDurably(true)
                    .build();
            scheduler.addJob(job, true);
            CronTrigger trigger = TriggerBuilder.newTrigger()
                    .withIdentity(new TriggerKey("confirm-inspect-trg"))
                    .forJob(jobKey)
                    .withSchedule(CronScheduleBuilder.cronSchedule(confirmCron)
                            .withMisfireHandlingInstructionDoNothing())
                    .build();
            if (scheduler.checkExists(trigger.getKey())) {
                scheduler.rescheduleJob(trigger.getKey(), trigger);
            } else {
                scheduler.scheduleJob(trigger);
            }
            return true;
        } catch (SchedulerException e) {
            log.error("register confirm job failed cron={}", confirmCron, e);
            return false;
        }
    }

    // ---- pull（T04） ----

    /** ds 保存/更新后调用：cron 非空且 enabled → upsert 注册；否则删除（如存在）。 */
    public void refreshPullJob(String dsCode, String pullCron, boolean enabled) {
        Scheduler scheduler = schedulerProvider.getIfAvailable();
        if (scheduler == null) {
            return;   // 调度开关关闭，跳过（datasource CRUD 不受影响）
        }
        try {
            if (enabled && StringUtils.hasText(pullCron)) {
                JobKey jobKey = new JobKey("pull-" + dsCode);
                JobDetail job = JobBuilder.newJob(PullJob.class)
                        .withIdentity(jobKey)
                        .usingJobData("dsCode", dsCode)
                        .storeDurably(true)
                        .build();
                scheduler.addJob(job, true);
                CronTrigger trigger = TriggerBuilder.newTrigger()
                        .withIdentity(new TriggerKey("pull-" + dsCode + "-trg"))
                        .forJob(jobKey)
                        .withSchedule(CronScheduleBuilder.cronSchedule(pullCron)
                                .withMisfireHandlingInstructionDoNothing())   // misfire=skip
                        .build();
                if (scheduler.checkExists(trigger.getKey())) {
                    scheduler.rescheduleJob(trigger.getKey(), trigger);
                } else {
                    scheduler.scheduleJob(trigger);
                }
            } else {
                removePullJobInternal(scheduler, dsCode);
            }
        } catch (SchedulerException e) {
            log.error("refresh pull job failed ds={} cron={}", dsCode, pullCron, e);
        }
    }

    /** ds 删除时调用。 */
    public void removePullJob(String dsCode) {
        Scheduler scheduler = schedulerProvider.getIfAvailable();
        if (scheduler == null) {
            return;
        }
        try {
            removePullJobInternal(scheduler, dsCode);
        } catch (SchedulerException e) {
            log.error("remove pull job failed ds={}", dsCode, e);
        }
    }

    private void removePullJobInternal(Scheduler scheduler, String dsCode) throws SchedulerException {
        JobKey jobKey = new JobKey("pull-" + dsCode);
        if (scheduler.checkExists(jobKey)) {
            scheduler.deleteJob(jobKey);
        }
    }

    // ---- recon（T05） ----

    /** 场景保存/更新后调用：cron 非空且 enabled → upsert 注册；否则删除。 */
    public void refreshReconJob(String scenarioCode, String cronExpr, boolean enabled) {
        Scheduler scheduler = schedulerProvider.getIfAvailable();
        if (scheduler == null) {
            return;
        }
        try {
            if (enabled && StringUtils.hasText(cronExpr)) {
                JobKey jobKey = new JobKey("recon-" + scenarioCode);
                JobDetail job = JobBuilder.newJob(ReconJob.class)
                        .withIdentity(jobKey)
                        .usingJobData("scenarioCode", scenarioCode)
                        .storeDurably(true)
                        .build();
                scheduler.addJob(job, true);
                CronTrigger trigger = TriggerBuilder.newTrigger()
                        .withIdentity(new TriggerKey("recon-" + scenarioCode + "-trg"))
                        .forJob(jobKey)
                        .withSchedule(CronScheduleBuilder.cronSchedule(cronExpr)
                                .withMisfireHandlingInstructionDoNothing())   // misfire=skip
                        .build();
                if (scheduler.checkExists(trigger.getKey())) {
                    scheduler.rescheduleJob(trigger.getKey(), trigger);
                } else {
                    scheduler.scheduleJob(trigger);
                }
            } else {
                removeReconJobInternal(scheduler, scenarioCode);
            }
        } catch (SchedulerException e) {
            log.error("refresh recon job failed scenario={} cron={}", scenarioCode, cronExpr, e);
        }
    }

    /** 场景删除时调用。 */
    public void removeReconJob(String scenarioCode) {
        Scheduler scheduler = schedulerProvider.getIfAvailable();
        if (scheduler == null) {
            return;
        }
        try {
            removeReconJobInternal(scheduler, scenarioCode);
        } catch (SchedulerException e) {
            log.error("remove recon job failed scenario={}", scenarioCode, e);
        }
    }

    private void removeReconJobInternal(Scheduler scheduler, String scenarioCode) throws SchedulerException {
        JobKey jobKey = new JobKey("recon-" + scenarioCode);
        if (scheduler.checkExists(jobKey)) {
            scheduler.deleteJob(jobKey);
        }
    }

    // ---- report（T07） ----

    /** 场景保存/更新后调用：report_cron 非空且 enabled → upsert 注册；否则删除。 */
    public void refreshReportJob(String scenarioCode, String reportCron, boolean enabled) {
        Scheduler scheduler = schedulerProvider.getIfAvailable();
        if (scheduler == null) {
            return;
        }
        try {
            if (enabled && StringUtils.hasText(reportCron)) {
                JobKey jobKey = new JobKey("report-" + scenarioCode);
                JobDetail job = JobBuilder.newJob(ReportJob.class)
                        .withIdentity(jobKey)
                        .usingJobData("scenarioCode", scenarioCode)
                        .storeDurably(true)
                        .build();
                scheduler.addJob(job, true);
                CronTrigger trigger = TriggerBuilder.newTrigger()
                        .withIdentity(new TriggerKey("report-" + scenarioCode + "-trg"))
                        .forJob(jobKey)
                        .withSchedule(CronScheduleBuilder.cronSchedule(reportCron)
                                .withMisfireHandlingInstructionDoNothing())   // misfire=skip
                        .build();
                if (scheduler.checkExists(trigger.getKey())) {
                    scheduler.rescheduleJob(trigger.getKey(), trigger);
                } else {
                    scheduler.scheduleJob(trigger);
                }
            } else {
                removeReportJobInternal(scheduler, scenarioCode);
            }
        } catch (SchedulerException e) {
            log.error("refresh report job failed scenario={} cron={}", scenarioCode, reportCron, e);
        }
    }

    /** 场景删除时调用。 */
    public void removeReportJob(String scenarioCode) {
        Scheduler scheduler = schedulerProvider.getIfAvailable();
        if (scheduler == null) {
            return;
        }
        try {
            removeReportJobInternal(scheduler, scenarioCode);
        } catch (SchedulerException e) {
            log.error("remove report job failed scenario={}", scenarioCode, e);
        }
    }

    private void removeReportJobInternal(Scheduler scheduler, String scenarioCode) throws SchedulerException {
        JobKey jobKey = new JobKey("report-" + scenarioCode);
        if (scheduler.checkExists(jobKey)) {
            scheduler.deleteJob(jobKey);
        }
    }
}
