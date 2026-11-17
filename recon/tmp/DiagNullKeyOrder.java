import java.sql.*;
import java.util.Properties;

public class DiagNullKeyOrder {
    public static void main(String[] args) throws Exception {
        String url = "jdbc:postgresql://10.254.16.6:5432/recon";
        Properties p = new Properties();
        p.setProperty("user", "mis");
        p.setProperty("password", "mis123");
        try (Connection c = DriverManager.getConnection(url, p)) {
            System.out.println("== 1. checks of zhg_order_integral ==");
            q(c, "SELECT check_name,seq_no,run_mode,enabled FROM recon_check WHERE scenario_code='zhg_order_integral' ORDER BY seq_no");
            System.out.println("\n== 1b. recon_match_rule columns ==");
            DatabaseMetaData md = c.getMetaData();
            try (ResultSet rs = md.getColumns(null, null, "recon_match_rule", null)) {
                while (rs.next()) System.out.println("  " + rs.getString("COLUMN_NAME"));
            }
            System.out.println("\n== 1c. recon_detail columns ==");
            try (ResultSet rs = md.getColumns(null, null, "recon_detail", null)) {
                while (rs.next()) System.out.println("  " + rs.getString("COLUMN_NAME"));
            }
            System.out.println("\n== 2. match rules of zhg_order_integral ==");
            q(c, "SELECT check_name,strategy,datasets_json,key_fields_json,field_transform_json,multi_row_json "
                    + "FROM recon_match_rule WHERE scenario_code='zhg_order_integral' ORDER BY check_name");
            System.out.println("\n== 3. diff row for the nullkey order ==");
            q(c, "SELECT id,check_name,diff_type,status,match_key_display,left_data_json,right_data_json,diff_desc,diff_diagnosis_json "
                    + "FROM recon_detail WHERE scenario_code='zhg_order_integral' AND match_key_display='__nullkey__:zhg_order:1783664787136418'");
            System.out.println("\n== 4. zhg_order source record 1783664787136418 ==");
            q(c, "SELECT record_key,update_seq,record_data FROM recon_source_record WHERE ds_code='zhg_order' AND record_key='1783664787136418'");
            System.out.println("\n== 5. any same order key in other source records ==");
            q(c, "SELECT ds_code,record_key,record_data FROM recon_source_record WHERE record_key='1783664787136418'");
        }
    }

    static void q(Connection c, String sql) throws SQLException {
        System.out.println("--- " + sql);
        try (Statement st = c.createStatement(); ResultSet rs = st.executeQuery(sql)) {
            ResultSetMetaData md = rs.getMetaData();
            int n = md.getColumnCount();
            int rows = 0;
            while (rs.next() && rows < 20) {
                StringBuilder sb = new StringBuilder();
                for (int i = 1; i <= n; i++) {
                    if (i > 1) sb.append(" | ");
                    String v = rs.getString(i);
                    sb.append(md.getColumnName(i)).append("=").append(v == null ? "NULL" : v.length() > 3000 ? v.substring(0, 3000) : v);
                }
                System.out.println("  " + sb);
                rows++;
            }
            if (rows == 0) System.out.println("  (no rows)");
            else System.out.println("  (" + rows + " rows shown)");
        }
    }
}
