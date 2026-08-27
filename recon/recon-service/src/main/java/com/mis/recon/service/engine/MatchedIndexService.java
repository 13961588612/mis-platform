package com.mis.recon.service.engine;

import com.mis.recon.dao.LedgerDao;
import com.mis.recon.dao.MatchedIndexDao;
import com.mis.recon.domain.ledger.ReconSourceRecord;
import com.mis.recon.domain.runtime.LedgerRow;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * 已配平索引服务（F94，T05-spec §8 / §10.4）：索引回查防单边重拉误报。
 * <p>匹配前计算增量行 match_key_hash 集合 → IN 分批回查索引 → 批量还原对端台账当前值。</p>
 */
@Service
public class MatchedIndexService {

    private final MatchedIndexDao matchedIndexDao;
    private final LedgerDao ledgerDao;

    public MatchedIndexService(MatchedIndexDao matchedIndexDao, LedgerDao ledgerDao) {
        this.matchedIndexDao = matchedIndexDao;
        this.ledgerDao = ledgerDao;
    }

    /**
     * 索引回查并还原对端台账行（source=matched_index）。
     * 索引指向的台账行已逻辑删除 → 跳过该条目（对端数据已不存在，单边重拉确实判 unmatched）。
     */
    public List<LedgerRow> restoreFromIndex(String scenarioCode, String checkName, String pairSegment,
                                            Set<String> matchKeyHashes) {
        if (matchKeyHashes == null || matchKeyHashes.isEmpty()) {
            return List.of();
        }
        List<MatchedIndexDao.IndexRow> idx = matchedIndexDao.lookup(
                scenarioCode, checkName, pairSegment, new ArrayList<>(matchKeyHashes));
        if (idx.isEmpty()) {
            return List.of();
        }
        Map<String, List<String>> keysByDs = new HashMap<>();
        for (MatchedIndexDao.IndexRow row : idx) {
            keysByDs.computeIfAbsent(row.dsCode, k -> new ArrayList<>()).add(row.recordKey);
        }
        Map<String, ReconSourceRecord> found = new HashMap<>();
        keysByDs.forEach((ds, keys) -> {
            for (ReconSourceRecord rec : ledgerDao.queryByKeys(ds, keys)) {
                found.put(ds + ":" + rec.getRecordKey(), rec);
            }
        });
        Set<String> seen = new HashSet<>();
        List<LedgerRow> rows = new ArrayList<>();
        for (MatchedIndexDao.IndexRow row : idx) {
            ReconSourceRecord rec = found.get(row.dsCode + ":" + row.recordKey);
            if (rec == null || rec.getIsDeleted() != null && rec.getIsDeleted() != 0) {
                continue;
            }
            if (!seen.add(row.dsCode + ":" + row.recordKey)) {
                continue;   // 同一 (ds,key) 可能被多个 hash 命中，去重
            }
            rows.add(LedgerRow.of(rec, "matched_index"));
        }
        return rows;
    }
}
