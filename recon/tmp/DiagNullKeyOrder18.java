import java.sql.*;
import java.util.Properties;

public class DiagNullKeyOrder18 {
    public static void main(String[] args) throws Exception {
        String url = "jdbc:postgresql://10.254.16.6:5432/recon";
        Properties p = new Properties();
        p.setProperty("user", "mis");
        p.setProperty("password", "mis123");
        try (Connection c = DriverManager.getConnection(url, p)) {
            System.out.println("== recon_matched_index columns ==");
            DatabaseMetaData md = c.getMetaData();
            try (ResultSet rs = md.getColumns(null, null, "recon_matched_index", null)) {
                while (rs.next()) System.out.println("  " + rs.getString("COLUMN_NAME"));
            }
        }
    }
}
