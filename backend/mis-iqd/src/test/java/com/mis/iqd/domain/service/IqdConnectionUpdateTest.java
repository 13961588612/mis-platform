package com.mis.iqd.domain.service;

import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.mis.common.core.exception.BusinessException;
import com.mis.iqd.api.dto.IqdConnectionUpdateRequest;
import com.mis.iqd.api.dto.IqdConnectionVO;
import com.mis.iqd.domain.entity.IqdConnection;
import com.mis.iqd.domain.repository.IqdConnectionRepository;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;
import org.slf4j.LoggerFactory;

import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 建模台 T06「按 id 更新连接」Java 逻辑单测（契约守卫）。
 *
 * <p>纯 Mockito 单测（不加载 Spring、不依赖活体 DB / WrenAI），聚焦
 * {@link IqdAdminService#updateConnection(Long, IqdConnectionUpdateRequest)} 的核心契约
 * （system-design §14.1 / §14.5 / §14.5.1 A）：
 * <ul>
 *   <li><b>局部更新</b>：只提交 {@code name} ⇒ 其余字段（{@code base_url} / {@code auth_type} /
 *       {@code timeout_seconds} / {@code language} / {@code enabled}）全部保持原值
 *       （守卫「新 DTO 无默认值」这一 §14.1 裁决）；</li>
 *   <li><b>40900</b>：改名撞 {@code uk_iqd_connection_name}（先查后报，库中名未变、无 50000）；</li>
 *   <li>改名同值 → 跳过唯一校验（不误报 40900）；</li>
 *   <li><b>42200</b>：{@code id} 为空 / 连接不存在 / {@code timeout_seconds <= 0}；</li>
 *   <li><b>secret_ref 留空保留原值</b>（{@code null}/{@code ******}/空白 → 不改；非空非占位 → 写入）；</li>
 *   <li><b>enabled 切换只写本行</b>（不联动其它连接，§14.5）；</li>
 *   <li><b>主连接迁移日志</b>（§14.5.1 A）：改名离开/占用 {@code default} ⇒ 打结构化日志。</li>
 * </ul>
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class IqdConnectionUpdateTest {

    @Mock IqdConnectionRepository connectionRepository;
    @Mock IqdChangeEventPublisher changeEventPublisher;
    @Mock ObjectMapper objectMapper;

    // 其余构造参数（本期测试不直接触达，mock 以满足 InjectMocks 构造）
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

    @InjectMocks
    IqdAdminService service;

    private static final long CONN_ID = 7L;

    /** 构造一条「字段齐全」的既有连接，便于断言「未提交字段保持不变」。 */
    private IqdConnection existingConnection(long id, String name) {
        IqdConnection c = new IqdConnection();
        c.setId(id);
        c.setName(name);
        c.setBaseUrl("http://old:3000");
        c.setAuthType("basic");
        c.setSecretRef("sec-old");
        c.setProjectId("proj-old");
        c.setDefaultConnector("postgres");
        c.setTimeoutSeconds(90);
        c.setLanguage("en");
        c.setEnabled(1);
        c.setStatus("active");
        return c;
    }

    private void stubFound(IqdConnection c) {
        when(connectionRepository.findById(c.getId())).thenReturn(Optional.of(c));
        when(connectionRepository.save(any(IqdConnection.class))).thenAnswer(inv -> inv.getArgument(0));
    }

    // ------------------------------------------------------------ 局部更新：只改名不污染其它字段

    @Test
    void updateConnection_partialUpdate_onlyChangesName_keepsOtherFields() {
        IqdConnection c = existingConnection(CONN_ID, "A");
        stubFound(c);
        when(connectionRepository.existsByName("X2")).thenReturn(false);

        IqdConnectionUpdateRequest dto = new IqdConnectionUpdateRequest();
        dto.setName("X2"); // 只提交 name

        IqdConnectionVO vo = service.updateConnection(CONN_ID, dto);

        // 提交字段已变更
        assertEquals("X2", c.getName());
        // 未提交字段全部保持原值（守卫「新 DTO 无 Java 默认值」裁决）
        assertEquals("http://old:3000", c.getBaseUrl());
        assertEquals("basic", c.getAuthType());
        assertEquals("sec-old", c.getSecretRef());
        assertEquals("proj-old", c.getProjectId());
        assertEquals("postgres", c.getDefaultConnector());
        assertEquals(90, c.getTimeoutSeconds().intValue());
        assertEquals("en", c.getLanguage());
        assertEquals(1, c.getEnabled().intValue());
        // 响应与 GET /connections 元素同形（凭证恒 ******）
        assertEquals(CONN_ID, vo.getId());
        assertEquals("X2", vo.getName());
        assertEquals("http://old:3000", vo.getBaseUrl());
        assertEquals("basic", vo.getAuthType());
        assertEquals("******", vo.getSecretRef());
        assertEquals(90, vo.getTimeoutSeconds().intValue());
        assertEquals(Boolean.TRUE, vo.getEnabled());
        // 变更事件已发（Worker 缓存刷新）
        verify(changeEventPublisher, times(1)).publish(eq("iqd.config.changed"), anyString());
    }

    // ------------------------------------------------------------ 改名撞唯一约束 → 40900（先查后报）

    @Test
    void updateConnection_renameConflict_throws409_andDoesNotSave() {
        IqdConnection c = existingConnection(CONN_ID, "A");
        when(connectionRepository.findById(CONN_ID)).thenReturn(Optional.of(c));
        when(connectionRepository.existsByName("B")).thenReturn(true); // B 已被占用

        IqdConnectionUpdateRequest dto = new IqdConnectionUpdateRequest();
        dto.setName("B");

        BusinessException ex = assertThrows(BusinessException.class,
                () -> service.updateConnection(CONN_ID, dto));

        assertEquals(40900, ex.getCode());
        @SuppressWarnings("unchecked")
        Map<String, Object> data = (Map<String, Object>) ex.getData();
        assertNotNull(data);
        assertEquals("B", data.get("name"));
        // 先查后报：库中名未变、不落库、不发事件（无约束异常、无 50000）
        assertEquals("A", c.getName());
        verify(connectionRepository, never()).save(any(IqdConnection.class));
        verify(changeEventPublisher, never()).publish(anyString(), anyString());
    }

    @Test
    void updateConnection_renameToSameName_skipsUniqueCheck_andSucceeds() {
        IqdConnection c = existingConnection(CONN_ID, "A");
        stubFound(c);

        IqdConnectionUpdateRequest dto = new IqdConnectionUpdateRequest();
        dto.setName("A"); // 改成自身同名

        IqdConnectionVO vo = service.updateConnection(CONN_ID, dto);

        assertEquals("A", vo.getName());
        // 同值改名跳过唯一校验（不误报 40900）
        verify(connectionRepository, never()).existsByName(anyString());
        verify(connectionRepository, times(1)).save(any(IqdConnection.class));
    }

    // ------------------------------------------------------------ 连接不存在 / id 空 → 42200

    @Test
    void updateConnection_notFound_throws422() {
        when(connectionRepository.findById(999999L)).thenReturn(Optional.empty());

        BusinessException ex = assertThrows(BusinessException.class,
                () -> service.updateConnection(999999L, new IqdConnectionUpdateRequest()));

        assertEquals(42200, ex.getCode()); // 对齐建模台节点族（非 40400）
        verify(connectionRepository, never()).save(any(IqdConnection.class));
    }

    @Test
    void updateConnection_nullId_throws422() {
        BusinessException ex = assertThrows(BusinessException.class,
                () -> service.updateConnection(null, new IqdConnectionUpdateRequest()));

        assertEquals(42200, ex.getCode());
        verify(connectionRepository, never()).save(any(IqdConnection.class));
    }

    // ------------------------------------------------------------ timeout <= 0 → 42200（零副作用）

    @Test
    void updateConnection_nonPositiveTimeout_throws422_noSideEffect() {
        IqdConnection c = existingConnection(CONN_ID, "A");
        when(connectionRepository.findById(CONN_ID)).thenReturn(Optional.of(c));

        IqdConnectionUpdateRequest dto = new IqdConnectionUpdateRequest();
        dto.setTimeoutSeconds(0);

        BusinessException ex = assertThrows(BusinessException.class,
                () -> service.updateConnection(CONN_ID, dto));

        assertEquals(42200, ex.getCode());
        @SuppressWarnings("unchecked")
        Map<String, Object> data = (Map<String, Object>) ex.getData();
        assertEquals("timeout_seconds", data.get("field"));
        assertEquals(90, c.getTimeoutSeconds().intValue()); // 原值未变
        verify(connectionRepository, never()).save(any(IqdConnection.class));
    }

    // ------------------------------------------------------------ secret_ref：留空/占位 = 保留原值

    @Test
    void updateConnection_secretRefPlaceholderOrBlank_keepsOriginal() {
        IqdConnection c = existingConnection(CONN_ID, "A");
        stubFound(c);

        IqdConnectionUpdateRequest placeholder = new IqdConnectionUpdateRequest();
        placeholder.setSecretRef("******");
        service.updateConnection(CONN_ID, placeholder);
        assertEquals("sec-old", c.getSecretRef(), "占位符 ****** 必须保留原值");

        IqdConnectionUpdateRequest blank = new IqdConnectionUpdateRequest();
        blank.setSecretRef("   ");
        service.updateConnection(CONN_ID, blank);
        assertEquals("sec-old", c.getSecretRef(), "空白必须保留原值");
    }

    @Test
    void updateConnection_secretRefNonBlank_updates() {
        IqdConnection c = existingConnection(CONN_ID, "A");
        stubFound(c);

        IqdConnectionUpdateRequest dto = new IqdConnectionUpdateRequest();
        dto.setSecretRef("sec-new");

        IqdConnectionVO vo = service.updateConnection(CONN_ID, dto);

        assertEquals("sec-new", c.getSecretRef());
        // 响应仍恒回占位符，不泄露明值
        assertEquals("******", vo.getSecretRef());
    }

    // ------------------------------------------------------------ enabled 只写本行（不联动其它连接）

    @Test
    void updateConnection_enable_togglesOnlyTargetRow_noCrossLink() {
        IqdConnection a = existingConnection(1L, "A"); // 已 enabled
        IqdConnection b = existingConnection(2L, "B");
        b.setEnabled(0); // B 当前停用
        when(connectionRepository.findById(2L)).thenReturn(Optional.of(b));
        when(connectionRepository.save(any(IqdConnection.class))).thenAnswer(inv -> inv.getArgument(0));

        IqdConnectionUpdateRequest dto = new IqdConnectionUpdateRequest();
        dto.setEnabled(true);

        IqdConnectionVO vo = service.updateConnection(2L, dto);

        assertEquals(1, b.getEnabled().intValue());          // 目标行已启用
        assertEquals(1, a.getEnabled().intValue());          // 另一连接不受影响（无自动停用）
        assertEquals(Boolean.TRUE, vo.getEnabled());
        // 仅写目标行：save 恰一次，且保存的是 B
        ArgumentCaptor<IqdConnection> captor = ArgumentCaptor.forClass(IqdConnection.class);
        verify(connectionRepository, times(1)).save(captor.capture());
        assertEquals(2L, captor.getValue().getId());
    }

    // ------------------------------------------------------------ 主连接迁移日志（§14.5.1 A）

    @Test
    void updateConnection_renameAwayFromDefault_logsPrimaryMigrated() {
        IqdConnection c = existingConnection(CONN_ID, "default");
        stubFound(c);
        when(connectionRepository.existsByName("prod")).thenReturn(false);

        ListAppender<ILoggingEvent> appender = attachAppender();
        try {
            IqdConnectionUpdateRequest dto = new IqdConnectionUpdateRequest();
            dto.setName("prod");
            service.updateConnection(CONN_ID, dto);
        } finally {
            detachAppender(appender);
        }

        assertTrue(appender.list.stream()
                        .anyMatch(e -> e.getFormattedMessage().contains("primary migrated by rename")),
                "改名离开 default 必须打 'primary migrated by rename' 结构化日志");
    }

    @Test
    void updateConnection_renameToDefault_logsPrimaryClaimed() {
        IqdConnection c = existingConnection(CONN_ID, "sales");
        stubFound(c);
        when(connectionRepository.existsByName("default")).thenReturn(false);

        ListAppender<ILoggingEvent> appender = attachAppender();
        try {
            IqdConnectionUpdateRequest dto = new IqdConnectionUpdateRequest();
            dto.setName("default");
            service.updateConnection(CONN_ID, dto);
        } finally {
            detachAppender(appender);
        }

        assertTrue(appender.list.stream()
                        .anyMatch(e -> e.getFormattedMessage().contains("primary claimed by rename")),
                "改名占用 default 必须打 'primary claimed by rename' 结构化日志");
    }

    @Test
    void updateConnection_renameBetweenNonDefault_doesNotLogPrimaryMigration() {
        IqdConnection c = existingConnection(CONN_ID, "sales");
        stubFound(c);
        when(connectionRepository.existsByName("marketing")).thenReturn(false);

        ListAppender<ILoggingEvent> appender = attachAppender();
        try {
            IqdConnectionUpdateRequest dto = new IqdConnectionUpdateRequest();
            dto.setName("marketing");
            service.updateConnection(CONN_ID, dto);
        } finally {
            detachAppender(appender);
        }

        assertFalse(appender.list.stream().anyMatch(e ->
                        e.getFormattedMessage().contains("primary migrated by rename")
                                || e.getFormattedMessage().contains("primary claimed by rename")),
                "非 default 之间的改名不得打主连接迁移日志");
    }

    // ------------------------------------------------------------ 辅助：logback 日志捕获

    private ListAppender<ILoggingEvent> attachAppender() {
        Logger serviceLogger = (Logger) LoggerFactory.getLogger(IqdAdminService.class);
        ListAppender<ILoggingEvent> appender = new ListAppender<>();
        appender.start();
        serviceLogger.addAppender(appender);
        return appender;
    }

    private void detachAppender(ListAppender<ILoggingEvent> appender) {
        Logger serviceLogger = (Logger) LoggerFactory.getLogger(IqdAdminService.class);
        serviceLogger.detachAppender(appender);
        appender.stop();
    }
}
