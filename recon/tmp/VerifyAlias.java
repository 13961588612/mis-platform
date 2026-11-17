import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

import java.sql.*;
import java.util.*;

/**
 * 校验：1) 同场景内同一 ds_code 的 alias 是否一致（AliasValidator 规则）
 *       2) key_fields/rules 前缀是否都在 consume_json 中已定义，且不再有中文/旧别名残留
 */
public class VerifyAlias {
    static final ObjectMapper M = new ObjectMapper();

    public static void main(String[] args) throws Exception {
        String url = "jdbc:postgresql://10.254.16.6:5432/recon";
        Properties p = new Properties();
        p.setProperty("user", "mis");
        p.setProperty("password", "mis123");
        boolean any = false;
        try (Connection c = DriverManager.getConnection(url, p)) {
            Map<String, Map<String, String>> sceneDsAlias = new LinkedHashMap<>(); // scene -> ds -> alias
            Map<String, Map<String, String>> sceneAliasDs = new LinkedHashMap<>(); // scene -> alias -> ds
            try (Statement st = c.createStatement();
                 ResultSet rs = st.executeQuery(
                         "SELECT rc.scenario_code, rc.check_name, rc.consume_json, "
                                 + "rm.key_fields_json, cr.rules_json "
                                 + "FROM recon_check rc "
                                 + "LEFT JOIN recon_match_rule rm ON rm.scenario_code=rc.scenario_code AND rm.check_name=rc.check_name "
                                 + "LEFT JOIN recon_compare_rule cr ON cr.scenario_code=rc.scenario_code AND cr.check_name=rc.check_name "
                                 + "ORDER BY rc.scenario_code, rc.seq_no")) {
                while (rs.next()) {
                    String sc = rs.getString(1), cn = rs.getString(2);
                    Map<String, String> dsAlias = sceneDsAlias.computeIfAbsent(sc, k -> new LinkedHashMap<>());
                    Map<String, String> aliasDs = sceneAliasDs.computeIfAbsent(sc, k -> new LinkedHashMap<>());
                    String cj = rs.getString(3), kj = rs.getString(4), rj = rs.getString(5);
                    if (cj != null) {
                        Iterator<Map.Entry<String, JsonNode>> it = M.readTree(cj).fields();
                        while (it.hasNext()) {
                            Map.Entry<String, JsonNode> e = it.next();
                            JsonNode row = e.getValue();
                            if (!row.isObject() || !row.hasNonNull("ds_code")) continue;
                            String alias = e.getKey(), ds = row.get("ds_code").asText();
                            if (dsAlias.containsKey(ds) && !dsAlias.get(ds).equals(alias)) {
                                System.out.println("!! ds 冲突: " + sc + "/" + cn + " ds=" + ds + " alias=" + alias + " 已有=" + dsAlias.get(ds));
                                any = true;
                            }
                            if (aliasDs.containsKey(alias) && !aliasDs.get(alias).equals(ds)) {
                                System.out.println("!! alias 冲突: " + sc + "/" + cn + " alias=" + alias + " ds=" + ds + " 已有=" + aliasDs.get(alias));
                                any = true;
                            }
                            dsAlias.put(ds, alias);
                            aliasDs.put(alias, ds);
                            if (!alias.equals(ds)) {
                                System.out.println("!! consume key != ds_code: " + sc + "/" + cn + " key=" + alias + " ds=" + ds);
                                any = true;
                            }
                        }
                    }
                    if (kj != null && !"null".equals(kj) && M.readTree(kj).isObject()) {
                        Iterator<String> it = M.readTree(kj).fieldNames();
                        while (it.hasNext()) {
                            String a = it.next();
                            if (!aliasDs.containsKey(a)) {
                                System.out.println("!! key_fields 前缀未定义: " + sc + "/" + cn + " key=" + a);
                                any = true;
                            }
                        }
                    }
                    if (rj != null) {
                        for (JsonNode r : M.readTree(rj)) {
                            if (!r.isObject()) continue;
                            for (String f : new String[]{"left_field", "right_field"}) {
                                if (!r.has(f)) continue;
                                String v = r.get(f).asText();
                                int dot = v.indexOf('.');
                                String pre = dot > 0 ? v.substring(0, dot) : v;
                                if (!aliasDs.containsKey(pre)) {
                                    System.out.println("!! rule 前缀未定义: " + sc + "/" + cn + " " + f + "=" + v);
                                    any = true;
                                }
                            }
                        }
                    }
                }
            }
        }
        System.out.println(any ? "== 存在残留问题 ==" : "== 校验通过：无冲突、无残留旧别名 ==");
    }
}