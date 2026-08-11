package com.mis.adminbff.dto.kb;

/**
 * 审计「修改前快照」包装（企业级增强一期 KE-01，Q2 裁决「审计快照入参」范式）。
 *
 * <p>门面层写操作前先调用既有<b>读</b>端点取得旧值，包装成本对象作为<b>方法入参</b>
 * 传给带 {@code @OperLog(recordParams=true)} 的门面方法；切面序列化入参时把
 * {@code before} 一并摊平进 {@code request_params}，形成
 * {@code {..., "before": {...旧值...}}}（新值即请求体/新参数，天然在顶层）。
 * 范式对齐既有 {@code KbSynonymFacadeService.deleteGroup(Long, KbSynonymGroupSnapshot)}
 * 先例（设计 §1.1）。
 *
 * <p><b>为什么 before 是 {@code Object} 而不是具体业务 DTO：</b>
 * {@code OperLogAspect} 用裸 {@code new ObjectMapper()}（无 JavaTimeModule），
 * 遇到 {@code Instant} 会抛 {@code InvalidDefinitionException} 导致<b>整条 requestParams
 * 变空</b>（切面 collectParams 对异常整体吞掉）。而 {@code KbCategoryVO} /
 * {@code KbLibraryVO} / {@code KbDocumentVO} / {@code KbAclVO} / {@code KbCategoryAdminVO}
 * 均含 {@code Instant} 字段。因此调用方必须把旧值加工成<b>仅含 Jackson 免注册类型</b>
 * 的窄快照（{@code String}/{@code Long}/{@code Integer}/{@code Boolean}/{@code Double}/
 * {@code null} 及它们的 List/Map），再塞进 {@code before}——KbFacadeService 的
 * {@code loadXxxBefore} 系列方法统一承担该加工。RAG 设置快照例外：{@code KbRagSettings}
 * 本身不含 {@code java.time}，可直接作 before。
 *
 * @param targetId    操作目标 id（主链路参数冗余副本，读旧值失败时仍留痕）
 * @param targetTitle 操作目标可读标题（如分类名/库名）；采集失败可为 {@code null}
 * @param before      修改前旧值窄快照；采集失败为 {@code null}（仍记入参，设计 R2）
 */
public record KbAuditBefore(Long targetId, String targetTitle, Object before) {

    /**
     * 构造完整快照。
     *
     * @param targetId    操作目标 id
     * @param targetTitle 操作目标可读标题，可为 {@code null}
     * @param before      修改前旧值窄快照，可为 {@code null}
     * @return 快照包装
     */
    public static KbAuditBefore of(Long targetId, String targetTitle, Object before) {
        return new KbAuditBefore(targetId, targetTitle, before);
    }

    /**
     * 最小快照：读旧值失败 / 目标不存在时使用，保证审计主干不丢目标 id。
     *
     * @param targetId 操作目标 id
     * @return 仅含 id 的包装
     */
    public static KbAuditBefore minimal(Long targetId) {
        return new KbAuditBefore(targetId, null, null);
    }
}
