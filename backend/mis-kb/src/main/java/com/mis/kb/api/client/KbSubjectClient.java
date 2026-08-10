package com.mis.kb.api.client;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;

import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Objects;

/**
 * 主体（用户/角色/部门）取数客户端。
 *
 * <p>复用 mis-iam 端点契约（不引入其私有类），用于 ACL 可见性评估时取用户的角色与部门。
 * 配置 {@code mis.kb.iam.base-url}（Nacos/环境变量）；未配置或不可达时<b>降级</b>返回空，
 * 使主流程在无 IAM 环境下仍可运行（仅 public 库可见）。
 *
 * <h3>本次修正的既有缺陷（计划外发现，记为 X-04）</h3>
 * P0 实现调用 {@code GET /internal/v1/users/{id}/auth}，并把响应体直接反序列化成
 * {@code IamUserAuth(Long userId, List<RoleDto> roles)}。但 mis-iam 的实际契约是：
 * <ul>
 *   <li>响应被 {@code Result<T>} 包装（{@code {code,message,data,traceId}}），根节点没有 {@code roles}；</li>
 *   <li>{@code /auth} 返回的 {@code AuthUserVO} 只有 {@code roleCodes}（角色<b>码</b>字符串数组），
 *       <b>没有角色 id</b>，而 {@code kb_acl.subject_id} 存的是角色 <b>id</b>；</li>
 *   <li>mis-iam 的 id 字段一律是 {@code String}，不是 {@code Long}。</li>
 * </ul>
 * 三处叠加导致 {@code fetchUserRoleIds} <b>恒返回空列表</b>——角色级 ACL 从未真正生效，
 * 且因为有 try/catch 降级，故障被静默吞掉、日志里也看不出异常。
 * 现改为调用 {@code GET /internal/v1/users/{id}}（返回 {@code Result<UserVO>}，
 * 含 {@code roles[].id}、{@code deptId}、{@code deptIds}），并统一做 String→Long 解析。
 */
@Component
public class KbSubjectClient {

    private static final Logger log = LoggerFactory.getLogger(KbSubjectClient.class);

    private final RestClient client;

    public KbSubjectClient(
            RestClient.Builder builder,
            @Value("${mis.kb.iam.base-url:}") String iamBaseUrl) {
        this.client = iamBaseUrl == null || iamBaseUrl.isBlank()
                ? null
                : builder.baseUrl(iamBaseUrl).build();
    }

    /**
     * 取用户角色 id 列表；IAM 未配置/不可达时降级返回空（仅 public 库可见）。
     *
     * @param userId 用户 id
     * @return 角色 id 列表，永不为 {@code null}
     */
    public List<Long> fetchUserRoleIds(Long userId) {
        IamUserVO user = fetchUser(userId);
        if (user == null || user.roles() == null) {
            return Collections.emptyList();
        }
        List<Long> roleIds = new ArrayList<>();
        for (IamRoleVO role : user.roles()) {
            Long id = parseId(role == null ? null : role.id());
            if (id != null) {
                roleIds.add(id);
            }
        }
        return roleIds;
    }

    /**
     * 取用户主部门 id（I-03）。
     *
     * @param userId 用户 id
     * @return 主部门 id；未配置 IAM、用户无部门或解析失败时返回 {@code null}
     */
    public Long fetchUserDeptId(Long userId) {
        IamUserVO user = fetchUser(userId);
        if (user == null) {
            return null;
        }
        Long primary = parseId(user.deptId());
        if (primary != null) {
            return primary;
        }
        // 主部门为空时回落多部门列表的第一个（V11 起支持员工多部门）
        List<Long> all = toLongList(user.deptIds());
        return all.isEmpty() ? null : all.get(0);
    }

    /**
     * 取用户全部部门 id（主部门 + 多部门，去重）。
     *
     * <p>可见性评估用这个而非 {@link #fetchUserDeptId}：员工可能挂多个部门，
     * 只认主部门会漏掉本应可见的库。
     *
     * @param userId 用户 id
     * @return 部门 id 列表（去重、保持顺序），永不为 {@code null}
     */
    public List<Long> fetchUserDeptIds(Long userId) {
        IamUserVO user = fetchUser(userId);
        if (user == null) {
            return Collections.emptyList();
        }
        LinkedHashSet<Long> ids = new LinkedHashSet<>();
        Long primary = parseId(user.deptId());
        if (primary != null) {
            ids.add(primary);
        }
        ids.addAll(toLongList(user.deptIds()));
        return new ArrayList<>(ids);
    }

