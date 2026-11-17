import java.sql.*;
import java.util.Properties;

public class CheckIntegral {
    public static void main(String[] args) throws Exception {
        String url = "jdbc:postgresql://10.254.16.6:5432/recon";
        Properties p = new Properties();
        p.setProperty("user", "mis");
        p.setProperty("password", "mis123");
        try (Connection c = DriverManager.getConnection(url, p)) {
            q(c, "SELECT record_key, record_data->>'code' code, record_data->>'int_num' int_num, record_data->>'int_amount' int_amount "
                    + "FROM recon_source_record WHERE ds_code='zhg_order' "
                    + "AND (record_data->>'code' = '1786440322310512' OR record_data::text LIKE '%1786440322310512%')");
            q(c, "SELECT record_key, record_data->>'DJH' djh, record_data->>'WCLJFBD' wcljfbd, record_data->>'JLBH' jlbh "
                    + "FROM recon_source_record WHERE ds_code='crm_zhg_integral_flow' "
                    + "AND (record_data->>'DJH' = '1786440322310512' OR record_data::text LIKE '%1786440322310512%')");
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