package com.mis.adminbff.service.agentops;

import com.mis.adminbff.client.IamWebClient;
import com.mis.adminbff.client.model.AppVO;
import com.mis.adminbff.client.model.IamRoleVO;
import com.mis.adminbff.dto.agentops.AgentRoleOptionVO;
import com.mis.adminbff.dto.agentops.SkillGrantUpdateRequest;
import com.mis.adminbff.dto.agentops.SkillGrantVO;
import com.mis.adminbff.support.RequestContext;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * 技能授权（§4.3 #10 / #11 / #12）。
 *
 * <h2>⚠ 必须 read-modify-write，绝不能直接 PUT 单个 menuId</h2>
 * 这是本类存在的<b>全部理由</b>，也是最容易写错、且错了不会报错的一处。
 *
 * <p>下游 {@code PUT /internal/v1/roles/{id}/menus} 的语义是
 * <b>「全量覆盖」</b>——mis-iam 侧的实现是 <b>先 delete 该角色的所有
 * {@code sys_role_menu} 行，再 insert 传入的集合</b>。
 * 因此如果为了「给角色 A 加上技能 X 的执行码」而调用
 * {@code assignRoleMenus(A, [menuIdOfX])}，实际发生的事情是：
 * <b>角色 A 原有的全部菜单权限被清空，只剩下技能 X 的执行码。</b>
 *
 * <p>这个事故的可怕之处在于它的表现形式：
 * <ul>
 *   <li>接口返回 200，授权页显示"保存成功"；</li>
 *   <li>技能 X 确实授上了，操作者验证自己刚做的事 —— 通过；</li>
 *   <li>被波及的是该角色下<b>所有其它菜单</b>，而这些人是在几小时后
 *       陆续发现"我的菜单没了"才报障的，此时已经很难关联到那次授权操作。</li>
 * </ul>
 * 所以正确做法只有一条：<b>先 {@code listRoleMenus} 读全量 → 在内存里增删这一个 ID
 * → 再 {@code assignRoleMenus} 写回全量</b>。本类的每一次写都严格遵循它。
 *
 * <h2>只对「状态需要变化」的角色发起写请求</h2>
 * 保存时逐个角色比对当前态与目标态，一致的直接跳过。这不只是省一次 HTTP：
 * 每一次 {@code assignRoleMenus} 都是一次 delete-all + insert-all，
 * 无谓的重写会产生无谓的审计噪声，也白白扩大了「写坏」的时间窗口。
 *
 * <h2>角色取自 system App</h2>
 * 技能执行码挂在 {@code system} App（V21，app_id=1），因此可授予它的角色也应当是
 * system App 下的角色。用当前登录上下文的 appId（进运营台时是 agent App 92010）
 * 去列角色，会列出一批<b>与该码不在同一 App</b> 的角色 —— 授了也不会生效，
 * 而且不会报错。
 */
@Service
public class AgentOpsGrantService {

    private static final Logger log = LoggerFactory.getLogger(AgentOpsGrantService.class);

    /** 技能执行码所在 App 的编码，与 {@code types.ts:SkillGrant.target_app_code} 对齐。 */
    private static final String SYSTEM_APP_CODE = "system";

    /** {@link #SYSTEM_APP_CODE} 解析失败时的兜底 ID（V21 明确 system App 为 1）。 */
    private static final long SYSTEM_APP_ID_FALLBACK = 1L;

    private final IamWebClient iamWebClient;
    private final SkillPermissionCodeService skillPermissionCodeService;

    public AgentOpsGrantService(
            IamWebClient iamWebClient,
            SkillPermissionCodeService skillPermissionCodeService) {
        this.iamWebClient = iamWebClient;
        this.skillPermissionCodeService = skillPermissionCodeService;
    }

    /**
     * §4.3 #10 查询技能授权现状。
     *
     * @param skillId 技能 ID
     * @return 当前持有该技能执行码的角色集合
     */
    public SkillGrantVO getGrants(String skillId) {
        Long menuId = skillPermissionCodeService.ensureCode(skillId);
        Long tenantId = RequestContext.requireTenantId();
        long appId = resolveSystemAppId(tenantId);

        List<Long> granted = new ArrayList<>();
        for (IamRoleVO role : iamWebClient.listEnabledRoles(tenantId, appId)) {
            Long roleId = parseId(role.id());
            if (roleId == null) {
                continue;
            }
            if (iamWebClient.listRoleMenus(roleId).contains(menuId)) {
                granted.add(roleId);
            }
        }
        return new SkillGrantVO(skillId, SkillGrantVO.permissionCodeOf(skillId), SYSTEM_APP_CODE, granted);
    }

