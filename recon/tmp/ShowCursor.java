import java.sql.*;
import java.util.Properties;

public class ShowCursor {
    public static void main(String[] args) throws Exception {
        String url = "jdbc:postgresql://10.254.16.6:5432/recon";
        Properties p = new Properties();
        p.setProperty("user", "mis");
        p.setProperty("password", "mis123");
        try (Connection c = DriverManager.getConnection(url, p)) {
            // 先打印列
            DatabaseMetaData md = c.getMetaData();
            try (ResultSet rs = md.getColumns(null, null, "recon_consume_cursor", null)) {
                while (rs.next()) System.out.println("col: " + rs.getString("COLUMN_NAME"));
            }
            System.out.println("-- rows --");
            try (Statement st = c.createStatement(); ResultSet rs = st.executeQuery("SELECT * FROM recon_consume_cursor")) {
                ResultSetMetaData m = rs.getMetaData();
                int n = m.getColumnCount();
                while (rs.next()) {
                    StringBuilder sb = new StringBuilder();
                    for (int i = 1; i <= n; i++) {
                        if (i > 1) sb.append(" | ");
                        String v = rs.getString(i);
                        sb.append(m.getColumnName(i)).append("=").append(v == null ? "NULL" : (v.length() > 80 ? v.substring(0, 80) : v));
                    }
                    System.out.println("  " + sb);
                }
            }
        }
    }
}