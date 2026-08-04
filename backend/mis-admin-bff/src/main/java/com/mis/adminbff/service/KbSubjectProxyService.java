package com.mis.adminbff.service;

import com.mis.adminbff.client.IamWebClient;
import com.mis.adminbff.client.OrgWebClient;
import com.mis.adminbff.client.model.DeptVO;
import com.mis.adminbff.client.model.IamRoleVO;
import com.mis.adminbff.client.model.IamUserVO;
import com.mis.adminbff.dto.kb.KbSubjectVO;
import com.mis.adminbff.support.RequestContext;
import com.mis.common.core.result.PageResult;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * 授权主体检索与名称回填（I-03）。
 *
 * <p><b>为什么放在 BFF 而不是 mis-kb：</b>mis-kb 是知识库领域服务，让它为了显示一个人名
 * 去依赖 IAM/Org 两个服务，会把领域层拖成分布式聚合层，而且必然引入 N+1 远程调用。
 * BFF 本来就是跨域聚合层，主体检索与名称回填天然属于这里。
 *
 * <p><b>降级口径：</b>IAM/Org 不可达时，检索接口返回空列表、回填接口保留 {@code null} 名称，
 * 一律不抛异常。原因很实际——授权列表打不开比「名字显示成 ID」严重得多。
 */
@Service
public class KbSubjectProxyService {

    private static final Logger log = LoggerFactory.getLogger(KbSubjectProxyService.class);

    /** 主体类型：用户。 */
    public static final String TYPE_USER = "user";
    /** 主体类型：角色。 */
    public static final String TYPE_ROLE = "role";
    /** 主体类型：部门。 */
    public static final String TYPE_DEPT = "dept";

    /** 用户检索默认返回条数（选择器是搜索式交互，不需要全量）。 */
    private static final int USER_SEARCH_SIZE = 50;

    private final IamWebClient iamWebClient;
    private final OrgWebClient orgWebClient;

    public KbSubjectProxyService(IamWebClient iamWebClient, OrgWebClient orgWebClient) {
        this.iamWebClient = iamWebClient;
        this.orgWebClient = orgWebClient;
    }

    // ---------------------------------------------------------------- 检索

    /**
     * 统一主体检索入口。
     *
     * @param type    主体类型 user/role/dept；空值按 user 处理
     * @param keyword 关键字；dept 忽略该参数（返回整棵树由前端本地过滤）
     * @return 主体列表；dept 为树形
     */
    public List<KbSubjectVO> search(String type, String keyword) {
        String t = type == null || type.isBlank() ? TYPE_USER : type.trim().toLowerCase();
        return switch (t) {
            case TYPE_ROLE -> searchRoles(keyword);
            case TYPE_DEPT -> deptTree();
            default -> searchUsers(keyword);
        };
    }

    /**
     * 用户检索。
     *
     * @param keyword 用户名关键字；可空
     * @return 用户主体列表
     */
    public List<KbSubjectVO> searchUsers(String keyword) {
        try {
            PageResult<IamUserVO> page = iamWebClient.pageUsers(
                    RequestContext.requireTenantId(),
                    RequestContext.requireAppId(),
                    null,
                    keyword,
                    null,
                    1,
                    USER_SEARCH_SIZE);
            if (page == null || page.getList() == null) {
                return List.of();
            }
            List<KbSubjectVO> result = new ArrayList<>(page.getList().size());
            for (IamUserVO u : page.getList()) {
                Long id = parseId(u.id());
                if (id == null) {
                    continue;
                }
                String display = u.realName() != null && !u.realName().isBlank()
                        ? u.realName() : u.username();
                result.add(KbSubjectVO.leaf(TYPE_USER, id, display, u.username()));
            }
            return result;
        } catch (Exception e) {
            log.warn("检索用户主体失败 keyword={}: {}", keyword, e.getMessage());
            return List.of();
        }
    }

    /**
     * 角色检索。
     *
     * <p>只取启用角色——给一个已停用的角色授权，等于埋一颗「哪天角色被启用就突然放权」的雷。
     *
     * @param keyword 名称/编码关键字；可空。IAM 侧无关键字参数，这里在内存过滤（角色数量级很小）
     * @return 角色主体列表
     */
    public List<KbSubjectVO> searchRoles(String keyword) {
        try {
            List<IamRoleVO> roles = iamWebClient.listEnabledRoles(
                    RequestContext.requireTenantId(), RequestContext.requireAppId());
            if (roles == null) {
                return List.of();
            }
            String kw = keyword == null || keyword.isBlank() ? null : keyword.trim().toLowerCase();
            List<KbSubjectVO> result = new ArrayList<>();
            for (IamRoleVO r : roles) {
                Long id = parseId(r.id());
                if (id == null) {
                    continue;
                }
                if (kw != null && !matches(kw, r.name(), r.code())) {
                    continue;
                }
                result.add(KbSubjectVO.leaf(TYPE_ROLE, id, r.name(), r.code()));
            }
            return result;
        } catch (Exception e) {
            log.warn("检索角色主体失败 keyword={}: {}", keyword, e.getMessage());
            return List.of();
        }
    }

    /**
     * 部门树。
     *
     * <p>返回整棵树而不是分页列表：部门选择本质是层级选择，分页会把父子关系切碎。
     *
     * @return 部门主体树；Org 不可达时返回空列表
     */
    public List<KbSubjectVO> deptTree() {
        try {
            List<DeptVO> tree = orgWebClient.deptTree(null);
            if (tree == null) {
                return List.of();
            }
            List<KbSubjectVO> result = new ArrayList<>(tree.size());
            for (DeptVO d : tree) {
                KbSubjectVO node = toDeptNode(d);
                if (node != null) {
                    result.add(node);
                }
            }
            return result;
        } catch (Exception e) {
            log.warn("获取部门树失败: {}", e.getMessage());
            return List.of();
        }
    }

