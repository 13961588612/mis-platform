import java.sql.*;
import java.util.Properties;

public class DiagNullKeyOrder2 {
    public static void main(String[] args) throws Exception {
        // ---- recon platform DB ----
        String url = "jdbc:postgresql://10.254.16.6:5432/recon";
        Properties p = new Properties();
        p.setProperty("user", "mis");
        p.setProperty("password", "mis123");
        try (Connection c = DriverManager.getConnection(url, p)) {
            System.out.println("== A. zhg datasources config ==");
            q(c, "SELECT ds_code,name,conn_code,record_key_expression,time_field,fetch_config_json,fields_json "
                    + "FROM recon_datasource WHERE ds_code IN ('zhg_order','zhg_public_coupon_order_flow')");
            System.out.println("\n== B. zhg_order samples WITH order_main (check field exists) ==");
            q(c, "SELECT record_key, record_data FROM recon_source_record WHERE ds_code='zhg_order' "
                    + "AND record_data::text LIKE '%order_main%' ORDER BY update_seq DESC LIMIT 3");
            System.out.println("\n== B2. zhg_order count: has order_main vs not (last 10k) ==");
            q(c, "SELECT (record_data::text LIKE '%order_main%') AS has_om, COUNT(*) FROM "
                    + "(SELECT record_data FROM recon_source_record WHERE ds_code='zhg_order' ORDER BY update_seq DESC LIMIT 10000) t GROUP BY 1");
            System.out.println("\n== E. flow rows with code=1783664787136418 ==");
            q(c, "SELECT ds_code, record_key, record_data FROM recon_source_record WHERE ds_code='zhg_public_coupon_order_flow' AND record_data::text LIKE '%1783664787136418%' LIMIT 5");
        }

        // ---- zhg MySQL source ----
        String myurl = "jdbc:mysql://10.254.16.219:3306/huadi2?useUnicode=true&characterEncoding=UTF-8&serverTimezone=GMT%2B8&useSSL=false";
        try (Connection mc = DriverManager.getConnection(myurl, "root", "")) {
            System.out.println("\n== F. `order` table columns containing 'main' or 'code' ==");
            q(mc, "SELECT COLUMN_NAME, DATA_TYPE, COLUMN_COMMENT FROM information_schema.COLUMNS "
                    + "WHERE TABLE_SCHEMA='huadi2' AND TABLE_NAME='order' AND (COLUMN_NAME LIKE '%main%' OR COLUMN_NAME IN ('code','id','order_no'))");
            System.out.println("\n== G. the specific order in MySQL ==");
            q(mc, "SELECT code, id, order_main, amount, pay_time FROM `order` WHERE code='1783664787136418'");
            System.out.println("\n== H. orders that used public coupon recently (order_main not null?) ==");
            q(mc, "SELECT code, order_main, public_coupon_amount, amount, pay_time FROM `order` "
                    + "WHERE public_coupon_amount>0 AND pay_time>='2026-08-01' ORDER BY pay_time DESC LIMIT 8");
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
                    sb.append(md.getColumnName(i)).append("=").append(v == null ? "NULL" : v.length() > 1500 ? v.substring(0, 1500) : v);
                }
                System.out.println("  " + sb);
                rows++;
            }
            if (rows == 0) System.out.println("  (no rows)");
            else System.out.println("  (" + rows + " rows shown)");
        }
    }
}
