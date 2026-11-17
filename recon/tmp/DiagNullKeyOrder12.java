import java.sql.*;
import java.util.Properties;

public class DiagNullKeyOrder12 {
    public static void main(String[] args) throws Exception {
        String url = "jdbc:postgresql://10.254.16.6:5432/recon";
        Properties p = new Properties();
        p.setProperty("user", "mis");
        p.setProperty("password", "mis123");
        try (Connection c = DriverManager.getConnection(url, p)) {
            System.out.println("== running / recent recon runs ==");
            q(c, "SELECT id,status,now()-started_at AS elapsed,started_at,finished_at FROM recon_run ORDER BY id DESC LIMIT 6");
        }
    }
    static void q(Connection c, String sql) throws SQLException {
        System.out.println("--- " + sql.replaceAll("\\s+", " "));
        try (Statement st = c.createStatement(); ResultSet rs = st.executeQuery(sql)) {
            ResultSetMetaData md = rs.getMetaData();
            int n = md.getColumnCount();
            while (rs.next()) {
                StringBuilder sb = new StringBuilder();
                for (int i = 1; i <= n; i++) {
                    if (i > 1) sb.append(" | ");
                    sb.append(md.getColumnName(i)).append("=").append(rs.getString(i));
                }
                System.out.println("  " + sb);
            }
        }
    }
}
