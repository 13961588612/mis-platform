package com.mis.recon.service.engine;

import com.mis.recon.domain.runtime.Mismatch;
import org.springframework.stereotype.Component;

import java.util.List;

/**
 * 差异摘要构建器（F98，T05-spec §10 / §18.4）：diff_desc 直接存中文，≤2000 字符截断加 "..."
 * <ul>
 *   <li>field_mismatch： "比较项name: 左值 vs 右值" 分号拼接</li>
 *   <li>unmatched_left：  "仅{右侧别名}有 ({匹配键可读值})"（右侧有、左侧缺失，即左缺失）</li>
 *   <li>unmatched_right： "仅{左侧别名}有 ({匹配键可读值})"（左侧有、右侧缺失，即右缺失）</li>
 *   <li>anomaly：         "数据异常: {原因} ({匹配键可读值})"</li>
 * </ul>
 */
@Component
public class DiffDescBuilder {

    private static final int MAX_CHARS = 2000;

    public String buildFieldMismatch(List<Mismatch> mismatches) {
        if (mismatches == null || mismatches.isEmpty()) {
            return "字段不一致";
        }
        StringBuilder sb = new StringBuilder();
        for (Mismatch m : mismatches) {
            if (sb.length() > 0) {
                sb.append("; ");
            }
            sb.append(m.getField() == null || m.getField().isBlank() ? "字段" : m.getField())
                    .append(": ")
                    .append(m.getLeftValue() == null ? "(缺失)" : m.getLeftValue())
                    .append(" vs ")
                    .append(m.getRightValue() == null ? "(缺失)" : m.getRightValue());
        }
        return truncate(sb.toString());
    }

    public String buildUnmatched(String side, String alias, String matchKeyDisplay) {
        // diff_type 按"缺失的侧"命名（unmatched_left=右侧有左侧缺失 / unmatched_right=左侧有右侧缺失）；
        // alias 为"有数据的侧"，desc 即"仅{有数据侧}有"（需求口径：unmatched_right 描述"仅订单侧有"）
        return truncate("仅" + alias + "有 (" + (matchKeyDisplay == null || matchKeyDisplay.isBlank() ? "无匹配键" : matchKeyDisplay) + ")");
    }

    public String buildAnomaly(String reason, String matchKeyDisplay) {
        String reasonCn = switch (reason == null ? "" : reason) {
            case "empty_key" -> "空匹配键";
            case "multi_row_reject" -> "同键多行拒绝";
            default -> "数据异常";
        };
        return truncate("数据异常: " + reasonCn + " (" + (matchKeyDisplay == null || matchKeyDisplay.isBlank() ? "-" : matchKeyDisplay) + ")");
    }

    private String truncate(String s) {
        if (s == null) {
            return "";
        }
        if (s.length() <= MAX_CHARS) {
            return s;
        }
        return s.substring(0, MAX_CHARS) + "...";
    }
}
