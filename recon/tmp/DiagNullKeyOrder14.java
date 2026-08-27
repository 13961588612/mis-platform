import java.sql.*;
import java.util.Properties;

public class DiagNullKeyOrder14 {
    public static void main(String[] args) throws Exception {
        String url = "jdbc:postgresql://10.254.16.6:5432/recon";
        Properties p = new Properties();
        p.setProperty("user", "mis");
        p.setProperty("password", "mis123");
        try (Connection c = DriverManager.getConnection(url, p)) {
            System.out.println("== A. recon_detail involving this order ==");
            q(c, "SELECT id,check_name,diff_type,status,match_key_display,left_data_json,right_data_json,diff_desc "
                    + "FROM recon_detail WHERE match_key_display LIKE '%1786673845918822%'");
            System.out.println("\n== B. zhg_order source record with this key ==");
            q(c, "SELECT ds_code,record_key,update_seq,record_data,updated_at FROM recon_source_record "
                    + "WHERE ds_code='zhg_order' AND record_key='1786673845918822'");
            System.out.println("\n== C. any source record with this key (any ds) ==");
            q(c, "SELECT ds_code,record_key,record_data FROM recon_source_record WHERE record_key='1786673845918822'");
            System.out.println("\n== D. flow records mentioning this code ==");
            q(c, "SELECT ds_code,record_key,record_data FROM recon_source_record "
                    + "WHERE ds_code='zhg_public_coupon_order_flow' AND record_data::text LIKE '%1786673845918822%'");
            System.out.println("\n== E. zhg_order near this code (record_key range) ==");
            q(c, "SELECT record_key,record_data FROM recon_source_record WHERE ds_code='zhg_order' "
                    + "AND record_key BETWEEN '1786670000000000' AND '1786679999999999' LIMIT 10");
        }
    }
    static void q(Connection c, String sql) throws SQLException {
        System.out.println("--- " + sql.replaceAll("\\s+", " "));
        try (Statement st = c.createStatement(); ResultSet rs = st.executeQuery(sql)) {
            ResultSetMetaData md = rs.getMetaData();
            int n = md.getColumnCount();
            int rows = 0;
            while (rs.next() && rows < 15) {
                StringBuilder sb = new StringBuilder();
                for (int i = 1; i <= n; i++) {
                    if (i > 1) sb.append(" | ");
                    String v = rs.getString(i);
                    sb.append(md.getColumnName(i)).append("=").append(v == null ? "NULL" : v.length() > 2000 ? v.substring(0, 2000) : v);
                }
                System.out.println("  " + sb);
                rows++;
            }
            if (rows == 0) System.out.println("  (no rows)");
        }
    }
}