    /**
     * 取用户角色码列表（知识库域一期：全局管理员短路判定用）。
     *
     * <p>复用内部 {@code fetchUser} 已返回的 {@code roles[].code}——mis-iam 的
     * {@code UserVO} 同时带角色 id 与角色码，无需额外请求。IAM 未配置/不可达时
     * 降级返回空（安全侧收紧：角色码短路不命中，回到祖先链逐节点判定）。
     *
     * @param userId 用户 id
     * @return 角色码列表（去重、保持顺序），永不为 {@code null}
     */
    public List<String> fetchUserRoleCodes(Long userId) {
        IamUserVO user = fetchUser(userId);
        if (user == null || user.roles() == null) {
            return Collections.emptyList();
        }
        LinkedHashSet<String> codes = new LinkedHashSet<>();
        for (IamRoleVO role : user.roles()) {
            if (role != null && role.code() != null && !role.code().isBlank()) {
                codes.add(role.code());
            }
        }
        return new ArrayList<>(codes);
    }

    // ---------------------------------------------------------------- 内部

    /**
     * 拉取用户档案。
     *
     * <p>失败一律降级为 {@code null} 并打 warn——可见性计算不能因 IAM 抖动而整体失败，
     * 降级后的效果是「只看得到 public 库」，安全侧是收紧而非放宽。
     */
    private IamUserVO fetchUser(Long userId) {
        if (client == null || userId == null) {
            return null;
        }
        try {
            IamResult<IamUserVO> resp = client.get()
                    .uri("/internal/v1/users/{userId}", userId)
                    .retrieve()
                    .body(new ParameterizedTypeReference<IamResult<IamUserVO>>() {});
            if (resp == null || resp.data() == null) {
                log.warn("IAM 用户档案为空 userId={}，降级为仅 public 库可见", userId);
                return null;
            }
            return resp.data();
        } catch (Exception e) {
            log.warn("取 IAM 用户档案失败 userId={}，降级为仅 public 库可见: {}", userId, e.getMessage());
            return null;
        }
    }

    /** 宽松解析 id：mis-iam 的 id 是字符串形态的雪花号，非数字一律返回 null。 */
    private static Long parseId(String raw) {
        if (raw == null || raw.isBlank()) {
            return null;
        }
        try {
            return Long.valueOf(raw.trim());
        } catch (NumberFormatException e) {
            log.warn("IAM 返回的 id 无法解析为 Long: {}", raw);
            return null;
        }
    }

    private static List<Long> toLongList(List<String> raw) {
        if (raw == null || raw.isEmpty()) {
            return Collections.emptyList();
        }
        return raw.stream().map(KbSubjectClient::parseId).filter(Objects::nonNull).toList();
    }

    /** {@code Result<T>} 的最小镜像（只取 data，避开对 mis-iam/common 的编译期依赖）。 */
    @JsonIgnoreProperties(ignoreUnknown = true)
    private record IamResult<T>(
            @JsonProperty("code") Integer code,
            @JsonProperty("message") String message,
            @JsonProperty("data") T data) {
    }

    /** mis-iam {@code UserVO} 的最小镜像（只取本模块需要的字段）。 */
    @JsonIgnoreProperties(ignoreUnknown = true)
    private record IamUserVO(
            @JsonProperty("id") String id,
            @JsonProperty("deptId") String deptId,
            @JsonProperty("deptIds") List<String> deptIds,
            @JsonProperty("roles") List<IamRoleVO> roles) {
    }

    /** mis-iam {@code RoleVO} 的最小镜像。 */
    @JsonIgnoreProperties(ignoreUnknown = true)
    private record IamRoleVO(
            @JsonProperty("id") String id,
            @JsonProperty("code") String code) {
    }
}
