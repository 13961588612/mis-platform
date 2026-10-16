import java.sql.*;

public class QueryMisDb {
    public static void main(String[] args) throws Exception {
        String url = "jdbc:postgresql://10.254.16.6:5432/mis_platform?ApplicationName=QueryMisDb";
        try (Connection c = DriverManager.getConnection(url, "mis", "mis123")) {
            System.out.println("=== 1) flyway_schema_history >= V40 ===");
            try (Statement st = c.createStatement();
                 ResultSet rs = st.executeQuery(
                     "SELECT installed_rank, version, description, success, installed_on::date " +
                     "FROM flyway_schema_history WHERE version::int >= 40 ORDER BY installed_rank")) {
                while (rs.next()) {
                    System.out.printf("%-4d v%-6s %-50s success=%s %s%n",
                        rs.getInt(1), rs.getString(2), rs.getString(3), rs.getBoolean(4), rs.getDate(5));
                }
            }
            System.out.println();
            System.out.println("=== 2) 93 段占用 (module/menu/api/menu_api) ===");
            try (Statement st = c.createStatement();
                 ResultSet rs = st.executeQuery(
                     "SELECT 'sys_module' AS tbl, id::text AS id FROM sys_module WHERE id BETWEEN 93000 AND 93999 " +
                     "UNION ALL SELECT 'sys_menu', id::text FROM sys_menu WHERE id BETWEEN 93000 AND 93999 " +
                     "UNION ALL SELECT 'sys_api', id::text FROM sys_api WHERE id BETWEEN 93000 AND 93999 " +
                     "UNION ALL SELECT 'sys_menu_api', id::text FROM sys_menu_api WHERE id BETWEEN 93000 AND 93999 " +
                     "ORDER BY tbl, id")) {
                while (rs.next()) {
                    System.out.println(rs.getString(1) + "\t" + rs.getString(2));
                }
            }
            System.out.println();
            System.out.println("=== 3) sys_menu: app_id=4(recon) 或 93010(iqd) ===");
            try (Statement st = c.createStatement();
                 ResultSet rs = st.executeQuery(
                     "SELECT id, app_id, parent_id, code, name, type, permission, sort, visible, status " +
                     "FROM sys_menu WHERE app_id IN (4, 93010) ORDER BY id")) {
                while (rs.next()) {
                    System.out.printf("%-7s app=%-6s parent=%-6s code=%-15s name=%-8s type=%s perm=%-12s sort=%s vis=%s st=%s%n",
                        rs.getLong(1), rs.getLong(2), rs.getLong(3), rs.getString(4), rs.getString(5),
                        rs.getInt(6), rs.getString(7), rs.getInt(8), rs.getInt(9), rs.getInt(10));
                }
            }
            System.out.println();
            System.out.println("=== 4) sys_app id=4 / recon ===");
            try (Statement st = c.createStatement();
                 ResultSet rs = st.executeQuery(
                     "SELECT id, code, name, runtime, status FROM sys_app WHERE id = 4 OR code = 'recon'")) {
                while (rs.next()) {
                    System.out.printf("id=%s code=%s name=%s runtime=%s status=%s%n",
                        rs.getLong(1), rs.getString(2), rs.getString(3), rs.getString(4), rs.getInt(5));
                }
            }
            System.out.println();
            System.out.println("=== 7) sys_menu_api 93091-93094 绑定详情 ===");
            try (Statement st = c.createStatement();
                 ResultSet rs = st.executeQuery(
                     "SELECT ma.id, ma.menu_id, m.code AS menu_code, m.app_id, m.permission, ma.api_id " +
                     "FROM sys_menu_api ma JOIN sys_menu m ON m.id = ma.menu_id " +
                     "WHERE ma.api_id BETWEEN 93090 AND 93094 ORDER BY ma.id")) {
                while (rs.next()) {
                    System.out.printf("menu_api=%s menu_id=%s menu_code=%s menu_app=%s menu_perm=%s api_id=%s%n",
                        rs.getLong(1), rs.getLong(2), rs.getString(3), rs.getLong(4), rs.getString(5), rs.getLong(6));
                }
            }
            System.out.println();
            System.out.println("=== 8) sys_menu 93030/93040 完整行 ===");
            try (Statement st = c.createStatement();
                 ResultSet rs = st.executeQuery(
                     "SELECT id, tenant_id, app_id, parent_id, code, name, type, permission, sort, visible, status " +
                     "FROM sys_menu WHERE id IN (93030, 93040) ORDER BY id")) {
                while (rs.next()) {
                    System.out.printf("id=%s tenant=%s app=%s parent=%s code=%s name=%s type=%s perm=%s sort=%s vis=%s st=%s%n",
                        rs.getLong(1), rs.getLong(2), rs.getLong(3), rs.getLong(4), rs.getString(5),
                        rs.getString(6), rs.getInt(7), rs.getString(8), rs.getInt(9), rs.getInt(10), rs.getInt(11));
                }
            }
            System.out.println();
            System.out.println("=== 9) recon 自己的菜单(app_id=4) ===");
            try (Statement st = c.createStatement();
                 ResultSet rs = st.executeQuery(
                     "SELECT id, app_id, parent_id, code, name, type, permission, visible, status " +
                     "FROM sys_menu WHERE app_id = 4 ORDER BY id")) {
                while (rs.next()) {
                    System.out.printf("id=%s app=%s parent=%s code=%s name=%s type=%s perm=%s vis=%s st=%s%n",
                        rs.getLong(1), rs.getLong(2), rs.getLong(3), rs.getString(4), rs.getString(5),
                        rs.getInt(6), rs.getString(7), rs.getInt(8), rs.getInt(9));
                }
            }
        }
    }
}
