import java.sql.*;
import java.util.*;

public class CzkType7 {
    public static void main(String[] args) throws Exception {
        String czkUrl = "jdbc:oracle:thin:@10.254.16.211:1521:thdczk";
        String mysqlUrl = "jdbc:mysql://10.254.16.219:3306/huadi2?useUnicode=true&characterEncoding=UTF-8&serverTimezone=GMT%2B8&useSSL=false";

        try (Connection czk = DriverManager.getConnection(czkUrl, "bfcrm8", "DHHZDHHZ");
             Connection m = DriverManager.getConnection(mysqlUrl, "root", "mysql")) {

            System.out.println("== ELEC_CASH_CARD_RECORD app_id distribution (all) ==");
            q(czk, "SELECT app_id, type, is_cancel, COUNT(*) FROM ELEC_CASH_CARD_RECORD GROUP BY app_id, type, is_cancel ORDER BY 1, 4 DESC", 80);
            System.out.println("== app_id distribution (top by count) ==");
            q(czk, "SELECT app_id, COUNT(*) FROM ELEC_CASH_CARD_RECORD GROUP BY app_id ORDER BY 2 DESC", 80);

            // sample order full row
            System.out.println("== order code=1786675260776112 full ==");
            q(m, "SELECT id, code, trad_id, cash_card, amount, pay_time FROM `order` WHERE code='1786675260776112'", 60);
            // check its id in flow.tran_id
            System.out.println("== flow rows where tran_id = 146794 ==");
            q(czk, "SELECT id, tran_id, order_no, amount, app_id, type, is_cancel, create_time FROM ELEC_CASH_CARD_RECORD WHERE tran_id = 146794", 60);

            // 2026 orders cash_card>0: how many trad_id hits flow.tran_id (all app_ids)
            Map<Integer, String> flowTranToApp = new HashMap<>();
            try (Statement st = czk.createStatement(); ResultSet rs = st.executeQuery(
                    "SELECT tran_id, app_id FROM ELEC_CASH_CARD_RECORD WHERE type = 0 AND is_cancel = 0")) {
                while (rs.next()) flowTranToApp.put(rs.getInt(1), rs.getString(2));
            }
            Map<String, Integer> hitByApp = new TreeMap<>();
            int noHit = 0, total = 0;
            try (Statement st = m.createStatement(); ResultSet rs = st.executeQuery(
                    "SELECT trad_id FROM `order` WHERE cash_card>0 AND pay_time >= '2026-01-01'")) {
                while (rs.next()) {
                    String v = rs.getString(1);
                    if (v == null || v.trim().isEmpty()) continue;
                    total++;
                    try {
                        String app = flowTranToApp.get(Integer.parseInt(v.trim()));
                        if (app != null) hitByApp.merge(app, 1, Integer::sum);
                        else noHit++;
                    } catch (NumberFormatException ignore) { noHit++; }
                }
            }
            System.out.println("orders cash_card>0(2026, trad_id non-empty)=" + total
                    + " hit flow.tran_id by app=" + hitByApp + " noHit=" + noHit);
        }
    }
    static void q(Connection c, String sql, int maxRows) throws SQLException {
        System.out.println("--- " + sql);
        try (Statement st = c.createStatement(); ResultSet rs = st.executeQuery(sql)) {
            ResultSetMetaData md = rs.getMetaData();
            int n = md.getColumnCount();
            int rows = 0;
            while (rs.next() && rows < maxRows) {
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
