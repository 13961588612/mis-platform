import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.sql.*;

/** 直接执行迁移 SQL 文件（绕过 Flyway 的 checksum 机制），用于验证 V129 的幂等性。 */
public class RunSql {
    public static void main(String[] args) throws Exception {
        String url = "jdbc:postgresql://10.254.16.6:5432/mis_platform";
        String sql = new String(Files.readAllBytes(Paths.get(args[0])), StandardCharsets.UTF_8);
        try (Connection c = DriverManager.getConnection(url, "mis", "mis123")) {
            c.setAutoCommit(false);
            try (Statement st = c.createStatement()) {
                st.execute(sql);
            }
            c.commit();
            System.out.println("OK: 执行成功 " + args[0]);
        } catch (SQLException e) {
            System.out.println("FAIL: " + e.getMessage());
            System.exit(1);
        }
    }
}