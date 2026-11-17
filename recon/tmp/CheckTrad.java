import java.sql.*;
import java.util.Properties;

public class CheckTrad {
    public static void main(String[] args) throws Exception {
        String url = "jdbc:postgresql://10.254.16.6:5432/recon";
        Properties p = new Properties();
        p.setProperty("user", "mis");
        p.setProperty("password", "mis123");
        try (Connection c = DriverManager.getConnection(url, p)) {
            q(c, "SELECT record_key, record_data FROM recon_source_record WHERE ds_code='zhg_order' "
                    + "AND record_data::text LIKE '%\"trad_id\":\"146947\"%'");
            q(c, "SELECT record_key, record_data FROM recon_source_record WHERE ds_code='zhg_order' "
                    + "AND record_data::text LIKE '%\"trad_id\":\"146811\"%'");
            q(c, "SELECT record_key, record_data FROM recon_source_record WHERE ds_code='zhg_order' "
                    + "AND record_data::text LIKE '%\"trad_id\":\"146794\"%'");
            // 所有非空 trad_id 的订单
            q(c, "SELECT record_key, record_data->>'trad_id' trad_id, record_data->>'cash_card' cash_card, record_data->>'code' code "
                    + "FROM recon_source_record WHERE ds_code='zhg_order' "
                    + "AND record_data->>'trad_id' IS NOT NULL AND record_data->>'trad_id' <> ''");
        }
    }
    static void q(Connection c, String sql) throws Exception {
        System.out.println("-- " + sql);
        try (Statement st = c.createStatement(); ResultSet rs = st.executeQuery(sql)) {
            while (rs.next()) {
                StringBuilder sb = new StringBuilder();
                int n = rs.getMetaData().getColumnCount();
                for (int i = 1; i <= n; i++) {
                    if (i > 1) sb.append(" | ");
                    String v = rs.getString(i);
                    sb.append(rs.getMetaData().getColumnName(i)).append("=").append(v == null ? "NULL" : v);
                }
                System.out.println("  " + sb);
            }
        }
    }
}