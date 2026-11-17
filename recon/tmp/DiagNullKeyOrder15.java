import java.sql.*;
import java.util.Properties;

public class DiagNullKeyOrder15 {
    public static void main(String[] args) throws Exception {
        String url = "jdbc:postgresql://10.254.16.6:5432/recon";
        Properties p = new Properties();
        p.setProperty("user", "mis");
        p.setProperty("password", "mis123");
        try (Connection c = DriverManager.getConnection(url, p)) {
            System.out.println("== A. the unmatched_right diff row ==");
            q(c, "SELECT id,check_name,diff_type,status,match_key_display,created_at,updated_at,confirmed_at,resolved_at "
                    + "FROM recon_detail WHERE match_key_display='1786673845918822_ZDD1786673875918502'");
            System.out.println("\n== B. its status history ==");
            q(c, "SELECT detail_id,from_status,to_status,reason,operator,created_at FROM recon_diff_status_history "
                    + "WHERE detail_id IN (SELECT id FROM recon_detail WHERE match_key_display LIKE '%1786673845918822%') ORDER BY created_at");
            System.out.println("\n== C. matched_index for 通用券对账 with this key ==");
            q(c, "SELECT match_key_hash,match_key_display,ds_code,record_key,record_time FROM recon_matched_index "
                    + "WHERE scenario_code='zhg_order_integral' AND check_name='通用券对账' AND match_key_display LIKE '%1786673845918822%'");
            System.out.println("\n== D. matched_index count for 通用券对账 ==");
            q(c, "SELECT match_key_display,ds_code,record_key FROM recon_matched_index "
                    + "WHERE scenario_code='zhg_order_integral' AND check_name='通用券对账' LIMIT 20");
            System.out.println("\n== E. pool open query result (通用券对账 pool rows) ==");
            q(c, "SELECT d.id,d.diff_type,d.status,d.match_key_display,r.side,r.ds_code,r.record_key FROM recon_detail d "
                    + "JOIN recon_detail_source_ref r ON r.detail_id=d.id "
                    + "WHERE d.scenario_code='zhg_order_integral' AND d.check_name='通用券对账' "
                    + "AND r.ds_code='zhg_public_coupon_order_flow'");
        }
    }
    static void q(Connection c, String sql) throws SQLException {
        System.out.println("--- " + sql.replaceAll("\\s+", " "));
        try (Statement st = c.createStatement(); ResultSet rs = st.executeQuery(sql)) {
            ResultSetMetaData md = rs.getMetaData();
            int n = md.getColumnCount();
            int rows = 0;
            while (rs.next() && rows < 30) {
                StringBuilder sb = new StringBuilder();
                for (int i = 1; i <= n; i++) {
                    if (i > 1) sb.append(" | ");
                    String v = rs.getString(i);
                    sb.append(md.getColumnName(i)).append("=").append(v == null ? "NULL" : v.length() > 100 ? v.substring(0, 100) : v);
                }
                System.out.println("  " + sb);
                rows++;
            }
            if (rows == 0) System.out.println("  (no rows)");
        }
    }
}
