import java.sql.*;

public class CzkType {
    public static void main(String[] args) throws Exception {
        String url = "jdbc:oracle:thin:@10.254.16.211:1521:thdczk";
        try (Connection c = DriverManager.getConnection(url, "bfcrm8", "DHHZDHHZ")) {
            System.out.println("== type distribution (app_id=4, is_cancel=0) ==");
            q(c, "SELECT type, COUNT(*) FROM ELEC_CASH_CARD_RECORD WHERE app_id = 4 AND is_cancel = 0 GROUP BY type ORDER BY 2 DESC");
            System.out.println("== type distribution (app_id=4 all) ==");
            q(c, "SELECT type, is_cancel, COUNT(*) FROM ELEC_CASH_CARD_RECORD WHERE app_id = 4 GROUP BY type, is_cancel ORDER BY 3 DESC");
            System.out.println("== sample per type (app_id=4, is_cancel=0, recent 5 per type) ==");
            q(c, "SELECT * FROM (SELECT type, id, tran_id, amount, create_time, ROW_NUMBER() OVER (PARTITION BY type ORDER BY create_time DESC) rn " +
                 "FROM ELEC_CASH_CARD_RECORD WHERE app_id = 4 AND is_cancel = 0) t WHERE rn <= 5 ORDER BY type, rn");
            System.out.println("== count total & type=0 vs others (app_id=4, is_cancel=0) ==");
            q(c, "SELECT COUNT(*), SUM(CASE WHEN type = 0 THEN 1 ELSE 0 END), SUM(CASE WHEN type != 0 THEN 1 ELSE 0 END) " +
                 "FROM ELEC_CASH_CARD_RECORD WHERE app_id = 4 AND is_cancel = 0");
        }
    }
    static void q(Connection c, String sql) throws SQLException {
        System.out.println("--- " + sql);
        try (Statement st = c.createStatement(); ResultSet rs = st.executeQuery(sql)) {
            ResultSetMetaData md = rs.getMetaData();
            int n = md.getColumnCount();
            int rows = 0;
            while (rs.next() && rows < 40) {
                StringBuilder sb = new StringBuilder();
                for (int i = 1; i <= n; i++) {
                    if (i > 1) sb.append(" | ");
                    String v = rs.getString(i);
                    sb.append(md.getColumnName(i)).append("=").append(v == null ? "NULL" : v);
                }
                System.out.println("  " + sb);
                rows++;
            }
            if (rows == 0) System.out.println("  (no rows)");
        }
    }
}
