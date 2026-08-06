package com.mis.adminbff.controller;

import com.mis.adminbff.dto.agentops.AgentRoleOptionVO;
import com.mis.adminbff.dto.agentops.SkillGrantUpdateRequest;
import com.mis.adminbff.dto.agentops.SkillGrantVO;
import com.mis.adminbff.service.agentops.AgentOpsGrantService;
import com.mis.common.core.result.Result;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/**
 * 技能授权域 BFF 端点（§4.3 #10 / #11 / #12）。
 *
 * <h2>为什么单独成类</h2>
 * 这三条是<b>唯一不以 ai-platform 为真相源</b>的端点：授权真值来自 mis-iam 的
 * {@code sys_role_menu}，由 {@link AgentOpsGrantService} 在这里完成
 * 「roleId → menuIds」到「skillId → roleIds」的翻转，并严格 read-modify-write
 * （见该服务类注释）。它们逻辑独立、权限码族独立（{@code agent:skill:grant} /
 * {@code agent:skill:list}），与透明透传的 {@link AgentOpsController} 混在一起只会互相干扰。
 *
 * <h2>路径与 V20 逐字对齐</h2>
 * {@code GET/PUT /skills/{id}/grants}、{@code GET /roles}，与方法、{@code sys_api}
 * 注册表（92109–92111、92111）完全一致。路径写错会让这条端点落到 deny-unmapped=false 的
 * 放行分支，等于「有权限码却不判」—— 故路径照搬 SQL。
 *
 * <h2>返回强类型而非 JsonNode</h2>
 * 这是 BFF <b>自建</b>的结构（不是下游透传），用 {@link SkillGrantVO} /
 * {@link AgentRoleOptionVO} 明确契约，前端不必再做字符串↔数字的隐形转换
 * （{@code AgentRoleOptionVO.id} 特意转成 {@code number}，见其类注释）。
 */
@RestController
@RequestMapping("/api/v1/agent-ops")
public class AgentOpsGrantController {

    private final AgentOpsGrantService grantService;

    public AgentOpsGrantController(AgentOpsGrantService grantService) {
        this.grantService = grantService;
    }

    /** #10 查询技能授权现状。 */
    @GetMapping("/skills/{id}/grants")
    public Result<SkillGrantVO> getGrants(@PathVariable("id") String skillId) {
        return Result.ok(grantService.getGrants(skillId));
    }

    /** #11 保存技能授权（全量覆盖语义，read-modify-write 落库）。 */
    @PutMapping("/skills/{id}/grants")
    public Result<SkillGrantVO> updateGrants(
            @PathVariable("id") String skillId,
            @Valid @RequestBody SkillGrantUpdateRequest request) {
        return Result.ok(grantService.updateGrants(skillId, request));
    }

    /** #12 授权选择器角色列表（system App 下的启用角色）。 */
    @GetMapping("/roles")
    public Result<List<AgentRoleOptionVO>> listRoles() {
        return Result.ok(grantService.listRoles());
    }
}
