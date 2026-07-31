package com.mis.adminbff.service.skill;

import java.util.Map;

/**
 * 单据写回处理器（设计 §4.4 / T04）。
 *
 * <p>每种目标单据类型实现该接口，由 {@link DocWriteRegistry} 按 {@code docType} 路由。
 * 写动作应复用 BFF 既有微服务连通性与身份（SecurityContextHolder 中由反向信任注入的操作人）。
 */
public interface DocWriteHandler {

    /** 是否支持给定的 docType。 */
    boolean supports(String docType);

    /**
     * 将 values 写回 docId 对应单据。
     *
     * @param skillId  触发回填的 Skill（用于审计/追踪）
     * @param docType  单据类型（路由键）
     * @param docId    目标单据 ID
     * @param values   FormFill 返回的字段值
     * @return 统一写回结果
     */
    DocWriteResult apply(String skillId, String docType, String docId, Map<String, Object> values);
}
