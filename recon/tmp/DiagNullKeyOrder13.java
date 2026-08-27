import java.sql.*;
import java.util.Properties;

public class DiagNullKeyOrder13 {
    public static void main(String[] args) throws Exception {
        String url = "jdbc:postgresql://10.254.16.6:5432/recon";
        Properties p = new Properties();
        p.setProperty("user", "mis");
        p.setProperty("password", "mis123");
        try (Connection c = DriverManager.getConnection(url, p)) {
            System.out.println("== A. diff by type/status ==");
            q(c, "SELECT diff_type,status,count(*) FROM recon_detail GROUP BY diff_type,status ORDER BY diff_type,status");
            System.out.println("\n== B. diff by check/type ==");
            q(c, "SELECT check_name,diff_type,count(*) FROM recon_detail GROUP BY check_name,diff_type ORDER BY check_name,diff_type");
            System.out.println("\n== C. the specific order any diff? ==");
            q(c, "SELECT id,check_name,diff_type,match_key_display FROM recon_detail WHERE scenario_code='zhg_order_integral' "
                    + "AND match_key_display LIKE '%1783664787136418%'");
            System.out.println("\n== D. last recon run ==");
            q(c, "SELECT id,status,matched_count,diff_count,resolved_count,err_msg FROM recon_run ORDER BY id DESC LIMIT 3");
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
                    sb.append(md.getColumnName(i)).append("=").append(rs.getString(i));
                }
                System.out.println("  " + sb);
                rows++;
            }
            if (rows == 0) System.out.println("  (no rows)");
        }
    }
}
