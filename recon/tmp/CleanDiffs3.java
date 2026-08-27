import java.sql.*;

public class CleanDiffs3 {
    public static void main(String[] args) throws Exception {
        String url = "jdbc:postgresql://10.254.16.6:5432/recon";
        String user = "mis";
        String pass = "mis123";
        try (Connection c = DriverManager.getConnection(url, user, pass)) {
            c.setAutoCommit(false);
            try {
                String[] tables = {
                    "recon_detail_source_ref", "recon_diff_handle", "recon_diff_status_history",
                    "recon_detail", "recon_matched_index", "recon_run", "recon_report_run",
                    "recon_alert_log", "recon_backlog_window"
                };
                for (String t : tables) {
                    try (Statement s = c.createStatement()) {
                        int n = s.executeUpdate("DELETE FROM " + t);
                        System.out.println("deleted " + t + " = " + n);
                    }
                }
                try (Statement s = c.createStatement()) {
                    int n = s.executeUpdate(
                        "DELETE FROM recon_consume_cursor WHERE ds_code IN ('zhg_order','crm_zhg_integral_flow')");
                    System.out.println("deleted cursor = " + n);
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