import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;

import java.sql.*;
import java.util.*;

public class InspectAliasAll {
    static final ObjectMapper M = new ObjectMapper();

    public static void main(String[] args) throws Exception {
        String url = "jdbc:postgresql://10.254.16.6:5432/recon";
        Properties p = new Properties();
        p.setProperty("user", "mis");
        p.setProperty("password", "mis123");
        try (Connection c = DriverManager.getConnection(url, p)) {
            // 1) consume_json 里的 alias -> ds_code 映射
            Map<String, String> alias2ds = new LinkedHashMap<>();
            Set<String> dsAliases = new HashSet<>();
            try (Statement st = c.createStatement();
                 ResultSet rs = st.executeQuery(
                         "SELECT scenario_code, check_name, consume_json FROM recon_check ORDER BY scenario_code, seq_no")) {
                while (rs.next()) {
                    String sc = rs.getString(1), cn = rs.getString(2), cj = rs.getString(3);
                    if (cj == null) continue;
                    JsonNode n = M.readTree(cj);
                    if (!n.isObject()) continue;
                    Iterator<Map.Entry<String, JsonNode>> it = n.fields();
                    while (it.hasNext()) {
                        Map.Entry<String, JsonNode> e = it.next();
                        JsonNode row = e.getValue();
                        if (row == null || !row.isObject() || !row.hasNonNull("ds_code")) continue;
                        String alias = e.getKey();
                        String ds = row.get("ds_code").asText();
                        if (alias2ds.containsKey(alias) && !alias2ds.get(alias).equals(ds)) {
                            System.out.println("!! alias 复用冲突(跨check): alias=" + alias + " ds=" + ds
                                    + " 已有=" + alias2ds.get(alias) + " @" + sc + "/" + cn);
                        }
                        alias2ds.put(alias, ds);
                    }
                }
            }
            System.out.println("== alias->ds 映射（alias != ds_code 的）==");
            boolean any = false;
            for (Map.Entry<String, String> e : alias2ds.entrySet()) {
                if (!e.getKey().equals(e.getValue())) {
                    System.out.println("  " + e.getKey() + " -> " + e.getValue());
                    any = true;
                }
            }
            if (!any) System.out.println("  (全部 alias == ds_code)");

            // 2) 各 check 的 key_fields_json / compare rules 里引用的前缀
            System.out.println("\n== key_fields_json 前缀（应为 ds_code 或 alias） ==");
            try (Statement st = c.createStatement();
                 ResultSet rs = st.executeQuery(
                         "SELECT scenario_code, check_name, match_rule->>'key_fields_json' k, compare_rule->>'rules_json' cf "
                                 + "FROM recon_check ORDER BY scenario_code, seq_no")) {
                while (rs.next()) {
                    String sc = rs.getString(1), cn = rs.getString(2);
                    System.out.println("-- " + sc + " / " + cn);
                    String kf = rs.getString(3);
                    if (kf != null) try { System.out.println("   key_fields: " + kf); } catch (Exception ex) { System.out.println("   key_fields: (bad)"); }
                    String cf = rs.getString(4);
                    if (cf != null) {
                        JsonNode arr = M.readTree(cf);
                        if (arr.isArray()) {
                            for (JsonNode r : arr) {
                                String lf = r.path("left_field").asText();
                                String rf = r.path("right_field").asText();
                                System.out.println("   compare: left=" + lf + " right=" + rf);
                            }
                        }
                    }
                }
            }
        }
    }
}