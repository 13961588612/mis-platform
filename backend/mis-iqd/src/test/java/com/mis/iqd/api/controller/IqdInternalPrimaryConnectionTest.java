package com.mis.iqd.api.controller;

import com.mis.iqd.domain.entity.IqdConnection;
import com.mis.iqd.domain.repository.IqdConnectionRepository;
import com.mis.iqd.domain.service.IqdAdminService;
import com.mis.iqd.domain.service.IqdCatalogNodeService;
import com.mis.iqd.domain.service.IqdScopeSyncJobService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;

import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.when;

/**
 * 建模台 T08「主连接语义对齐」Java 侧契约守卫（§14.5.1 A/B/C/D）。
 *
 * <p>聚焦 {@link IqdInternalController#getConnections()} 新增计算字段 {@code is_primary}
 * 与权威选主方法 {@link IqdAdminService#findPrimaryConnection()} 的**一致性**（纯 Mockito
 * 单测，不加载 Spring、不依赖活体 DB）：
 * <ul>
 *   <li><b>核心反例</b>：两条 {@code enabled=1}，{@code name='default'} 的 id <b>更大</b>
 *       ⇒ 主连接恒为 {@code default} 那条（第①级），<b>不选最小 id</b> —— 证伪历史
 *       「Python 只取 {@code connections[0]}= 最小 id」的漂移；</li>
 *   <li>无 {@code default} ⇒ 落到 <b>id 最小</b>的 {@code enabled}（第②级）；</li>
 *   <li>有 {@code default} 但已 {@code enabled=false} ⇒ 权威选主<b>仍是它</b>
 *       （第①级<b>不筛 enabled</b>），该行不在启用清单 ⇒ 启用清单内无 {@code is_primary}；</li>
 *   <li>无 {@code enabled} ⇒ 兜底第③级（任意首行），启用清单返回空；表空 ⇒ 无主连接。</li>
 * </ul>
 *
 * <p>{@code is_primary} 由 {@code findPrimaryConnection()} 派生 ⇒ 与 {@code GET /config}
 * <b>同源</b>，两侧落点恒等（验收 T08-2 / -3 / -4）。
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class IqdInternalPrimaryConnectionTest {

    @Mock IqdConnectionRepository connectionRepository;

    // IqdAdminService 其余构造依赖（本测试不触达，mock 以满足构造注入）
    @Mock com.mis.iqd.domain.repository.IqdAskLogRepository askLogRepository;
    @Mock com.mis.iqd.domain.repository.IqdCatalogItemRepository catalogItemRepository;
    @Mock com.mis.iqd.domain.repository.IqdScopePolicyRepository scopePolicyRepository;
    @Mock com.mis.iqd.domain.repository.IqdTableAclRepository tableAclRepository;
    @Mock com.mis.iqd.domain.repository.IqdMaskRuleRepository maskRuleRepository;
    @Mock com.mis.iqd.domain.repository.IqdRowScopeDimensionRepository dimensionRepository;
    @Mock com.mis.iqd.domain.repository.IqdSqlPairRepository sqlPairRepository;
    @Mock com.mis.iqd.domain.repository.IqdKnowledgeRepository knowledgeRepository;
    @Mock com.mis.iqd.domain.repository.IqdSyncJobRepository syncJobRepository;
    @Mock com.mis.iqd.domain.repository.IqdEditIdempotencyRepository editIdempotencyRepository;
    @Mock com.mis.iqd.domain.service.IqdChangeEventPublisher changeEventPublisher;
    @Mock com.fasterxml.jackson.databind.ObjectMapper objectMapper;

    @InjectMocks IqdAdminService adminService;

    // 控制器其余依赖（本测试不触达，mock 以满足构造）
    @Mock IqdScopeSyncJobService scopeSyncJobService;
    @Mock IqdCatalogNodeService catalogNodeService;

    private IqdInternalController controller;

    @BeforeEach
    void setUp() {
        // 关键：控制器与 adminService 共用同一个 connectionRepository mock
        // ⇒ getConnections() 与 findPrimaryConnection() 走同一份仓库桩，口径可对齐验证。
        controller = new IqdInternalController(
                connectionRepository, adminService, scopeSyncJobService, catalogNodeService);
    }

    /** 构造一条最小连接。 */
    private IqdConnection conn(long id, String name, int enabled) {
        IqdConnection c = new IqdConnection();
        c.setId(id);
        c.setName(name);
        c.setEnabled(enabled);
        c.setBaseUrl("http://ds:3000");
        c.setAuthType("none");
        return c;
    }

    /** 从 get-connections 结果中取被标记 is_primary 的行 id（无则 null）。 */
    private Long primaryRowId(List<Map<String, Object>> rows) {
        return rows.stream()
                .filter(r -> Boolean.TRUE.equals(r.get("is_primary")))
                .map(r -> (Long) r.get("id"))
                .findFirst()
                .orElse(null);
    }

    /** 权威选主方法（== GET /config 口径）解析出的 id。 */
    private Long authoritativePrimaryId() {
        return adminService.findPrimaryConnection().map(IqdConnection::getId).orElse(null);
    }

    // --------------------------------------------- 核心反例：default 的 id 更大

    @Test
    void twoEnabled_defaultHasLargerId_primaryIsDefault_notSmallestId() {
        IqdConnection smallest = conn(1L, "sales", 1);   // 最小 id（旧 Python 口径会选它）
        IqdConnection defaultConn = conn(5L, "default", 1); // 主连接（id 更大）

        when(connectionRepository.findByName("default")).thenReturn(Optional.of(defaultConn));
        when(connectionRepository.findByEnabledOrderByIdAsc(1))
                .thenReturn(List.of(smallest, defaultConn));

        List<Map<String, Object>> rows = controller.getConnections().getData();

        assertEquals(2, rows.size(), "两条 enabled 必须都返回（结构本就支持多条）");
        assertEquals(1, rows.stream()
                        .filter(r -> Boolean.TRUE.equals(r.get("is_primary"))).count(),
                "恰有一条 is_primary=true");
        assertEquals(5L, primaryRowId(rows),
                "主连接 = name='default'（id 更大），绝不选最小 id（漂移核心反例）");
        assertFalse(Boolean.TRUE.equals(rows.get(0).get("is_primary")),
                "最小 id 行不得被标记为主连接");
        // 与权威选主方法逐一致（即 GET /config 口径）
        assertEquals(5L, authoritativePrimaryId());
        assertEquals(authoritativePrimaryId(), primaryRowId(rows),
                "is_primary 行 id 必须 == findPrimaryConnection() 选出的 id");
    }

    // --------------------------------------------- 无 default ⇒ 第②级：最小 id enabled

    @Test
    void noDefault_fallsBackToSmallestIdEnabled() {
        IqdConnection a = conn(2L, "a", 1);
        IqdConnection b = conn(7L, "b", 1);

        when(connectionRepository.findByName("default")).thenReturn(Optional.empty());
        when(connectionRepository.findByEnabledOrderByIdAsc(1)).thenReturn(List.of(a, b));

        List<Map<String, Object>> rows = controller.getConnections().getData();

        assertEquals(2, rows.size());
        assertEquals(2L, primaryRowId(rows), "无 default ⇒ 主连接 = id 最小的 enabled（第②级）");
        assertEquals(2L, authoritativePrimaryId());
    }

    // --------------------------------------------- 有 default 但已停用 ⇒ 第①级不筛 enabled

    @Test
    void defaultExistsButDisabled_primaryStillDefault_enabledRowNotMarked() {
        IqdConnection disabledDefault = conn(5L, "default", 0); // 停用的主连接
        IqdConnection otherEnabled = conn(1L, "sales", 1);

        when(connectionRepository.findByName("default")).thenReturn(Optional.of(disabledDefault));
        // 启用清单不含停用的 default（get-connections 仅回 enabled=1）
        when(connectionRepository.findByEnabledOrderByIdAsc(1)).thenReturn(List.of(otherEnabled));

        List<Map<String, Object>> rows = controller.getConnections().getData();

        assertEquals(1, rows.size(), "仅一条 enabled 返回");
        assertEquals(1L, rows.get(0).get("id"));
        assertFalse(Boolean.TRUE.equals(rows.get(0).get("is_primary")),
                "启用清单内的非 default 行不得被标记为主连接");
        assertEquals(5L, authoritativePrimaryId(),
                "第①级不筛 enabled：default 存在即为主连接（与 findPrimaryConnection 一致）");
    }

    // --------------------------------------------- 无 enabled ⇒ 第③级兜底

    @Test
    void noEnabled_fallsBackToFirstRow_butEnabledListEmpty() {
        IqdConnection onlyRow = conn(9L, "x", 0);

        when(connectionRepository.findByName("default")).thenReturn(Optional.empty());
        when(connectionRepository.findByEnabledOrderByIdAsc(1)).thenReturn(List.of());
        when(connectionRepository.findAll()).thenReturn(List.of(onlyRow));

        List<Map<String, Object>> rows = controller.getConnections().getData();

        assertTrue(rows.isEmpty(), "无 enabled ⇒ get-connections 返回空清单");
        assertEquals(9L, authoritativePrimaryId(), "第③级兜底：任意首行");
    }

    // --------------------------------------------- 表空 ⇒ 无主连接

    @Test
    void emptyTable_noPrimary_andEmptyList() {
        when(connectionRepository.findByName("default")).thenReturn(Optional.empty());
        when(connectionRepository.findByEnabledOrderByIdAsc(1)).thenReturn(List.of());
        when(connectionRepository.findAll()).thenReturn(List.of());

        assertTrue(controller.getConnections().getData().isEmpty());
        assertEquals(null, authoritativePrimaryId(), "表空 ⇒ 无主连接（GET /config 回空视图）");
        // 6 处内部读面之一：无主连接 ⇒ 返回空数组（resolvePrimaryConnectionId 返回 null 路径）
        assertTrue(controller.getAcls().getData().isEmpty());
    }

    // --------------------------------------------- 向后兼容：既有键不变 + is_primary 追加末尾

    @Test
    void getConnections_appendsIsPrimary_keepsExistingKeys() {
        IqdConnection defaultConn = conn(5L, "default", 1);
        when(connectionRepository.findByName("default")).thenReturn(Optional.of(defaultConn));
        when(connectionRepository.findByEnabledOrderByIdAsc(1)).thenReturn(List.of(defaultConn));

        Map<String, Object> row = controller.getConnections().getData().get(0);

        // 既有键一个不少（追加键不破坏既有解析）
        for (String key : List.of("id", "name", "baseUrl", "authType", "projectId",
                "defaultConnector", "timeoutSeconds", "language", "status", "enabled",
                "mcp_status", "mcp_port")) {
            assertTrue(row.containsKey(key), "既有键必须保留: " + key);
        }
        assertNotNull(row.get("is_primary"));
        assertTrue(row.get("is_primary") instanceof Boolean, "is_primary 为布尔");
        assertEquals(Boolean.TRUE, row.get("is_primary"));
    }
}
