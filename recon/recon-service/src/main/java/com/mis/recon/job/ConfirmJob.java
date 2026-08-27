package com.mis.recon.job;

import com.mis.recon.service.engine.TwoRoundConfirmService;
import com.mis.recon.service.engine.ZombieWatchService;
import lombok.extern.slf4j.Slf4j;
import org.quartz.DisallowConcurrentExecution;
import org.quartz.JobExecutionContext;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.scheduling.quartz.QuartzJobBean;

/**
 * 巡检 Job（T06-spec §8）：两轮确认 + 僵尸巡检，固定 cron 全局注册（不依赖 DB）。
 * <p>@DisallowConcurrentExecution：巡检与自身不重入；与对账引擎并发安全由乐观升级保证。</p>
 */
@Slf4j
@DisallowConcurrentExecution
public class ConfirmJob extends QuartzJobBean {

    @Autowired
    private TwoRoundConfirmService twoRoundConfirmService;

    @Autowired
    private ZombieWatchService zombieWatchService;

    @Override
    protected void executeInternal(JobExecutionContext context) {
        try {
            TwoRoundConfirmService.ConfirmStats confirm = twoRoundConfirmService.scan();
            log.info("confirm inspect: scanned={} upgradedPeer={} upgradedTimeout={}",
                    confirm.scanned, confirm.upgradedPeer, confirm.upgradedTimeout);
        } catch (Exception e) {
            log.error("two-round confirm inspect failed", e);
        }
        try {
            ZombieWatchService.ZombieStats zombie = zombieWatchService.scan();
            log.info("zombie inspect: pullFailed={} reconFailed={}",
                    zombie.pullFailed, zombie.reconFailed);
        } catch (Exception e) {
            log.error("zombie inspect failed", e);
        }
    }
}
