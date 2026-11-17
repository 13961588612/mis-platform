package com.mis.recon.service.engine;

import com.mis.recon.dao.DetailDao;
import com.mis.recon.dao.PullRunDao;
import com.mis.recon.repository.ScenarioRepository;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * 两轮确认独立巡检（F96，T06-spec §3）：pending 差异双条件升 confirmed。
 * <ul>
 *   <li>条件① 对端 ds 新增成功 pull_run（id 越过 pending_peer_pull_run_id，空拉取也算）；</li>
 *   <li>条件② pending_at 超 pending_max_wait_hours（场景配置，实时读）。</li>
 * </ul>
 * 由 ConfirmJob 定时触发；升级用乐观 UPDATE WHERE status='pending'，与对账引擎并发安全。
 */
@Slf4j
@Service
public class TwoRoundConfirmService {

    private final DetailDao detailDao;
    private final PullRunDao pullRunDao;
    private final ScenarioRepository scenarioRepository;

    public TwoRoundConfirmService(DetailDao detailDao, PullRunDao pullRunDao,
                                  ScenarioRepository scenarioRepository) {
        this.detailDao = detailDao;
        this.pullRunDao = pullRunDao;
        this.scenarioRepository = scenarioRepository;
    }

    /** 巡检统计 */
    public static class ConfirmStats {
        public int scanned;
        public int upgradedPeer;
        public int upgradedTimeout;

        public int total() {
            return upgradedPeer + upgradedTimeout;
        }
    }

    /**
     * 全场景巡检：扫 pending → 分组按场景读超时 → 双条件判定 → 乐观升级。
     */
    public ConfirmStats scan() {
        ConfirmStats stats = new ConfirmStats();
        List<DetailDao.PendingRow> rows = detailDao.scanPending();
        stats.scanned = rows.size();

        // 场景 pending_max_wait_hours 缓存（每场景只查一次）
        Map<String, Integer> waitHoursByScenario = new HashMap<>();
        for (DetailDao.PendingRow row : rows) {
            Integer waitHours = waitHoursByScenario.computeIfAbsent(row.scenarioCode,
                    this::loadPendingMaxWaitHours);
            if (upgradeByPeer(row)) {
                stats.upgradedPeer++;
            } else if (upgradeByTimeout(row, waitHours)) {
                stats.upgradedTimeout++;
            }
        }
        return stats;
    }

    /** 条件①：对端最新成功 pull_run id 越过首次 pending 记录的水位 */
    private boolean upgradeByPeer(DetailDao.PendingRow row) {
        if (row.pendingPeerPullRunId == null) {
            return false;
        }
        long peerMaxId = pullRunDao.findMaxSuccessId(row.pendingPeerDsCode);
        if (peerMaxId > row.pendingPeerPullRunId) {
            int n = detailDao.confirmPending(row.id, "peer_advanced");
            if (n > 0) {
                log.info("two-round confirm by peer: detail={} peerDs={} peerMaxId={} prev={}",
                        row.id, row.pendingPeerDsCode, peerMaxId, row.pendingPeerPullRunId);
                return true;
            }
            return false;   // 已被并发流转
        }
        return false;
    }

    /** 条件②：now - pending_at 超场景 pending_max_wait_hours */
    private boolean upgradeByTimeout(DetailDao.PendingRow row, Integer waitHours) {
        if (row.pendingAt == null || waitHours == null || waitHours <= 0) {
            return false;
        }
        if (LocalDateTime.now().minusHours(waitHours).isAfter(row.pendingAt)) {
            int n = detailDao.confirmPending(row.id, "timeout");
            if (n > 0) {
                log.info("two-round confirm by timeout: detail={} pendingAt={} waitHours={}",
                        row.id, row.pendingAt, waitHours);
                return true;
            }
            return false;
        }
        return false;
    }

    /** 场景 pending_max_wait_hours（缺省 24，V1 DDL 默认） */
    private Integer loadPendingMaxWaitHours(String scenarioCode) {
        return scenarioRepository.findByScenarioCode(scenarioCode)
                .map(s -> s.getPendingMaxWaitHours() == null ? 24 : s.getPendingMaxWaitHours())
                .orElse(24);
    }
}
