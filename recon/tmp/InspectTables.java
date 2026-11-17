import java.sql.*;
import java.util.Properties;

public class InspectTables {
    public static void main(String[] args) throws Exception {
        String url = "jdbc:postgresql://10.254.16.6:5432/recon";
        Properties p = new Properties();
        p.setProperty("user", "mis");
        p.setProperty("password", "mis123");
        try (Connection c = DriverManager.getConnection(url, p)) {
            DatabaseMetaData md = c.getMetaData();
            try (ResultSet rs = md.getTables(null, null, "%", new String[]{"TABLE"})) {
                while (rs.next()) {
                    System.out.println(rs.getString("TABLE_NAME"));
                }
            }
        }
    }
}