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
 * å»ºæ¨¡å° T06ãæ id æ´æ°è¿æ¥ãJava é»è¾åæµï¼å¥çº¦å®å«ï¼ã
 *
 * <p>çº¯ Mockito åæµï¼ä¸å è½½ Springãä¸ä¾èµæ´»ä½ DB / WrenAIï¼ï¼èç¦
 * {@link IqdAdminService#updateConnection(Long, IqdConnectionUpdateRequest)} çæ ¸å¿å¥çº¦
 * ï¼system-design Â§14.1 / Â§14.5 / Â§14.5.1 Aï¼ï¼
 * <ul>
 *   <li><b>å±é¨æ´æ°</b>ï¼åªæäº¤ {@code name} â å¶ä½å­æ®µï¼{@code base_url} / {@code auth_type} /
 *       {@code timeout_seconds} / {@code language} / {@code enabled}ï¼å¨é¨ä¿æåå¼
 *       ï¼å®å«ãæ° DTO æ é»è®¤å¼ãè¿ä¸ Â§14.1 è£å³ï¼ï¼</li>
 *   <li><b>40900</b>ï¼æ¹åæ {@code uk_iqd_connection_name}ï¼åæ¥åæ¥ï¼åºä¸­åæªåãæ  50000ï¼ï¼</li>
 *   <li>æ¹ååå¼ â è·³è¿å¯ä¸æ ¡éªï¼ä¸è¯¯æ¥ 40900ï¼ï¼</li>
 *   <li><b>42200</b>ï¼{@code id} ä¸ºç©º / è¿æ¥ä¸å­å¨ / {@code timeout_seconds <= 0}ï¼</li>
 *   <li><b>secret_ref çç©ºä¿çåå¼</b>ï¼{@code null}/{@code ******}/ç©ºç½ â ä¸æ¹ï¼éç©ºéå ä½ â åå¥ï¼ï¼</li>
 *   <li><b>enabled åæ¢åªåæ¬è¡</b>ï¼ä¸èå¨å¶å®è¿æ¥ï¼Â§14.5ï¼ï¼</li>
 *   <li><b>ä¸»è¿æ¥è¿ç§»æ¥å¿</b>ï¼Â§14.5.1 Aï¼ï¼æ¹åç¦»å¼/å ç¨ {@code default} â æç»æåæ¥å¿ã</li>
 * </ul>
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class IqdConnectionUpdateTest {

    @Mock IqdConnectionRepository connectionRepository;
    @Mock IqdChangeEventPublisher changeEventPublisher;
    @Mock ObjectMapper objectMapper;

    // å¶ä½æé åæ°ï¼æ¬ææµè¯ä¸ç´æ¥è§¦è¾¾ï¼mock ä»¥æ»¡è¶³ InjectMocks æé ï¼
    @Mock com.mis.iqd.domain.repository.IqdAskLogRepository askLogRepository;
    @Mock com.mis.iqd.domain.repository.IqdCatalogItemRepository catalogItemRepository;
    @Mock com.mis.iqd.domain.repository.IqdScopePolicyRepository scopePolicyRepository;
    @Mock com.mis.iqd.domain.repository.IqdTableAclRepository tableAclRepository;
    @Mock com.mis.iqd.domain.repository.IqdMaskRuleRepository maskRuleRepository;
    @Mock com.mis.iqd.domain.repository.IqdRowScopeDimensionRepository dimensionRepository;
    @Mock com.mis.iqd.domain.repository.IqdSqlPairRepository sqlPairRepository;
    @Mock com.mis.iqd.domain.repository.IqdSqlPairCategoryRepository sqlPairCategoryRepository;
    @Mock com.mis.iqd.domain.repository.IqdKnowledgeRepository knowledgeRepository;
    @Mock com.mis.iqd.domain.repository.IqdSyncJobRepository syncJobRepository;
    @Mock com.mis.iqd.domain.repository.IqdEditIdempotencyRepository editIdempotencyRepository;

    @InjectMocks
    IqdAdminService service;

    private static final long CONN_ID = 7L;

    /** æé ä¸æ¡ãå­æ®µé½å¨ãçæ¢æè¿æ¥ï¼ä¾¿äºæ­è¨ãæªæäº¤å­æ®µä¿æä¸åãã */
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

    // ------------------------------------------------------------ å±é¨æ´æ°ï¼åªæ¹åä¸æ±¡æå¶å®å­æ®µ

    @Test
    void updateConnection_partialUpdate_onlyChangesName_keepsOtherFields() {
        IqdConnection c = existingConnection(CONN_ID, "A");
        stubFound(c);
        when(connectionRepository.existsByName("X2")).thenReturn(false);

        IqdConnectionUpdateRequest dto = new IqdConnectionUpdateRequest();
        dto.setName("X2"); // åªæäº¤ name

        IqdConnectionVO vo = service.updateConnection(CONN_ID, dto);

        // æäº¤å­æ®µå·²åæ´
        assertEquals("X2", c.getName());
        // æªæäº¤å­æ®µå¨é¨ä¿æåå¼ï¼å®å«ãæ° DTO æ  Java é»è®¤å¼ãè£å³ï¼
        assertEquals("http://old:3000", c.getBaseUrl());
        assertEquals("basic", c.getAuthType());
        assertEquals("sec-old", c.getSecretRef());
        assertEquals("proj-old", c.getProjectId());
        assertEquals("postgres", c.getDefaultConnector());
        assertEquals(90, c.getTimeoutSeconds().intValue());
        assertEquals("en", c.getLanguage());
        assertEquals(1, c.getEnabled().intValue());
        // ååºä¸ GET /connections åç´ åå½¢ï¼å­è¯æ ******ï¼
        assertEquals(CONN_ID, vo.getId());
        assertEquals("X2", vo.getName());
        assertEquals("http://old:3000", vo.getBaseUrl());
        assertEquals("basic", vo.getAuthType());
        assertEquals("******", vo.getSecretRef());
        assertEquals(90, vo.getTimeoutSeconds().intValue());
        assertEquals(Boolean.TRUE, vo.getEnabled());
        // åæ´äºä»¶å·²åï¼Worker ç¼å­å·æ°ï¼
        verify(changeEventPublisher, times(1)).publish(eq("iqd.config.changed"), anyString());
    }

    // ------------------------------------------------------------ æ¹åæå¯ä¸çº¦æ â 40900ï¼åæ¥åæ¥ï¼

    @Test
    void updateConnection_renameConflict_throws409_andDoesNotSave() {
        IqdConnection c = existingConnection(CONN_ID, "A");
        when(connectionRepository.findById(CONN_ID)).thenReturn(Optional.of(c));
        when(connectionRepository.existsByName("B")).thenReturn(true); // B å·²è¢«å ç¨

        IqdConnectionUpdateRequest dto = new IqdConnectionUpdateRequest();
        dto.setName("B");

        BusinessException ex = assertThrows(BusinessException.class,
                () -> service.updateConnection(CONN_ID, dto));

        assertEquals(40900, ex.getCode());
        @SuppressWarnings("unchecked")
        Map<String, Object> data = (Map<String, Object>) ex.getData();
        assertNotNull(data);
        assertEquals("B", data.get("name"));
        // åæ¥åæ¥ï¼åºä¸­åæªåãä¸è½åºãä¸åäºä»¶ï¼æ çº¦æå¼å¸¸ãæ  50000ï¼
        assertEquals("A", c.getName());
        verify(connectionRepository, never()).save(any(IqdConnection.class));
        verify(changeEventPublisher, never()).publish(anyString(), anyString());
    }

    @Test
    void updateConnection_renameToSameName_skipsUniqueCheck_andSucceeds() {
        IqdConnection c = existingConnection(CONN_ID, "A");
        stubFound(c);

        IqdConnectionUpdateRequest dto = new IqdConnectionUpdateRequest();
        dto.setName("A"); // æ¹æèªèº«åå

        IqdConnectionVO vo = service.updateConnection(CONN_ID, dto);

        assertEquals("A", vo.getName());
        // åå¼æ¹åè·³è¿å¯ä¸æ ¡éªï¼ä¸è¯¯æ¥ 40900ï¼
        verify(connectionRepository, never()).existsByName(anyString());
        verify(connectionRepository, times(1)).save(any(IqdConnection.class));
    }

    // ------------------------------------------------------------ è¿æ¥ä¸å­å¨ / id ç©º â 42200

    @Test
    void updateConnection_notFound_throws422() {
        when(connectionRepository.findById(999999L)).thenReturn(Optional.empty());

        BusinessException ex = assertThrows(BusinessException.class,
                () -> service.updateConnection(999999L, new IqdConnectionUpdateRequest()));

        assertEquals(42200, ex.getCode()); // å¯¹é½å»ºæ¨¡å°èç¹æï¼é 40400ï¼
        verify(connectionRepository, never()).save(any(IqdConnection.class));
    }

    @Test
    void updateConnection_nullId_throws422() {
        BusinessException ex = assertThrows(BusinessException.class,
                () -> service.updateConnection(null, new IqdConnectionUpdateRequest()));

        assertEquals(42200, ex.getCode());
        verify(connectionRepository, never()).save(any(IqdConnection.class));
    }

    // ------------------------------------------------------------ timeout <= 0 â 42200ï¼é¶å¯ä½ç¨ï¼

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
        assertEquals(90, c.getTimeoutSeconds().intValue()); // åå¼æªå
        verify(connectionRepository, never()).save(any(IqdConnection.class));
    }

    // ------------------------------------------------------------ secret_refï¼çç©º/å ä½ = ä¿çåå¼

    @Test
    void updateConnection_secretRefPlaceholderOrBlank_keepsOriginal() {
        IqdConnection c = existingConnection(CONN_ID, "A");
        stubFound(c);

        IqdConnectionUpdateRequest placeholder = new IqdConnectionUpdateRequest();
        placeholder.setSecretRef("******");
        service.updateConnection(CONN_ID, placeholder);
        assertEquals("sec-old", c.getSecretRef(), "å ä½ç¬¦ ****** å¿é¡»ä¿çåå¼");

        IqdConnectionUpdateRequest blank = new IqdConnectionUpdateRequest();
        blank.setSecretRef("   ");
        service.updateConnection(CONN_ID, blank);
        assertEquals("sec-old", c.getSecretRef(), "ç©ºç½å¿é¡»ä¿çåå¼");
    }

    @Test
    void updateConnection_secretRefNonBlank_updates() {
        IqdConnection c = existingConnection(CONN_ID, "A");
        stubFound(c);

        IqdConnectionUpdateRequest dto = new IqdConnectionUpdateRequest();
        dto.setSecretRef("sec-new");

        IqdConnectionVO vo = service.updateConnection(CONN_ID, dto);

        assertEquals("sec-new", c.getSecretRef());
        // ååºä»æåå ä½ç¬¦ï¼ä¸æ³é²æå¼
        assertEquals("******", vo.getSecretRef());
    }

    // ------------------------------------------------------------ enabled åªåæ¬è¡ï¼ä¸èå¨å¶å®è¿æ¥ï¼

    @Test
    void updateConnection_enable_togglesOnlyTargetRow_noCrossLink() {
        IqdConnection a = existingConnection(1L, "A"); // å·² enabled
        IqdConnection b = existingConnection(2L, "B");
        b.setEnabled(0); // B å½ååç¨
        when(connectionRepository.findById(2L)).thenReturn(Optional.of(b));
        when(connectionRepository.save(any(IqdConnection.class))).thenAnswer(inv -> inv.getArgument(0));

        IqdConnectionUpdateRequest dto = new IqdConnectionUpdateRequest();
        dto.setEnabled(true);

        IqdConnectionVO vo = service.updateConnection(2L, dto);

        assertEquals(1, b.getEnabled().intValue());          // ç®æ è¡å·²å¯ç¨
        assertEquals(1, a.getEnabled().intValue());          // å¦ä¸è¿æ¥ä¸åå½±åï¼æ èªå¨åç¨ï¼
        assertEquals(Boolean.TRUE, vo.getEnabled());
        // ä»åç®æ è¡ï¼save æ°ä¸æ¬¡ï¼ä¸ä¿å­çæ¯ B
        ArgumentCaptor<IqdConnection> captor = ArgumentCaptor.forClass(IqdConnection.class);
        verify(connectionRepository, times(1)).save(captor.capture());
        assertEquals(2L, captor.getValue().getId());
    }

    // ------------------------------------------------------------ ä¸»è¿æ¥è¿ç§»æ¥å¿ï¼Â§14.5.1 Aï¼

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
                "æ¹åç¦»å¼ default å¿é¡»æ 'primary migrated by rename' ç»æåæ¥å¿");
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
                "æ¹åå ç¨ default å¿é¡»æ 'primary claimed by rename' ç»æåæ¥å¿");
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
                "é default ä¹é´çæ¹åä¸å¾æä¸»è¿æ¥è¿ç§»æ¥å¿");
    }

    // ------------------------------------------------------------ è¾å©ï¼logback æ¥å¿æè·

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
