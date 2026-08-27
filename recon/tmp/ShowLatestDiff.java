import java.sql.*;
import java.util.Properties;

public class ShowLatestDiff {
    public static void main(String[] args) throws Exception {
        String url = "jdbc:postgresql://10.254.16.6:5432/recon";
        Properties p = new Properties();
        p.setProperty("user", "mis");
        p.setProperty("password", "mis123");
        try (Connection c = DriverManager.getConnection(url, p)) {
            // check_name 中文直接在 UTF-8 控制台显示
            String sql = "SELECT check_name, diff_type, COUNT(*) FROM recon_detail WHERE scenario_code='zhg_order_integral' GROUP BY check_name, diff_type ORDER BY 3 DESC, 1 LIMIT 20";
            try (Statement st = c.createStatement(); ResultSet rs = st.executeQuery(sql)) {
                ResultSetMetaData md = rs.getMetaData();
                int n = md.getColumnCount();
                while (rs.next()) {
                    StringBuilder sb = new StringBuilder();
                    for (int i = 1; i <= n; i++) {
                        if (i > 1) sb.append(" | ");
                        String v = rs.getString(i);
                        sb.append(md.getColumnName(i)).append("=").append(v == null ? "NULL" : (v.length() > 200 ? v.substring(0, 200) : v));
                    }
                    System.out.println("  " + sb);
                }
            }
        }
    }
}