package com.mis.taskflow.domain.repository;

import com.mis.taskflow.support.AppScope;
import jakarta.persistence.EntityManager;
import jakarta.persistence.Query;
import org.springframework.stereotype.Repository;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 门户「待办事项 · 全部」聚合查询仓储（native 动态 SQL）。
 *
 * <p>设计依据 docs/design/portal-matters-aggregation-design.md §3。核心取舍：
 * <ul>
 *   <li><b>两支 UNION ALL</b>：分支 A（kind=TASK，我处理的全部状态）∪ 分支 B（kind=INSTANCE，我发起的）；
 *       两支各自只负责「算出统一列」，<b>不含</b> keyword/发起人/参与人/scope。</li>
 *   <li><b>过滤/排序/分页统一在外层</b>（{@code SELECT ... FROM ( A UNION ALL B ) m WHERE ...}）：
 *       让四类过滤语义天然两支一致，去重与分页只做一次。</li>
 *   <li><b>过滤片段按需拼接</b>：参数缺省则该段<b>整段不拼</b>（连占位符都不出现），
 *       从根上规避本仓既有事故「单条 native SQL 可空参数 ⇒ Hibernate6/PG 类型推断缺陷」
 *       （{@code could not determine data type of parameter} / {@code lower(bytea) does not exist}）。</li>
 *   <li><b>{@code wf_task} 只出现在 {@code EXISTS} / 标量子查询里</b>：
 *       {@code wf_task.sys_task_id} 无唯一约束（同一 sys_task 可被多节点指向），
 *       直接 JOIN 到 {@code sys_task} 会多行膨胀、污染分页与 COUNT。取 instance_id 用
 *       {@code ORDER BY wt.id LIMIT 1} 的标量子查询去重。</li>
 * </ul>
 *
 * <p>返回 {@code Object[]}（列序见 {@link #UNION_SQL}），由
 * {@code PortalMattersService} 手工映射为 {@code PortalMatterVO}。
 */
@Repository
public class PortalMattersRepository {

    private final EntityManager em;

    public PortalMattersRepository(EntityManager em) {
        this.em = em;
    }

    /**
     * 过滤片段持有者（各字段 {@code null} = 不缺省则整段不拼，规避可空参数推断缺陷）。
     *
     * @param keywordPattern     关键字 LIKE 模式（已含 {@code %}，null=不拼）
     * @param initiatorPattern   发起人 LIKE 模式（null=不拼）
     * @param participantPattern 参与人 LIKE 模式（null=不拼）
     * @param appCode            {@code scope=APP} 时等值目标（null=不拼；由 Service 归一）
     * @param scope              已归一化的 scope：{@code ALL} / {@code APP} / {@code PLATFORM}
     */
    public record Filters(String keywordPattern,
                          String initiatorPattern,
                          String participantPattern,
                          String appCode,
                          String scope) {
    }

    /**
     * 两支 UNION ALL（列序即 {@code PortalMatterVO} 的映射顺序）。
     *
     * <p>固定命名参数：{@code :tenantId} / {@code :userId} 恒定；其余过滤参数仅在外层
     * WHERE 片段被拼接时才出现并绑定（见 {@link #buildWhere}）。
     */
    private static final String UNION_SQL = """
            SELECT 'TASK' AS kind,
                   st.id AS id,
                   (SELECT wt.instance_id FROM wf_task wt
                     WHERE wt.sys_task_id = st.id ORDER BY wt.id LIMIT 1) AS instance_id,
                   st.id AS sys_task_id,
                   COALESCE(
                     (SELECT wi_t.title FROM wf_instance wi_t
                       WHERE wi_t.id = (SELECT wt_t.instance_id FROM wf_task wt_t
                                         WHERE wt_t.sys_task_id = st.id ORDER BY wt_t.id LIMIT 1)),
                     st.biz_title
                   ) AS title,
                   st.biz_type || ' / ' || st.biz_ref_id AS subtitle,
                   st.biz_type AS biz_type,
                   st.app_code AS app_code,
                   (SELECT wi.initiator_name FROM wf_instance wi
                     WHERE wi.id = (SELECT wt2.instance_id FROM wf_task wt2
                                     WHERE wt2.sys_task_id = st.id ORDER BY wt2.id LIMIT 1)) AS initiator_name,
                   (SELECT wi.initiator_org_name FROM wf_instance wi
                     WHERE wi.id = (SELECT wt2.instance_id FROM wf_task wt2
                                     WHERE wt2.sys_task_id = st.id ORDER BY wt2.id LIMIT 1)) AS initiator_org_name,
                   st.assignee_name AS assignee_name,
                   st.status AS status,
                   st.created_at AS created_at,
                   st.status AS category
              FROM sys_task st
             WHERE st.tenant_id = :tenantId
               AND st.assignee_id = :userId
               AND st.deleted = 0
               AND st.task_type <> 'CC'
            UNION ALL
            SELECT 'INSTANCE' AS kind,
                   wi.id AS id,
                   wi.id AS instance_id,
                   -- 用 CAST(...) 而非 PG 的 ``::`` 转型：Hibernate6 的 native 查询解析器会把
                   -- ``NULL::bigint`` 误当成「空值 + 命名参数``:bigint``」⇒ 下发 ``NULL:bigint``
                   -- 触发 ``syntax error at or near ":"``（本仓首次，集成测试实测）。
                   CAST(NULL AS bigint) AS sys_task_id,
                   wi.title AS title,
                   wi.definition_code || ' \u00b7 ' || COALESCE(wi.started_form_code, '-') AS subtitle,
                   wi.business_type AS biz_type,
                   wi.app_code AS app_code,
                   wi.initiator_name AS initiator_name,
                   wi.initiator_org_name AS initiator_org_name,
                   NULL AS assignee_name,
                   wi.status AS status,
                   wi.created_at AS created_at,
                   'mySent' AS category
              FROM wf_instance wi
             WHERE wi.tenant_id = :tenantId
               AND wi.initiator_id = :userId
            """;

    /**
     * 列表查询：外层套 {@code (A UNION ALL B) m}，施加过滤 + 稳定排序 + 分页。
     *
     * @param page 页码（1 起，已由 Service 夹取 ≥1）
     * @param size 页大小（已由 Service 夹取 1..200）
     */
    @SuppressWarnings("unchecked")
    public List<Object[]> findMatters(Long tenantId, Long userId, Filters filters, int page, int size) {
        Map<String, Object> params = new LinkedHashMap<>();
        int offset = Math.max(page - 1, 0) * size;
        String sql = "SELECT m.* FROM (" + UNION_SQL + ") m"
                + buildWhere(filters, params)
                // 稳定序：kind/id 兜底，避免同一 created_at 时翻页错位。
                + " ORDER BY m.created_at DESC, m.kind ASC, m.id DESC"
                + " LIMIT " + size + " OFFSET " + offset;
        Query q = em.createNativeQuery(sql);
        q.setParameter("tenantId", tenantId);
        q.setParameter("userId", userId);
        params.forEach(q::setParameter);
        return q.getResultList();
    }

    /**
     * 独立 COUNT：与列表<b>共用同一份 WHERE 片段构造函数</b>，保证 total 与列表口径一致。
     */
    public long countMatters(Long tenantId, Long userId, Filters filters) {
        Map<String, Object> params = new LinkedHashMap<>();
        String sql = "SELECT COUNT(*) FROM (" + UNION_SQL + ") m" + buildWhere(filters, params);
        Query q = em.createNativeQuery(sql);
        q.setParameter("tenantId", tenantId);
        q.setParameter("userId", userId);
        params.forEach(q::setParameter);
        Object r = q.getSingleResult();
        return r == null ? 0L : ((Number) r).longValue();
    }

    /**
     * 构造外层 WHERE 片段，并把「被拼接段」对应的参数放入 {@code params}。
     *
     * <p>每段仅在对应模式/取值非空时拼接；缺省时该段（连同其命名参数）完全不出现。
     */
    private String buildWhere(Filters f, Map<String, Object> params) {
        StringBuilder sb = new StringBuilder(" WHERE 1 = 1");

        // keyword：标题 / 副标题 / 处理人 / 发起人 四选一（两支都把这些列投影为同名输出列）。
        if (f.keywordPattern() != null) {
            sb.append(" AND (m.title ILIKE :keyword OR m.subtitle ILIKE :keyword")
                    .append(" OR COALESCE(m.assignee_name, '') ILIKE :keyword")
                    .append(" OR COALESCE(m.initiator_name, '') ILIKE :keyword)");
            params.put("keyword", f.keywordPattern());
        }

        // 发起人：实例 initiator_name（TASK 无实例 ⇒ NULL ⇒ 不匹配，符合语义）。
        if (f.initiatorPattern() != null) {
            sb.append(" AND COALESCE(m.initiator_name, '') ILIKE :initiatorName");
            params.put("initiatorName", f.initiatorPattern());
        }

        // 参与人：有实例 → 该实例任一 wf_task 的处理人；无实例 → 退化为 m.assignee_name。
        // 🔴 口径（主理人裁定#2）：wf_task.assignee_name **或** 其关联 sys_task.assignee_name
        //    （ProcessService:assignNode 写 wfTask.setAssigneeName(null) ⇒ 该列恒空）。
        if (f.participantPattern() != null) {
            sb.append(" AND ( (m.instance_id IS NOT NULL AND EXISTS (")
                    .append("SELECT 1 FROM wf_task wt LEFT JOIN sys_task st2 ON st2.id = wt.sys_task_id")
                    .append(" WHERE wt.instance_id = m.instance_id")
                    .append(" AND ( COALESCE(wt.assignee_name, '') ILIKE :participantName")
                    .append(" OR COALESCE(st2.assignee_name, '') ILIKE :participantName ) ) )")
                    .append(" OR (m.instance_id IS NULL AND COALESCE(m.assignee_name, '') ILIKE :participantName) )");
            params.put("participantName", f.participantPattern());
        }

        // scope 三态：APP（且 appCode 非空）→ 等值；PLATFORM → IS NULL；ALL（默认）→ 不加条件。
        if (AppScope.SCOPE_APP.equals(f.scope()) && f.appCode() != null) {
            sb.append(" AND m.app_code = :appCode");
            params.put("appCode", f.appCode());
        } else if (AppScope.SCOPE_PLATFORM.equals(f.scope())) {
            sb.append(" AND m.app_code IS NULL");
        }

        return sb.toString();
    }
}
