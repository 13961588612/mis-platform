import java.sql.*;

public class DrillDetails {
    public static void main(String[] args) throws Exception {
        String url = "jdbc:postgresql://10.254.16.6:5432/recon";
        try (Connection c = DriverManager.getConnection(url, "mis", "mis123")) {
            // 1. 储值卡金额核对 全部差异明细（match_key_display 决定身份）
            System.out.println("== diffs of check=储值卡金额核对 ==");
            q(c, "SELECT diff_type, match_key_display, left_data_json, right_data_json FROM recon_detail WHERE scenario_code='zhg_order_integral' AND check_name='储值卡金额核对' ORDER BY id");
        }
    }
    static void q(Connection c, String sql) throws SQLException {
        System.out.println("--- " + sql);
        try (Statement st = c.createStatement(); ResultSet rs = st.executeQuery(sql)) {
            ResultSetMetaData md = rs.getMetaData();
            int n = md.getColumnCount();
            int rows = 0;
            while (rs.next() && rows < 60) {
                StringBuilder sb = new StringBuilder();
                for (int i = 1; i <= n; i++) {
                    if (i > 1) sb.append(" | ");
                    String v = rs.getString(i);
                    sb.append(md.getColumnName(i)).append("=").append(v == null ? "NULL" : (v.length() > 400 ? v.substring(0, 400) : v));
                }
                System.out.println("  " + sb);
                rows++;
            }
            if (rows == 0) System.out.println("  (no rows)");
            else System.out.println("  (" + rows + " rows shown)");
        }
    }
}
