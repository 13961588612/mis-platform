package com.mis.taskflow.service;

import com.mis.common.core.result.PageResult;
import com.mis.taskflow.domain.repository.PortalMattersRepository;
import com.mis.taskflow.dto.PortalMatterVO;
import com.mis.taskflow.support.AppScope;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Locale;

/**
 * 门户「待办事项 · 全部」聚合服务（设计 §2.2 / §3）。
 *
 * <p>职责：把 controller 传入的原始过滤参数归一化（keyword/发起人/参与人 → LIKE 模式，
 * scope → 归一枚举），调用 {@link PortalMattersRepository} 取「精确总数 + 当前页行」，
 * 再把 native {@code Object[]} 手工映射为 {@link PortalMatterVO}。
 *
 * <p><b>为什么映射手工做</b>：native 查询返回的是 {@code Object[]}（无实体绑定），
 * 各列类型由 JDBC 决定（id 可能是 {@code Long}/{@code BigInteger}，时间列是
 * {@code java.sql.Timestamp}），故用一个容错的 {@link #str(Object)} /
 * {@link #toLocalDateTime(Object)} 统一转换。
 */
@Service
public class PortalMattersService {

    private final PortalMattersRepository repository;

    public PortalMattersService(PortalMattersRepository repository) {
        this.repository = repository;
    }

    /**
     * 我的全部事项（三源 UNION 聚合，服务端分页）。
     *
     * @param tenantId        租户 id
     * @param userId          「我」= assignee（分支 A）兼 initiator（分支 B）
     * @param keyword         关键字（标题/副标题/处理人/发起人 四选一模糊）
     * @param initiatorName   发起人模糊
     * @param participantName 参与人模糊（匹配 {@code wf_task.assignee_name} 或关联 {@code sys_task.assignee_name}）
     * @param appCode         {@code scope=APP} 时的等值目标
     * @param scope           归属范围：{@code ALL}（默认）/ {@code APP} / {@code PLATFORM}
     * @param page            页码（1 起；越界夹取）
     * @param size            页大小（夹取 1..200）
     */
    @Transactional(readOnly = true)
    public PageResult<PortalMatterVO> matters(Long tenantId, Long userId, String keyword,
                                              String initiatorName, String participantName,
                                              String appCode, String scope, int page, int size) {
        int safePage = Math.max(page, 1);
        int safeSize = clampSize(size);

        PortalMattersRepository.Filters filters = new PortalMattersRepository.Filters(
                likePattern(keyword),
                likePattern(initiatorName),
                likePattern(participantName),
                AppScope.trimToNull(appCode),
                AppScope.normalizeScope(scope));

        long total = repository.countMatters(tenantId, userId, filters);
        List<PortalMatterVO> rows = total == 0
                ? List.of()
                : repository.findMatters(tenantId, userId, filters, safePage, safeSize).stream()
                        .map(this::toVo)
                        .toList();
        return PageResult.of(safePage, safeSize, total, rows);
    }

    /** 列序严格对齐 {@link PortalMattersRepository#UNION_SQL}。 */
    private PortalMatterVO toVo(Object[] r) {
        return new PortalMatterVO(
                str(r[0]),   // kind
                str(r[1]),   // id
                str(r[2]),   // instance_id
                str(r[3]),   // sys_task_id
                str(r[4]),   // title
                str(r[5]),   // subtitle
                str(r[6]),   // biz_type
                str(r[7]),   // app_code
                str(r[8]),   // initiator_name
                str(r[9]),   // assignee_name
                str(r[10]),  // status
                toLocalDateTime(r[11]), // created_at
                str(r[12])); // category
    }

    /** native 列值 → 字符串：{@code String} 原样；其它非空值 {@code String.valueOf}；{@code null} 透传。 */
    private static String str(Object v) {
        if (v == null) {
            return null;
        }
        return v instanceof String s ? s : String.valueOf(v);
    }

    /** native {@code timestamp} 列 → {@code LocalDateTime}：兼容 {@code java.sql.Timestamp} 与直出 {@code LocalDateTime}。 */
    private static LocalDateTime toLocalDateTime(Object v) {
        if (v instanceof LocalDateTime dt) {
            return dt;
        }
        if (v instanceof java.sql.Timestamp ts) {
            return ts.toLocalDateTime();
        }
        return null;
    }

    /** 页大小夹取（与 {@code ProcessService.myInitiated} 同口径）：{@code <=0} → 20，上限 200。 */
    private static int clampSize(int size) {
        if (size <= 0) {
            return 20;
        }
        return Math.min(size, 200);
    }

    /**
     * 把用户输入关键字转换为「{@code %} 包裹的模糊模式」；空白 → {@code null}（该过滤段整段不拼）。
     *
     * <p>SQL 用 {@code ILIKE}（大小写不敏感），故此处的大小写转换仅保证模式确定性；
     * 使用 {@link Locale#ROOT} 与运行环境区域设置无关。
     */
    static String likePattern(String keyword) {
        if (keyword == null || keyword.isBlank()) {
            return null;
        }
        return "%" + keyword.trim().toLowerCase(Locale.ROOT) + "%";
    }
}
