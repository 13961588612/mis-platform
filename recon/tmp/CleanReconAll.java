import java.sql.*;

/** 清理 zhg_order_integral 全部对账产物（差异/运行记录/游标），准备全量重跑 */
public class CleanReconAll {
    public static void main(String[] args) throws Exception {
        String url = "jdbc:postgresql://10.254.16.6:5432/recon";
        try (Connection c = DriverManager.getConnection(url, "mis", "mis123")) {
            c.setAutoCommit(false);
            try {
                String[][] actions = {
                    {"recon_detail_source_ref", "DELETE FROM recon_detail_source_ref"},
                    {"recon_diff_handle", "DELETE FROM recon_diff_handle"},
                    {"recon_diff_status_history", "DELETE FROM recon_diff_status_history"},
                    {"recon_detail", "DELETE FROM recon_detail"},
                    {"recon_matched_index", "DELETE FROM recon_matched_index"},
                    {"recon_run", "DELETE FROM recon_run"},
                    {"recon_report_run", "DELETE FROM recon_report_run"},
                    {"recon_alert_log", "DELETE FROM recon_alert_log"},
                    {"recon_backlog_window", "DELETE FROM recon_backlog_window"},
                    {"recon_consume_cursor", "DELETE FROM recon_consume_cursor WHERE scenario_code='zhg_order_integral'"},
                };
                for (String[] a : actions) {
                    try (Statement s = c.createStatement()) {
                        int n = s.executeUpdate(a[1]);
                        System.out.println("cleared " + a[0] + " = " + n);
                    } catch (Exception e) {
                        System.out.println("skip " + a[0] + " : " + e.getMessage());
                    }
                }
                c.commit();
                System.out.println("COMMIT ok");
            } catch (Exception e) {
                c.rollback();
                System.out.println("ROLLBACK: " + e.getMessage());
                throw e;
            }
        }
    }
}