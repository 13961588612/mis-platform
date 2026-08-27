package com.mis.recon.service.engine;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.mis.recon.domain.runtime.LedgerRow;

import java.math.BigDecimal;
import java.util.List;

/**
 * multi_row 压行工具（T05-spec §6/§8）：aggregate=数值字段求和、非数值取第一条；
 * latest=record_time 最大（NULL 退 update_seq）。供 MatchEngine 组内多行压为单行。
 */
public final class RowSquasher {

    private RowSquasher() {
    }

    /** 压行：strategy=latest 取最新；其余（aggregate）数值求和、非数值取第一条。空行集 → null。 */
    public static LedgerRow squash(List<LedgerRow> rows, String strategy, ObjectMapper om) {
        if (rows.isEmpty()) {
            return null;
        }
        if ("latest".equals(strategy)) {
            LedgerRow best = rows.get(0);
            for (LedgerRow r : rows) {
                if (compareTimeSeq(r, best) > 0) {
                    best = r;
                }
            }
            return best;
        }
        // aggregate：合成 recordData（数值字段求和，非数值取第一条）
        ObjectNode merged = om.createObjectNode();
        for (LedgerRow row : rows) {
            JsonNode data = row.getRecordData();
            if (data == null || !data.isObject()) {
                continue;
            }
            data.fields().forEachRemaining(e -> {
                String name = e.getKey();
                String value = e.getValue().isNull() ? null : e.getValue().asText();
                JsonNode existing = merged.get(name);
                if (existing == null) {
                    putString(merged, name, value);
                } else if (isNumeric(existing.asText()) && isNumeric(value)) {
                    BigDecimal sum = new BigDecimal(existing.asText()).add(new BigDecimal(value));
                    merged.put(name, sum.stripTrailingZeros().toPlainString());
                }
            });
        }
        LedgerRow base = rows.get(0);
        return LedgerRow.builder()
                .record(base.getRecord())
                .dsCode(base.getDsCode())
                .recordKey(base.getRecordKey())
                .recordData(merged)
                .source(base.getSource())
                .poolDetailId(base.getPoolDetailId())
                .build();
    }

    /** 排序键：record_time 升序（NULL 最后）；全 NULL 退 update_seq。返回 正/负/0。 */
    public static int compareTimeSeq(LedgerRow a, LedgerRow b) {
        if (a.getRecord().getRecordTime() != null && b.getRecord().getRecordTime() != null) {
            return a.getRecord().getRecordTime().compareTo(b.getRecord().getRecordTime());
        }
        if (a.getRecord().getRecordTime() != null) {
            return 1;
        }
        if (b.getRecord().getRecordTime() != null) {
            return -1;
        }
        return Long.compare(a.getRecord().getUpdateSeq(), b.getRecord().getUpdateSeq());
    }

    private static void putString(ObjectNode node, String name, String value) {
        if (value == null) {
            node.putNull(name);
        } else {
            node.put(name, value);
        }
    }

    private static boolean isNumeric(String v) {
        if (v == null || v.isBlank()) {
            return false;
        }
        try {
            new BigDecimal(v);
            return true;
        } catch (NumberFormatException e) {
            return false;
        }
    }
}
