import java.sql.*;
import java.util.Properties;

public class CheckDiffCount {
    public static void main(String[] args) throws Exception {
        String url = "jdbc:postgresql://10.254.16.6:5432/recon";
        Properties p = new Properties();
        p.setProperty("user", "mis");
        p.setProperty("password", "mis123");
        try (Connection c = DriverManager.getConnection(url, p)) {
            String q = "SELECT status, handle_status, COUNT(*) FROM recon_detail "
                    + "GROUP BY status, handle_status ORDER BY 3 DESC";
            try (Statement st = c.createStatement(); ResultSet rs = st.executeQuery(q)) {
                System.out.println("===== 全库按 status/handle_status 分布 =====");
                while (rs.next()) {
                    System.out.println("  status=" + rs.getString(1) + " handle=" + rs.getString(2)
                            + " count=" + rs.getInt(3));
                }
            }
        }
    }
}
