import java.sql.*;
import java.util.*;

public class CzkType5 {
    public static void main(String[] args) throws Exception {
        String czkUrl = "jdbc:oracle:thin:@10.254.16.211:1521:thdczk";
        String mysqlUrl = "jdbc:mysql://10.254.16.219:3306/huadi2?useUnicode=true&characterEncoding=UTF-8&serverTimezone=GMT%2B8&useSSL=false";

        try (Connection czk = DriverManager.getConnection(czkUrl, "bfcrm8", "DHHZDHHZ");
             Connection m = DriverManager.getConnection(mysqlUrl, "root", "mysql")) {

            // flow type=0: id / tran_id
            Set<Integer> flowIds = new HashSet<>();
            Set<Integer> flowTranIds = new HashSet<>();
            try (Statement st = czk.createStatement(); ResultSet rs = st.executeQuery(
                    "SELECT id, tran_id FROM ELEC_CASH_CARD_RECORD WHERE type = 0 AND is_cancel = 0 AND app_id = 4")) {
                while (rs.next()) { flowIds.add(rs.getInt(1)); flowTranIds.add(rs.getInt(2)); }
            }
            System.out.println("type=0 flows: ids=" + flowIds.size() + " tran_ids=" + flowTranIds.size());

            // orders with cash_card>0 (2026) -> trad_id
            List<Integer> tradIds = new ArrayList<>();
            try (Statement st = m.createStatement(); ResultSet rs = st.executeQuery(
                    "SELECT trad_id FROM `order` WHERE cash_card>0 AND pay_time >= '2026-01-01'")) {
                while (rs.next()) {
                    String v = rs.getString(1);
                    if (v != null && !v.trim().isEmpty()) {
                        try { tradIds.add(Integer.parseInt(v.trim())); } catch (NumberFormatException ignore) {}
                    }
                }
            }
            System.out.println("orders cash_card>0 (2026) with trad_id: " + tradIds.size());
            Set<Integer> tradSet = new HashSet<>(tradIds);

            int inFlowId = 0, inFlowTran = 0, inBoth = 0;
            for (int t : tradSet) {
                boolean b1 = flowIds.contains(t);
                boolean b2 = flowTranIds.contains(t);
                if (b1) inFlowId++;
                if (b2) inFlowTran++;
                if (b1 && b2) inBoth++;
            }
            System.out.println("order.trad_id in flow.ID:     " + inFlowId);
            System.out.println("order.trad_id in flow.TRAN_ID: " + inFlowTran);
            System.out.println("order.trad_id in both:         " + inBoth);

            // flow 侧：有多少 type=0 的 tran_id 能被 order.trad_id 命中（2026 订单）
            int flowHit = 0;
            for (int t : flowTranIds) if (tradSet.contains(t)) flowHit++;
            System.out.println("flow.TRAN_ID hit by order.trad_id(2026): " + flowHit + "/" + flowTranIds.size());
        }
    }
}
