package com.mis.recon.service.ops;

import com.mis.recon.common.BizException;
import com.mis.recon.common.ErrorCode;
import com.mis.recon.dao.CursorDao;
import com.mis.recon.dao.DetailDao;
import com.mis.recon.dao.LedgerDao;
import com.mis.recon.dao.MatchedIndexDao;
import com.mis.recon.dao.PullRunDao;
import com.mis.recon.domain.config.ReconCheck;
import com.mis.recon.domain.config.ReconDatasource;
import com.mis.recon.domain.dto.RebuildResp;
import com.mis.recon.repository.CheckRepository;
import com.mis.recon.repository.DatasourceRepository;
import com.mis.recon.service.pull.PullRunner;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

/**
 * 数据源重建（运维）：解决「数据源 SQL 写错导致多拉数据 → 对账单边」。
 * <p>破坏性操作：清空该数据源台账与拉取水位，清理所有引用它的 check 的
 * 消费游标 / 配对索引 / 差异（差异即匹配池，不清理会反复复活脏 unmatched），
 * 再按覆盖窗口全量重拉。清理与重拉不在同一事务（重拉耗时长且自管事务），
 * 重拉失败时台账已清空，需用本端点或手动拉取补回。</p>
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class DatasourceRebuildService {

    private final CheckRepository checkRepo;
    private final DatasourceRepository datasourceRepo;
    private final LedgerDao ledgerDao;
    private final PullRunDao pullRunDao;
    private final CursorDao cursorDao;
    private final MatchedIndexDao matchedIndexDao;
    private final DetailDao detailDao;
    private final PullRunner pullRunner;

    public RebuildResp rebuild(String dsCode, LocalDateTime start, LocalDateTime end) {
        // 0. 前置校验：数据源必须存在且启用（失败先于任何删除，避免停用/不存在时删了数据拉不回来）
        ReconDatasource ds = datasourceRepo.findByDsCode(dsCode)
                .orElseThrow(() -> new BizException(ErrorCode.DS_NOT_FOUND, "数据源不存在: " + dsCode));
        if (ds.getEnabled() == null || ds.getEnabled() != 1) {
            throw new BizException(ErrorCode.PULL_DS_DISABLED, "数据源已停用，重建需先启用: " + dsCode);
        }

        // 1. 引用该数据源的全部 check（consume_json 行内 ds_code 精确匹配）
        List<ReconCheck> refChecks = checkRepo.findRefByConsumeDsCode(dsCode);

        // 2. 清台账 + 拉取水位（下次拉取从 0 开始）
        int deletedRecords = ledgerDao.deleteByDs(dsCode);
        int deletedPullRuns = pullRunDao.deleteByDs(dsCode);

        // 3. 按引用 check 清理游标 / 配对索引 / 差异（差异即池，防脏 unmatched 复活）
        Set<String> affectedScenarios = new LinkedHashSet<>();
        for (ReconCheck check : refChecks) {
            cursorDao.reset(check.getScenarioCode(), check.getCheckName(), dsCode);
            matchedIndexDao.deleteByCheck(check.getScenarioCode(), check.getCheckName());
            detailDao.deleteByCheck(check.getScenarioCode(), check.getCheckName());
            affectedScenarios.add(check.getScenarioCode());
        }

        // 4. 全量窗口重拉（start/end 缺省 → PullRunner 自动衔接：水位已清，回退 initial_start）
        long pullRunId = pullRunner.run(dsCode, start, end);
        log.info("datasource rebuild done: ds={} deletedRecords={} deletedPullRuns={} refChecks={} pullRunId={}",
                dsCode, deletedRecords, deletedPullRuns, refChecks.size(), pullRunId);

        return new RebuildResp(pullRunId, deletedRecords, deletedPullRuns,
                refChecks.size(), new ArrayList<>(affectedScenarios));
    }
}
