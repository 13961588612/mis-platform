import java.sql.*;
import java.util.Properties;

public class DiagNullKeyOrder3 {
    public static void main(String[] args) throws Exception {
        String myurl = "jdbc:mysql://10.254.16.219:3306/huadi2?useUnicode=true&characterEncoding=UTF-8&serverTimezone=GMT%2B8&useSSL=false";
        try (Connection mc = DriverManager.getConnection(myurl, "root", "mysql")) {
            System.out.println("== A. order_main table exists? ==");
            q(mc, "SHOW TABLES LIKE 'order_main'");
            System.out.println("== B. order_main columns ==");
            q(mc, "SELECT COLUMN_NAME, DATA_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='huadi2' AND TABLE_NAME='order_main' ORDER BY ORDINAL_POSITION");
            System.out.println("\n== C. order_main row count & sample ==");
            q(mc, "SELECT COUNT(*) AS cnt FROM order_main");
            q(mc, "SELECT * FROM order_main ORDER BY 1 DESC LIMIT 5");
            System.out.println("\n== D. the specific order in `order` ==");
            q(mc, "SELECT code, id, amount, public_coupon_amount, pay_time FROM `order` WHERE code='1783664787136418'");
            System.out.println("\n== E. its order_main row ==");
            q(mc, "SELECT * FROM order_main WHERE order_code='1783664787136418'");
            System.out.println("\n== F. run the exact fetch SQL for the window around its pay_time ==");
            q(mc, "select o.code, o.amount, o.public_coupon_amount, o.trad_id, om.order_main \n"
                    + "from `order` o \n"
                    + "left join order_main om on om.order_code = o.code \n"
                    + "where o.pay_time >= '2026-07-09 00:00:00' and o.pay_time < '2026-07-11 00:00:00' \n"
                    + "limit 10");
            System.out.println("\n== G. count orders with order_main via join (whole table) ==");
            q(mc, "SELECT COUNT(*) AS cnt FROM `order` o LEFT JOIN order_main om ON om.order_code=o.code WHERE om.order_main IS NOT NULL");
            System.out.println("\n== H. `order` columns mentioning main/code ==");
            q(mc, "SELECT COLUMN_NAME, DATA_TYPE, COLUMN_COMMENT FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='huadi2' AND TABLE_NAME='order' AND COLUMN_NAME IN ('code','order_main','order_no','id')");
        }
    }

    static void q(Connection c, String sql) throws SQLException {
        System.out.println("--- " + sql.replaceAll("\\s+", " "));
        try (Statement st = c.createStatement(); ResultSet rs = st.executeQuery(sql)) {
            ResultSetMetaData md = rs.getMetaData();
            int n = md.getColumnCount();
            int rows = 0;
            while (rs.next() && rows < 10) {
                StringBuilder sb = new StringBuilder();
                for (int i = 1; i <= n; i++) {
                    if (i > 1) sb.append(" | ");
                    String v = rs.getString(i);
                    sb.append(md.getColumnName(i)).append("=").append(v == null ? "NULL" : v.length() > 200 ? v.substring(0, 200) : v);
                }
                System.out.println("  " + sb);
                rows++;
            }
            if (rows == 0) System.out.println("  (no rows)");
            else System.out.println("  (" + rows + " rows shown)");
        }
    }
}
