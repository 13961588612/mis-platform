import java.sql.*;

/** 一次性 DB 查询工具：java -cp pg.jar Q.java "SQL" */
public class Q {
    public static void main(String[] args) throws Exception {
        String url = "jdbc:postgresql://10.254.16.6:5432/mis_platform";
        try (Connection c = DriverManager.getConnection(url, "mis", "mis123")) {
            for (String sql : args) {
                System.out.println("### " + sql);
                try (Statement st = c.createStatement()) {
                    boolean hasRs = st.execute(sql);
                    if (!hasRs) {
                        System.out.println("(no result, update count=" + st.getUpdateCount() + ")");
                        continue;
                    }
                    try (ResultSet rs = st.getResultSet()) {
                        ResultSetMetaData md = rs.getMetaData();
                        int n = md.getColumnCount();
                        StringBuilder head = new StringBuilder();
                        for (int i = 1; i <= n; i++) {
                            if (i > 1) head.append(" | ");
                            head.append(md.getColumnLabel(i));
                        }
                        System.out.println(head);
                        StringBuilder sep = new StringBuilder();
                        for (int i = 1; i <= n; i++) {
                            if (i > 1) sep.append("-+-");
                            sep.append("----------");
                        }
                        System.out.println(sep);
                        int rows = 0;
                        while (rs.next()) {
                            rows++;
                            StringBuilder line = new StringBuilder();
                            for (int i = 1; i <= n; i++) {
                                if (i > 1) line.append(" | ");
                                Object v = rs.getObject(i);
                                String s = v == null ? "NULL" : String.valueOf(v);
                                if (s.length() > 400) s = s.substring(0, 400) + "...[trunc]";
                                line.append(s.replace("\n", "\\n"));
                            }
                            System.out.println(line);
                        }
                        System.out.println("(" + rows + " rows)");
                    }
                } catch (SQLException e) {
                    System.out.println("!! ERROR: " + e.getMessage());
                }
            }
        }
    }
}