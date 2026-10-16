package com.mis.recon.service.report;

import com.mis.recon.util.AmountUtil;

import java.math.BigDecimal;
import java.util.List;

/**
 * 报告内容渲染（F99，T07-spec §3.2）：按 check 聚合，diff 明细 + 金额合计 + severity。
 */
public class ReportRenderer {

    /** MVP 阈值：行数 > 50 → critical；> 10 → warn；否则 info。 */
    public static final int CRITICAL_THRESHOLD = 50;
    public static final int WARN_THRESHOLD = 10;
    public static final int MAX_DETAIL_LINES = 200;

    /**
     * 渲染一份 check 报告。
     *
     * @param rows 该 check 的报告差异行（已按 id 升序）
     */
    public ReportContent render(String scenarioCode, String scenarioName, String checkName, List<ReportRowView> rows) {
        long totalCent = 0;
        long totalPoint = 0;
        for (ReportRowView r : rows) {
            if (r.getDiffAmountCent() != null) {
                totalCent += r.getDiffAmountCent();
            }
            if (r.getDiffPoint() != null) {
                totalPoint += r.getDiffPoint();
            }
        }
        String severity = rows.size() > CRITICAL_THRESHOLD ? "critical"
                : rows.size() > WARN_THRESHOLD ? "warn" : "info";
        String title = String.format("【对账报告】%s(%s) - %s", scenarioName, scenarioCode, checkName);

        StringBuilder body = new StringBuilder();
        body.append("差异数：").append(rows.size())
                .append(" ｜ 金额合计：¥").append(toYuan(totalCent));
        if (totalPoint > 0) {
            body.append(" ｜ 积分差额合计：").append(totalPoint);
        }
        body.append('\n');
        int shown = Math.min(rows.size(), MAX_DETAIL_LINES);
        for (int i = 0; i < shown; i++) {
            ReportRowView r = rows.get(i);
            body.append("- ").append(displayOf(r)).append('\n');
        }
        if (rows.size() > shown) {
            body.append("… 共 ").append(rows.size()).append(" 条，详见管理端");
        }

        ReportContent content = new ReportContent(scenarioCode, checkName, title, body.toString(), severity);
        return content.withDetailIds(rows.stream().map(ReportRowView::getId).toList());
    }

    private String displayOf(ReportRowView r) {
        String amount = r.getDiffAmountCent() == null ? "-"
                : "¥" + toYuan(r.getDiffAmountCent());
        String line = String.format("%s [%s] %s 金额 %s",
                r.getMatchKeyDisplay() == null ? "(无匹配键)" : r.getMatchKeyDisplay(),
                diffTypeCn(r.getDiffType()),
                r.getDiffDesc() == null ? "" : r.getDiffDesc(),
                amount);
        if (r.getDiffPoint() != null) {
            line += " 积分差 " + r.getDiffPoint();
        }
        return line;
    }

    private String diffTypeCn(String type) {
        if (type == null) {
            return "";
        }
        return switch (type) {
            case "field_mismatch" -> "字段不一致";
            // diff_type 按"缺失的侧"命名：unmatched_left=右有左无（仅右端有）；unmatched_right=左有右无（仅左端有）
            case "unmatched_left" -> "仅右端有";
            case "unmatched_right" -> "仅左端有";
            case "anomaly" -> "数据异常";
            default -> type;
        };
    }

    private String toYuan(Long cent) {
        if (cent == null) {
            return "0.00";
        }
        BigDecimal yuan = AmountUtil.toYuan(cent);
        return yuan == null ? "0.00" : yuan.toPlainString();
    }

    /** 报告行视图（渲染用，由 ReportRunner 从 dao.ReportRow 转换） */
    public static class ReportRowView {
        private final long id;
        private final String matchKeyDisplay;
        private final String diffType;
        private final String diffDesc;
        private final Long diffAmountCent;
        private final Long diffPoint;

        public ReportRowView(long id, String matchKeyDisplay, String diffType,
                             String diffDesc, Long diffAmountCent, Long diffPoint) {
            this.id = id;
            this.matchKeyDisplay = matchKeyDisplay;
            this.diffType = diffType;
            this.diffDesc = diffDesc;
            this.diffAmountCent = diffAmountCent;
            this.diffPoint = diffPoint;
        }

        public long getId() {
            return id;
        }

        public String getMatchKeyDisplay() {
            return matchKeyDisplay;
        }

        public String getDiffType() {
            return diffType;
        }

        public String getDiffDesc() {
            return diffDesc;
        }

        public Long getDiffAmountCent() {
            return diffAmountCent;
        }

        public Long getDiffPoint() {
            return diffPoint;
        }
    }
}