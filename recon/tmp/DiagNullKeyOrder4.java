import java.sql.*;
import java.util.Properties;

public class DiagNullKeyOrder4 {
    public static void main(String[] args) throws Exception {
        String url = "jdbc:postgresql://10.254.16.6:5432/recon";
        Properties p = new Properties();
        p.setProperty("user", "mis");
        p.setProperty("password", "mis123");
        try (Connection c = DriverManager.getConnection(url, p)) {
            System.out.println("== A. recon_pull_run columns ==");
            DatabaseMetaData md = c.getMetaData();
            try (ResultSet rs = md.getColumns(null, null, "recon_pull_run", null)) {
                while (rs.next()) System.out.println("  " + rs.getString("COLUMN_NAME"));
            }
            System.out.println("\n== A2. last 5 pull runs for zhg_order ==");
            q(c, "SELECT * FROM recon_pull_run WHERE ds_code='zhg_order' ORDER BY id DESC LIMIT 5");
            System.out.println("\n== B. datasource config updated_at for zhg_order / zhg_public_coupon_order_flow ==");
            q(c, "SELECT ds_code,updated_at,created_at FROM recon_datasource WHERE ds_code IN ('zhg_order','zhg_public_coupon_order_flow')");
            System.out.println("\n== C. zhg_order records: any with order_main at all? & total count ==");
            q(c, "SELECT COUNT(*) AS total FROM recon_source_record WHERE ds_code='zhg_order'");
            q(c, "SELECT COUNT(*) AS with_om FROM recon_source_record WHERE ds_code='zhg_order' AND record_data::text LIKE '%order_main%'");
            System.out.println("\n== D. zhg_public_coupon_order_flow record count & latest ==");
            q(c, "SELECT COUNT(*) AS cnt, MAX(record_time) AS max_time FROM recon_source_record WHERE ds_code='zhg_public_coupon_order_flow'");
            System.out.println("\n== E. diff stats for 通用券对账 (anomaly empty keys) ==");
            q(c, "SELECT check_name,status,COUNT(*) FROM recon_detail WHERE scenario_code='zhg_order_integral' "
                    + "AND diff_type='anomaly' AND match_key_display LIKE '__nullkey__:%' "
                    + "GROUP BY check_name,status ORDER BY check_name");
            System.out.println("\n== F. latest pull runs for flow ds ==");
            q(c, "SELECT * FROM recon_pull_run "
                    + "WHERE ds_code='zhg_public_coupon_order_flow' ORDER BY id DESC LIMIT 5");
            System.out.println("\n== G. this order record's updated_at ==");
            q(c, "SELECT ds_code,record_key,update_seq,updated_at,last_pull_run_id FROM recon_source_record "
                    + "WHERE ds_code='zhg_order' AND record_key='1783664787136418'");
            System.out.println("\n== H. current pull 2474 status ==");
            q(c, "SELECT id,ds_code,status,window_start,window_end,row_count,insert_count,update_count,err_msg,started_at,finished_at "
                    + "FROM recon_pull_run WHERE id=2474");
            System.out.println("\n== I. recent zhg_order pulls BEFORE 2474 (last 3) ==");
            q(c, "SELECT id,ds_code,status,window_start,window_end,row_count,update_count,started_at "
                    + "FROM recon_pull_run WHERE ds_code='zhg_order' AND id<2474 ORDER BY id DESC LIMIT 3");
        }
    }

    static void q(Connection c, String sql) throws SQLException {
        System.out.println("--- " + sql.replaceAll("\\s+", " "));
        try (Statement st = c.createStatement(); ResultSet rs = st.executeQuery(sql)) {
            ResultSetMetaData md = rs.getMetaData();
            int n = md.getColumnCount();
            int rows = 0;
            while (rs.next() && rows < 20) {
                StringBuilder sb = new StringBuilder();
                for (int i = 1; i <= n; i++) {
                    if (i > 1) sb.append(" | ");
                    String v = rs.getString(i);
                    sb.append(md.getColumnName(i)).append("=").append(v == null ? "NULL" : v.length() > 250 ? v.substring(0, 250) : v);
                }
                System.out.println("  " + sb);
                rows++;
            }
            if (rows == 0) System.out.println("  (no rows)");
            else System.out.println("  (" + rows + " rows shown)");
        }
    }
}