    // ---------------------------------------------------------------- 名称回填

    /**
     * 批量解析主体名称。
     *
     * <p>按类型分组后批量查，避免逐条远程调用。任一类型解析失败只影响该类型，
     * 其余仍正常回填。
     *
     * @param subjects 待解析的 (type, id) 对
     * @return key 为 {@code type + ":" + id} 的名称映射；解析不到的 key 不出现在结果中
     */
    public Map<String, String> resolveNames(Collection<SubjectKey> subjects) {
        if (subjects == null || subjects.isEmpty()) {
            return Map.of();
        }
        Set<Long> userIds = new HashSet<>();
        Set<Long> roleIds = new HashSet<>();
        Set<Long> deptIds = new HashSet<>();
        for (SubjectKey key : subjects) {
            if (key == null || key.id() == null || key.type() == null) {
                continue;
            }
            switch (key.type().trim().toLowerCase()) {
                case TYPE_ROLE -> roleIds.add(key.id());
                case TYPE_DEPT -> deptIds.add(key.id());
                case TYPE_USER -> userIds.add(key.id());
                default -> log.debug("未知主体类型，跳过名称解析 type={}", key.type());
            }
        }

        Map<String, String> names = new HashMap<>();
        resolveUserNames(userIds, names);
        resolveRoleNames(roleIds, names);
        resolveDeptNames(deptIds, names);
        return names;
    }

    /**
     * 单类型批量解析用户名。
     *
     * @param userIds 用户 id 集合
     * @return id → 名称
     */
    public Map<Long, String> userNames(Collection<Long> userIds) {
        if (userIds == null || userIds.isEmpty()) {
            return Map.of();
        }
        Map<String, String> keyed = new HashMap<>();
        resolveUserNames(new HashSet<>(userIds), keyed);
        Map<Long, String> result = new HashMap<>();
        for (Long id : userIds) {
            String name = keyed.get(TYPE_USER + ":" + id);
            if (name != null) {
                result.put(id, name);
            }
        }
        return result;
    }

    // ---------------------------------------------------------------- 内部

    private void resolveUserNames(Set<Long> ids, Map<String, String> sink) {
        for (Long id : ids) {
            try {
                IamUserVO u = iamWebClient.getUser(id);
                if (u == null) {
                    continue;
                }
                String display = u.realName() != null && !u.realName().isBlank()
                        ? u.realName() : u.username();
                if (display != null) {
                    sink.put(TYPE_USER + ":" + id, display);
                }
            } catch (Exception e) {
                // 单个失败不影响其余：名称只是展示增强
                log.debug("解析用户名失败 userId={}: {}", id, e.getMessage());
            }
        }
    }

    private void resolveRoleNames(Set<Long> ids, Map<String, String> sink) {
        if (ids.isEmpty()) {
            return;
        }
        try {
            // 角色总量小，一次拉全量再本地映射，比逐个 getRole 少 N-1 次远程调用
            List<IamRoleVO> roles = iamWebClient.listEnabledRoles(
                    RequestContext.requireTenantId(), RequestContext.requireAppId());
            if (roles == null) {
                return;
            }
            for (IamRoleVO r : roles) {
                Long id = parseId(r.id());
                if (id != null && ids.contains(id)) {
                    sink.put(TYPE_ROLE + ":" + id, r.name());
                }
            }
        } catch (Exception e) {
            log.debug("批量解析角色名失败: {}", e.getMessage());
        }
    }

    private void resolveDeptNames(Set<Long> ids, Map<String, String> sink) {
        for (Long id : ids) {
            try {
                DeptVO d = orgWebClient.getDept(id);
                if (d != null && d.name() != null) {
                    sink.put(TYPE_DEPT + ":" + id, d.name());
                }
            } catch (Exception e) {
                log.debug("解析部门名失败 deptId={}: {}", id, e.getMessage());
            }
        }
    }

    private static KbSubjectVO toDeptNode(DeptVO d) {
        Long id = parseId(d.id());
        if (id == null) {
            return null;
        }
        List<KbSubjectVO> children = new ArrayList<>();
        if (d.children() != null) {
            for (DeptVO child : d.children()) {
                KbSubjectVO node = toDeptNode(child);
                if (node != null) {
                    children.add(node);
                }
            }
        }
        return new KbSubjectVO(TYPE_DEPT, id, d.name(), d.code(), children);
    }

    private static boolean matches(String keywordLower, String... fields) {
        for (String field : fields) {
            if (field != null && field.toLowerCase().contains(keywordLower)) {
                return true;
            }
        }
        return false;
    }

    /**
     * 下游 id 为字符串（雪花 id 防 JS 精度丢失），此处转回 Long。
     *
     * @param raw 原始字符串
     * @return 解析结果；非数字返回 {@code null}
     */
    private static Long parseId(String raw) {
        if (raw == null || raw.isBlank()) {
            return null;
        }
        try {
            return Long.parseLong(raw.trim());
        } catch (NumberFormatException e) {
            log.debug("主体 id 解析失败 raw={}", raw);
            return null;
        }
    }

    /**
     * 主体标识。
     *
     * @param type 主体类型
     * @param id   主体 id
     */
    public record SubjectKey(String type, Long id) {
    }
}
