package com.mis.recon.service.engine;

import com.mis.recon.dao.DetailDao;
import com.mis.recon.dao.LedgerDao;
import com.mis.recon.domain.ledger.ReconSourceRecord;
import com.mis.recon.domain.runtime.LedgerRow;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * 未平差异池（F93，T05-spec §8 / §10.2）：池扫描 + 经锚表还原台账当前值。
 * <p>池范围 = pending/confirmed 且 unhandled 且账龄内；time_window 检查不参与（§18.3，调用方控制）。</p>
 */
@Service
public class PoolService {

    private final DetailDao detailDao;
    private final LedgerDao ledgerDao;

    public PoolService(DetailDao detailDao, LedgerDao ledgerDao) {
        this.detailDao = detailDao;
        this.ledgerDao = ledgerDao;
    }

    /**
     * 池扫描 + 还原：返回还原的台账行（source=pool，poolDetailId 回指差异）。
     * 锚行对应的台账已逻辑删除 → 视为该侧为空（不还原，留待判定流转）。
     */
    public List<LedgerRow> openAndRestore(String scenarioCode, String checkName, int poolMaxAgeDays) {
        List<DetailDao.PoolRow> pool = detailDao.openPool(scenarioCode, checkName, poolMaxAgeDays);
        if (pool.isEmpty()) {
            return List.of();
        }
        // 按 ds 聚合 record_key，批量还原
        Map<String, List<String>> keysByDs = new HashMap<>();
        for (DetailDao.PoolRow p : pool) {
            keysByDs.computeIfAbsent(p.dsCode, k -> new ArrayList<>()).add(p.recordKey);
        }
        Map<String, ReconSourceRecord> found = new HashMap<>();
        keysByDs.forEach((ds, keys) -> {
            for (ReconSourceRecord rec : ledgerDao.queryByKeys(ds, keys)) {
                found.put(ds + ":" + rec.getRecordKey(), rec);
            }
        });
        List<LedgerRow> rows = new ArrayList<>(pool.size());
        for (DetailDao.PoolRow p : pool) {
            ReconSourceRecord rec = found.get(p.dsCode + ":" + p.recordKey);
            if (rec == null || rec.getIsDeleted() != null && rec.getIsDeleted() != 0) {
                continue;
            }
            rows.add(LedgerRow.of(rec, "pool").toBuilder()
                    .poolDetailId(p.detailId)
                    .build());
        }
        return rows;
    }
}
