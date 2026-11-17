import java.sql.*;
import java.util.Properties;

public class SnapshotCounts {
    public static void main(String[] args) throws Exception {
        String url = "jdbc:postgresql://10.254.16.6:5432/recon";
        Properties p = new Properties();
        p.setProperty("user", "mis");
        p.setProperty("password", "mis123");
        try (Connection c = DriverManager.getConnection(url, p)) {
            String[] tables = {"recon_detail","recon_detail_source_ref","recon_diff_handle","recon_diff_status_history",
                    "recon_matched_index","recon_run","recon_report_run","recon_alert_log","recon_backlog_window","recon_consume_cursor"};
            for (String t : tables) {
                try (Statement s = c.createStatement(); ResultSet rs = s.executeQuery("SELECT COUNT(*) FROM " + t)) {
                    rs.next();
                    System.out.println(t + " = " + rs.getLong(1));
                } catch (Exception e) {
                    System.out.println(t + " = ERR " + e.getMessage());
                }
            }
        }
    }
}