    /**
     * §4.3 #11 保存技能授权（全量覆盖语义）。
     *
     * @param skillId 技能 ID
     * @param request 保存后应持有该码的完整角色集合
     * @return 保存后的授权现状
     */
    public SkillGrantVO updateGrants(String skillId, SkillGrantUpdateRequest request) {
        Long menuId = skillPermissionCodeService.ensureCode(skillId);
        Long tenantId = RequestContext.requireTenantId();
        long appId = resolveSystemAppId(tenantId);

        Set<Long> target = new HashSet<>(request.normalizedRoleIds());
        List<Long> finalGranted = new ArrayList<>();

        for (IamRoleVO role : iamWebClient.listEnabledRoles(tenantId, appId)) {
            Long roleId = parseId(role.id());
            if (roleId == null) {
                continue;
            }
            boolean shouldHave = target.contains(roleId);

            // ---- READ：拿到该角色当前的全量菜单，一个都不能少 ----
            List<Long> current = iamWebClient.listRoleMenus(roleId);
            boolean hasNow = current.contains(menuId);

            if (shouldHave == hasNow) {
                // 状态已一致，不发起写请求：每次写都是 delete-all + insert-all，无谓重写只增加风险
                if (hasNow) {
                    finalGranted.add(roleId);
                }
                continue;
            }

            // ---- MODIFY：在全量副本上增删这一个 ID ----
            List<Long> next = new ArrayList<>(current);
            if (shouldHave) {
                next.add(menuId);
            } else {
                next.remove(menuId);
            }

            // ---- WRITE：写回全量。传 next 而非 [menuId]，否则该角色其余权限会被清空 ----
            iamWebClient.assignRoleMenus(roleId, next);
            log.info("技能授权变更: skillId={} menuId={} roleId={} {} (菜单数 {} → {})",
                    skillId, menuId, roleId, shouldHave ? "授予" : "回收", current.size(), next.size());

            if (shouldHave) {
                finalGranted.add(roleId);
            }
        }

        return new SkillGrantVO(skillId, SkillGrantVO.permissionCodeOf(skillId), SYSTEM_APP_CODE, finalGranted);
    }

    /**
     * §4.3 #12 授权选择器的角色列表。
     *
     * @return system App 下的启用角色
     */
    public List<AgentRoleOptionVO> listRoles() {
        Long tenantId = RequestContext.requireTenantId();
        long appId = resolveSystemAppId(tenantId);

        List<AgentRoleOptionVO> options = new ArrayList<>();
        for (IamRoleVO role : iamWebClient.listEnabledRoles(tenantId, appId)) {
            Long roleId = parseId(role.id());
            if (roleId == null) {
                continue;
            }
            options.add(new AgentRoleOptionVO(roleId, role.name(), role.code(), SYSTEM_APP_CODE));
        }
        return options;
    }

    /**
     * 解析 {@code system} App 的数字 ID。
     *
     * <p>优先按 code 查而不是直接写死 1：App ID 是数据，不是常量，
     * 在不同环境的初始化顺序下未必都是 1。查不到时才回落到 V21 明确记录的 1，
     * 并打 warn —— 回落本身是可接受的（V21 就是按 app_id=1 建的码），
     * 但它意味着 IAM 侧的 App 数据与预期不符，值得有人看一眼。
     */
    private long resolveSystemAppId(Long tenantId) {
        try {
            for (AppVO app : iamWebClient.listApps(tenantId, null)) {
                if (app != null && SYSTEM_APP_CODE.equals(app.code())) {
                    Long id = parseId(app.id());
                    if (id != null) {
                        return id;
                    }
                }
            }
        } catch (RuntimeException ex) {
            log.warn("查询 system App 失败，回落到 app_id={}: {}", SYSTEM_APP_ID_FALLBACK, ex.toString());
            return SYSTEM_APP_ID_FALLBACK;
        }
        log.warn("未在 IAM 中找到 code={} 的 App，回落到 app_id={}", SYSTEM_APP_CODE, SYSTEM_APP_ID_FALLBACK);
        return SYSTEM_APP_ID_FALLBACK;
    }

    private static Long parseId(String raw) {
        if (raw == null || raw.isBlank()) {
            return null;
        }
        try {
            return Long.valueOf(raw.trim());
        } catch (NumberFormatException ex) {
            return null;
        }
    }
}
