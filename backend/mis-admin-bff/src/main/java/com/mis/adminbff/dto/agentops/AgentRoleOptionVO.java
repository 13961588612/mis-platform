package com.mis.adminbff.dto.agentops;

/**
 * 授权选择器里的角色项（§4.3 #12，对应前端 {@code types.ts:AgentRoleOption}）。
 *
 * <h2>为什么这一个 DTO 是 camelCase</h2>
 * 本目录其余 VO 全是 snake_case，因为它们的产出方是 ai-platform（Python）。
 * 唯独角色来自 <b>mis-iam（Java）</b>的 {@code sys_role}，前端 {@code types.ts} 里
 * {@code AgentRoleOption} 也明确写了 camelCase 并注明「例外」。
 * 这里跟随实际 wire format，而不是为了「本目录内部统一」去改一个已经定稿的契约 ——
 * 后者会让前端多写一个只服务于单个类型的映射函数。
 *
 * <h2>为什么不直接透传 {@code IamRoleVO}</h2>
 * 两点实质差异，都不是风格问题：
 * <ol>
 *   <li>{@code IamRoleVO.id} 是 <b>{@code String}</b>，而前端
 *       {@code AgentRoleOption.id} 与 {@code SkillGrant.role_ids} 都是 <b>number</b>。
 *       直接透传会让前端在「回显已选角色」时做 {@code string} 与 {@code number} 的
 *       比较 —— JS 里 {@code "3" === 3} 为 false，表现是「保存成功但复选框没勾上」；</li>
 *   <li>{@code IamRoleVO} 还带 {@code dataScope} / {@code remark} / {@code tenantId} 等
 *       与授权选择无关的字段。授权页不需要它们，多传只是把 IAM 的内部结构
 *       暴露给一个不相干的前端页面。</li>
 * </ol>
 *
 * @param id      角色 ID
 * @param name    角色名
 * @param code    角色编码
 * @param appCode 所属 App 编码，当前恒为 {@code system}（技能执行码挂在 system App 下）
 */
public record AgentRoleOptionVO(
        Long id,
        String name,
        String code,
        String appCode) {
}
