package com.mis.recon.service.engine;

import com.mis.recon.dao.PullRunDao;
import com.mis.recon.dao.ReconRunDao;
import com.mis.recon.service.alert.OpsAlertService;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.util.Map;

/**
 * 僵尸运行巡检（F107，T06-spec §6）：pull_run / recon_run 状态 running 超 30 分钟 → 置 failed。
 * <p>T07 后接入 OpsAlertService：pull/recon 各一条汇总告警（G29，channel=ops，指纹去重）。</p>
 */
@Slf4j
@Service
public class ZombieWatchService {

    /** 僵尸阈值（任务分解 F107 原文：running 超 30 分钟） */
    public static final int ZOMBIE_MINUTES = 30;

    private final PullRunDao pullRunDao;
    private final ReconRunDao reconRunDao;
    private final OpsAlertService opsAlertService;

    public ZombieWatchService(PullRunDao pullRunDao, ReconRunDao reconRunDao,
                              OpsAlertService opsAlertService) {
        this.pullRunDao = pullRunDao;
        this.reconRunDao = reconRunDao;
        this.opsAlertService = opsAlertService;
    }

    /** 巡检统计 */
    public static class ZombieStats {
        public int pullFailed;
        public int reconFailed;
    }

    public ZombieStats scan() {
        ZombieStats stats = new ZombieStats();
        for (Long id : pullRunDao.scanRunningOlderThan(ZOMBIE_MINUTES)) {
            pullRunDao.finishFailed(id, "zombie timeout (>30min)", null);
            stats.pullFailed++;
            log.warn("zombie pull_run id={} marked failed", id);
        }
        for (Long id : reconRunDao.scanRunningOlderThan(ZOMBIE_MINUTES)) {
            reconRunDao.finishRun(id, "failed", 0, 0, 0, Map.of(), "zombie timeout (>30min)");
            stats.reconFailed++;
            log.warn("zombie recon_run id={} marked failed", id);
        }
        if (stats.pullFailed > 0 || stats.reconFailed > 0) {
            String title = "对账引擎僵尸运行";
            String body = String.format("本轮巡检发现僵尸运行：pull_run %d 个、recon_run %d 个（running 超 %d 分钟已置 failed）",
                    stats.pullFailed, stats.reconFailed, ZOMBIE_MINUTES);
            opsAlertService.alertOps(title, body, "critical");
        }
        return stats;
    }
}
