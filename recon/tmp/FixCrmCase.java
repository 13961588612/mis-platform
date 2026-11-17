import java.sql.*;

public class FixCrmCase {
    public static void main(String[] args) throws Exception {
        String url = "jdbc:postgresql://10.254.16.6:5432/recon";
        String user = "mis";
        String pass = "mis123";
        try (Connection c = DriverManager.getConnection(url, user, pass)) {
            c.setAutoCommit(false);
            try {
                // 1. 匹配规则：crm 字段名改为源列名（Oracle 大写）
                String newKeyFields = "{\"智慧购\": \"{code}\", \"积分流水\": \"{DJH}\"}";
                int n1;
                try (PreparedStatement ps = c.prepareStatement(
                        "UPDATE recon_match_rule SET key_fields_json = ?::jsonb WHERE scenario_code='zhg_order_integral'")) {
                    ps.setString(1, newKeyFields);
                    n1 = ps.executeUpdate();
                }
                // 2. 比较规则：crm 字段名改为大写
                String newRules = "[{\"name\": \"积分值\", \"is_amount\": false, \"left_field\": \"智慧购.int_num\", \"right_field\": \"积分流水.WCLJFBD\", \"compare_mode\": \"equal\"}]";
                int n2;
                try (PreparedStatement ps = c.prepareStatement(
                        "UPDATE recon_compare_rule SET rules_json = ?::jsonb WHERE scenario_code='zhg_order_integral'")) {
                    ps.setString(1, newRules);
                    n2 = ps.executeUpdate();
                }
                // 3. 清理差异/运行/游标（保留台账与水位，重对账全量消费）
                String[] clean = {
                    "recon_detail_source_ref", "recon_diff_handle", "recon_diff_status_history",
                    "recon_detail", "recon_matched_index", "recon_run", "recon_report_run",
                    "recon_alert_log", "recon_backlog_window"
                };
                StringBuilder sb = new StringBuilder();
                for (String t : clean) {
                    try (Statement s = c.createStatement()) {
                        sb.append("deleted ").append(t).append(" = ").append(s.executeUpdate("DELETE FROM " + t)).append("\n");
                    }
                }
                try (Statement s = c.createStatement()) {
                    sb.append("deleted cursor = ").append(s.executeUpdate(
                        "DELETE FROM recon_consume_cursor WHERE ds_code IN ('zhg_order','crm_zhg_integral_flow')")).append("\n");
                }
                c.commit();
                System.out.println("match_rule updated=" + n1 + ", compare_rule updated=" + n2);
                System.out.print(sb.toString());
                System.out.println("COMMIT ok");
            } catch (Exception e) {
                c.rollback();
                System.out.println("ROLLBACK: " + e.getMessage());
                throw e;
            }
        }
    }
}