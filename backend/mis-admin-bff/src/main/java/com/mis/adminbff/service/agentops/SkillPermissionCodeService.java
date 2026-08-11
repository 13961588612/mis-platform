package com.mis.adminbff.service.agentops;

import com.mis.adminbff.client.SystemWebClient;
import com.mis.adminbff.client.model.MenuVO;
import com.mis.adminbff.dto.agentops.SkillGrantVO;
import com.mis.adminbff.support.AgentOpsErrorCodes;
import com.mis.common.core.exception.BusinessException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * 技能执行码（{@code ai:skill:{id}:run}）的<b>懒注册</b>。
 *
 * <h2>为什么是懒注册而不是启动时批量 upsert</h2>
 * 启动时按 {@code registry.yaml} 全量对齐看起来更"干净"，但它有两个现实问题：
 * <ol>
 *   <li><b>启动期依赖倒挂</b>。BFF 启动要先能读到 ai-platform 的技能清单、
 *       再写 mis-system 的菜单 —— 于是 BFF 的可启动性被两个下游绑架。
 *       其中任何一个在部署顺序里晚起来，BFF 就起不来，
 *       而它本身 90% 的功能与技能码毫无关系；</li>
 *   <li><b>批量写的失败是全有全无的</b>。一次 upsert 20 条，第 13 条撞上唯一约束，
 *       前 12 条已经写进去了 —— 重启再来一遍又是同样的位置失败。
 *       懒注册天然是单条的，一条失败只影响那一个技能的授权页。</li>
 * </ol>
 * 代价是首次访问某技能授权页时多一次菜单树查询，这个延迟只发生一次且发生在
 * 人工操作路径上（不是热路径）。
 *
 * <h2>两个调用点</h2>
 * <ul>
 *   <li><b>新建技能之后</b>（§4.3 #4）—— 让技能一建出来就可授权；</li>
 *   <li><b>进入授权页之前</b>（§4.3 #10/#11）—— 兜住"技能是通过其它途径（直接改
 *       registry.yaml、或 T04 之前手工建）产生"的情况。</li>
 * </ul>
 * 只做后者会让新建后的第一次授权多等一次；只做前者则完全兜不住历史技能。
 *
 * <h2>失败必须显式报错（fail-closed）</h2>
 * 补建失败时抛 {@link AgentOpsErrorCodes#SKILL_CODE_UNAVAILABLE}，绝不静默跳过。
 * 静默跳过的后果是授权页显示"保存成功"，但那个码根本不存在，
 * 所有勾选都落在空处 —— 运营以为授完了，用户执行技能时全部 403，
 * 而没有任何一条日志指向真正的原因。
 */
@Service
public class SkillPermissionCodeService {

    private static final Logger log = LoggerFactory.getLogger(SkillPermissionCodeService.class);

    /**
     * 技能执行码挂载的 App。
     *
     * <p>取 {@code system}（app_id=1）而非 agent App（92010），与 V21 一致：
     * 技能执行是跨端能力（业务页 / 企微 / Agent 对话都会触发），
     * 不是运营控制台的专属功能。
     */
    private static final long SYSTEM_APP_ID = 1L;

    /** 内置租户。 */
    private static final long SYSTEM_TENANT_ID = 1L;

    /** V21 建的目录节点「AI 技能执行权」，所有执行码按钮挂在它下面。 */
    private static final long EXEC_DIR_MENU_ID = 92200L;

    /** 按钮节点（不进侧栏，只承载 permission）。 */
    private static final int MENU_TYPE_BUTTON = 3;

    /** 可见（{@code permissionCodes()} 不看 visible，这里与 V21 的按钮行保持一致）。 */
    private static final int VISIBLE = 1;

    private final SystemWebClient systemWebClient;

    /**
     * {@code permission → menuId} 缓存。
     *
     * <p>只缓存<b>成功解析到的</b>映射，不缓存"不存在"这个结论 ——
     * 否则一次查询失败就会把某个技能永久钉死在"没有码"的状态，直到重启。
     */
    private final Map<String, Long> codeToMenuId = new ConcurrentHashMap<>();

    public SkillPermissionCodeService(SystemWebClient systemWebClient) {
        this.systemWebClient = systemWebClient;
    }

    /**
     * 确保技能 {@code skillId} 的执行码存在，返回其 {@code sys_menu.id}。
     *
     * @param skillId 技能 ID，原样使用（<b>含点号</b>，如 {@code member.profile}）
     * @return 该执行码对应的菜单 ID，供 {@code sys_role_menu} 授权使用
     * @throws BusinessException 参数非法，或补建失败
     */
    public Long ensureCode(String skillId) {
        if (skillId == null || skillId.isBlank()) {
            throw new BusinessException(AgentOpsErrorCodes.SKILL_CODE_UNAVAILABLE, "技能 ID 不能为空");
        }
        String permission = SkillGrantVO.permissionCodeOf(skillId.trim());

        Long cached = codeToMenuId.get(permission);
        if (cached != null) {
            return cached;
        }

        Long existing = findMenuIdByPermission(permission);
        if (existing != null) {
            codeToMenuId.put(permission, existing);
            return existing;
        }

        return createCode(skillId.trim(), permission);
    }

    /**
     * 查找技能执行码对应的 {@code sys_menu.id}，<b>不创建</b>。
     *
     * <p>与 {@link #ensureCode} 的区别只在「查不到时」：本方法返回 {@code null}，
     * 绝不补建。供清理已下线 MCP 工具使用 —— 清理时若该码从未被建过菜单，
     * 应当如实报告「没有菜单可删」，而不是顺手把它建出来再删掉。
     *
     * @param skillId 技能 ID
     * @return 命中菜单 ID；未注册返回 {@code null}
     */
    public Long findMenuId(String skillId) {
        if (skillId == null || skillId.isBlank()) {
            return null;
        }
        String permission = SkillGrantVO.permissionCodeOf(skillId.trim());
        Long cached = codeToMenuId.get(permission);
        if (cached != null) {
            return cached;
        }
        Long existing = findMenuIdByPermission(permission);
        if (existing != null) {
            codeToMenuId.put(permission, existing);
        }
        return existing;
    }

    /**
     * 使技能执行码的 {@code permission → menuId} 缓存失效。
     *
     * <p>清理已下线 MCP 工具时，若执行码对应的 {@code sys_menu} 被删除，
     * 必须把缓存里的映射一并清掉 —— 否则该工具将来重新 discover 时
     * {@link #ensureCode} 会命中这条指向已删菜单的陈旧映射，授权写进
     * {@code sys_role_menu} 后查无此行、静默失效且不报错。
     *
     * @param skillId 技能 ID
     */
    public void evictCode(String skillId) {
        if (skillId == null || skillId.isBlank()) {
            return;
        }
        String permission = SkillGrantVO.permissionCodeOf(skillId.trim());
        codeToMenuId.remove(permission);
    }

    /**
     * 批量确保，返回 {@code skillId → menuId}。
     *
     * <p>逐个调用 {@link #ensureCode}，但<b>只拉一次菜单树</b>由缓存承担 ——
     * 首个技能触发查询后，后续技能命中缓存。
     *
     * @param skillIds 技能 ID 列表
     * @return 映射表，顺序与入参一致
     */
    public Map<String, Long> ensureCodes(List<String> skillIds) {
        Map<String, Long> result = new java.util.LinkedHashMap<>();
        if (skillIds == null) {
            return result;
        }
        for (String skillId : skillIds) {
            if (skillId != null && !skillId.isBlank()) {
                result.put(skillId, ensureCode(skillId));
            }
        }
        return result;
    }

    /**
     * 建码。
     *
     * <p><b>并发与多实例下的重复建码</b>：两个实例同时发现码不存在、同时提交创建，
     * 第二个会被 {@code uk_menu_app_permission}（{@code (app_id, permission)} 部分唯一索引）
     * 挡下。此时<b>不能</b>把异常直接抛给用户 —— 码实际上已经由对方建好了，
     * 用户看到的报错完全是内部竞争的产物。所以失败后重新扫一次树：
     * 扫到了就当成功（这正是我们想要的最终状态），扫不到才是真失败。
     */
    private Long createCode(String skillId, String permission) {
        Map<String, Object> body = SystemWebClient.menuCreateBody(
                SYSTEM_TENANT_ID,
                SYSTEM_APP_ID,
                EXEC_DIR_MENU_ID,
                "执行技能：" + skillId,
                MENU_TYPE_BUTTON,
                null,
                null,
                permission,
                null,
                nextSort(),
                VISIBLE);
        // menuCreateBody 不含 code 字段，这里补上：V21 的 slug 风格为 ai_skill_run_{下划线化的 id}
        body.put("code", menuCodeOf(skillId));

        try {
            MenuVO created = systemWebClient.createMenu(body);
            Long menuId = parseId(created == null ? null : created.id());
            if (menuId == null) {
                throw new BusinessException(AgentOpsErrorCodes.SKILL_CODE_UNAVAILABLE,
                        "补建技能执行码失败：下游未返回菜单 ID（" + permission + "）");
            }
            log.info("懒注册技能执行码成功: permission={} menuId={}", permission, menuId);
            codeToMenuId.put(permission, menuId);
            return menuId;
        } catch (BusinessException ex) {
            // 可能是并发下别的实例抢先建成功并撞了唯一约束，回扫一次确认最终状态
            Long raced = findMenuIdByPermission(permission);
            if (raced != null) {
                log.info("技能执行码已由并发请求建立: permission={} menuId={}", permission, raced);
                codeToMenuId.put(permission, raced);
                return raced;
            }
            log.error("补建技能执行码失败: permission={}", permission, ex);
            throw new BusinessException(AgentOpsErrorCodes.SKILL_CODE_UNAVAILABLE,
                    "补建技能执行码失败（" + permission + "）：" + ex.getMessage());
        }
    }

    /**
     * 在 system App 的菜单树里按 {@code permission} 精确查找。
     *
     * @return 命中的菜单 ID；未命中返回 {@code null}
     */
    private Long findMenuIdByPermission(String permission) {
        List<MenuVO> tree = systemWebClient.tree(SYSTEM_APP_ID);
        return searchTree(tree, permission);
    }

    private Long searchTree(List<MenuVO> nodes, String permission) {
        if (nodes == null) {
            return null;
        }
        for (MenuVO node : nodes) {
            if (node == null) {
                continue;
            }
            if (permission.equals(node.permission())) {
                Long id = parseId(node.id());
                if (id != null) {
                    return id;
                }
            }
            Long hit = searchTree(node.children(), permission);
            if (hit != null) {
                return hit;
            }
        }
        return null;
    }

    /**
     * 生成菜单 {@code code}（slug）。
     *
     * <p>与 V21 保持同一风格：{@code ai_skill_run_} + 技能 ID 的下划线化。
     * <b>注意这与 permission 不同</b> —— permission 里的点号必须原样保留
     * （{@code ai:skill:member.profile:run}），因为 {@code SkillPermissionChecker}
     * 是拿请求体里的 skill_id 原样拼串比对；而 menu.code 只要求在 App 内唯一，
     * 用下划线与 app_id=1 下既有的命名风格一致。两者规则不同是刻意的，不是笔误。
     */
    private static String menuCodeOf(String skillId) {
        String slug = skillId.toLowerCase(Locale.ROOT).replaceAll("[^a-z0-9]+", "_");
        return "ai_skill_run_" + slug;
    }

    /**
     * 新码的排序值。
     *
     * <p>取一个足够大的固定值而不是「查最大值 + 1」：sort 只影响权限树里的展示顺序，
     * 为它多打一次查询、还要处理并发下的重号，收益与成本完全不成比例。
     * V21 已用 1/2/3，新建的排在它们之后即可。
     */
    private static int nextSort() {
        return 100;
    }

    private static Long parseId(String raw) {
        if (raw == null || raw.isBlank()) {
            return null;
        }
        try {
            return Long.valueOf(raw.trim());
        } catch (NumberFormatException ex) {
            log.warn("菜单 ID 非数字，已忽略: {}", raw);
            return null;
        }
    }
}
