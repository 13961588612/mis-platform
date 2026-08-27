package com.mis.recon.domain.runtime;

import com.fasterxml.jackson.databind.JsonNode;
import com.mis.recon.domain.ledger.ReconSourceRecord;
import com.mis.recon.util.JsonUtil;
import lombok.Builder;
import lombok.Data;

/**
 * 对账运行时台账行视图：台账行 + 合流来源标记 + 池差异回指（T05-spec §3）。
 * <p>来源：incr=游标增量 / pool=未平差异池还原 / matched_index=已配平索引回查。</p>
 */
@Data
@Builder(toBuilder = true)
public class LedgerRow {

    private ReconSourceRecord record;      // 台账当前值（池还原/索引回查时可能非增量来源）

    private String dsCode;
    private String recordKey;
    private JsonNode recordData;           // record_data 解析后（惰性取值）
    private String source;                 // incr / pool / matched_index

    private Long poolDetailId;             // source=pool 时回指 recon_detail.id（配平出池用）

    private String matchKeyHash;           // 匹配阶段现算（unmatched 判定/索引回查用）
    private String matchKeyDisplay;        // 匹配键可读值（unmatched 差异展示）

    private java.util.List<String> transformChain;   // 归一链诊断 [{field,rule,before,after}]（匹配键拼接前）

    public static LedgerRow of(ReconSourceRecord rec, String source) {
        LedgerRow row = LedgerRow.builder()
                .record(rec)
                .dsCode(rec.getDsCode())
                .recordKey(rec.getRecordKey())
                .source(source)
                .build();
        // 统一解析 record_data：池还原 / 索引回查 / 增量行均须携带，否则匹配键求值变空键（__nullkey__ 异常）
        if (rec.getRecordData() != null) {
            try {
                row.setRecordData(JsonUtil.parse(rec.getRecordData()));
            } catch (Exception e) {
                row.setRecordData(null);
            }
        }
        return row;
    }
}
