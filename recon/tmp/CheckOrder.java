import java.sql.*;
import java.util.Properties;

public class CheckOrder {
    public static void main(String[] args) throws Exception {
        String url = "jdbc:postgresql://10.254.16.6:5432/recon";
        Properties p = new Properties();
        p.setProperty("user", "mis");
        p.setProperty("password", "mis123");
        try (Connection c = DriverManager.getConnection(url, p)) {
            q(c, "SELECT record_key, record_data FROM recon_source_record WHERE ds_code='zhg_order' "
                    + "AND record_data::text LIKE '%1786673845918822%'");
            q(c, "SELECT record_key, record_data FROM recon_source_record WHERE ds_code='zhg_order' "
                    + "AND record_data::text LIKE '%146947%' OR record_data::text LIKE '%146811%' OR record_data::text LIKE '%146794%'");
        }
    }
    static void q(Connection c, String sql) throws Exception {
        System.out.println("-- " + sql);
        try (Statement st = c.createStatement(); ResultSet rs = st.executeQuery(sql)) {
            while (rs.next()) {
                String k = rs.getString(1);
                String d = rs.getString(2);
                System.out.println("  key=" + k + " data=" + (d == null ? "NULL" : d));
            }
        }
    }
}