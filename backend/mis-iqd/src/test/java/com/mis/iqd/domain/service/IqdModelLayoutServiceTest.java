package com.mis.iqd.domain.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.mis.common.core.exception.BusinessException;
import com.mis.common.core.exception.ResultCode;
import com.mis.iqd.domain.entity.IqdModelLayout;
import com.mis.iqd.domain.repository.IqdConnectionRepository;
import com.mis.iqd.domain.repository.IqdModelLayoutRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 建模台画布布局服务 Java 逻辑单测（v1.11 MR-S4 / §4.4 d 点；T03 契约守卫）。
 *
 * <p>纯 Mockito（**不加载 Spring / DB**；{@link ObjectMapper} 用真实实例，因为序列化/反序列化
 * 正是被测语义的一部分）。覆盖：
 * <ul>
 *   <li>{@code get}：无记录返回空布局约定（{@code nodes:[] / edges:[] / viewport:{0,0,1} / version:0}）；
 *       有记录时 layout_json 拆回 nodes/edges、viewport_json 拆回 viewport；连接不存在 → 404</li>
 *   <li>{@code save}：首次 insert → version=1；再次 update → version 单调 +1；
 *       {@code base_version} 不符 → 40900 + {@code data.current_version}；
 *       体积 &gt; 1MB → 42200；落库后发 {@code iqd.layout.changed}</li>
 *   <li>{@code autoLayout}：按 A-02 裁决**服务端不实现** → 抛 {@code UnsupportedOperationException}
 *       （端点层转 HTTP 501）</li>
 * </ul>
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class IqdModelLayoutServiceTest {

    @Mock IqdModelLayoutRepository layoutRepository;
    @Mock IqdConnectionRepository connectionRepository;
    @Mock IqdChangeEventPublisher changeEventPublisher;

    /** 真实 ObjectMapper：JSONB 序列化/反序列化是被测语义的一部分。 */
    private final ObjectMapper objectMapper = new ObjectMapper();

    private IqdModelLayoutService service;

    private static final long CONN_ID = 7L;

    @BeforeEach
    void setUp() {
        service = new IqdModelLayoutService(layoutRepository, connectionRepository, objectMapper, changeEventPublisher);
    }

    // ------------------------------------------------------------ get

    @Test
    void get_whenNoLayout_returnsEmptyDefaults() {
        when(connectionRepository.existsById(CONN_ID)).thenReturn(true);
        when(layoutRepository.findByConnectionId(CONN_ID)).thenReturn(Optional.empty());

        Map<String, Object> layout = service.get(CONN_ID);

        assertEquals(CONN_ID, layout.get("connection_id"));
        assertTrue(((List<?>) layout.get("nodes")).isEmpty());
        assertTrue(((List<?>) layout.get("edges")).isEmpty());
        assertEquals(0, layout.get("auto_layout_version"));
        assertEquals(0, layout.get("version"));
        @SuppressWarnings("unchecked")
        Map<String, Object> viewport = (Map<String, Object>) layout.get("viewport");
        assertEquals(1, viewport.get("zoom"));
        // 空布局只读，不落库
        verify(layoutRepository, never()).save(any(IqdModelLayout.class));
    }

    @Test
    void get_whenConnectionMissing_throws404() {
        when(connectionRepository.existsById(CONN_ID)).thenReturn(false);

        BusinessException ex = assertThrows(BusinessException.class, () -> service.get(CONN_ID));

        assertEquals(ResultCode.NOT_FOUND.getCode(), ex.getCode());
    }

    @Test
    void get_parsesStoredJsonBackToNodesEdgesViewport() throws Exception {
        when(connectionRepository.existsById(CONN_ID)).thenReturn(true);
        IqdModelLayout entity = new IqdModelLayout();
        entity.setId(1L);
        entity.setConnectionId(CONN_ID);
        entity.setLayoutJson(objectMapper.writeValueAsString(Map.of(
                "nodes", List.of(Map.of("item_key", "mdl:model:orders", "x", 10, "y", 20)),
                "edges", List.of(Map.of("id", "e1", "source", "a", "target", "b")))));
        entity.setViewportJson(objectMapper.writeValueAsString(Map.of("x", 5, "y", 6, "zoom", 1.5)));
        entity.setAutoLayoutVersion(2);
        entity.setLayoutVersion(4);
        when(layoutRepository.findByConnectionId(CONN_ID)).thenReturn(Optional.of(entity));

        Map<String, Object> layout = service.get(CONN_ID);

        assertEquals(1, ((List<?>) layout.get("nodes")).size());
        assertEquals(1, ((List<?>) layout.get("edges")).size());
        assertEquals(2, layout.get("auto_layout_version"));
        assertEquals(4, layout.get("version"));
        @SuppressWarnings("unchecked")
        Map<String, Object> viewport = (Map<String, Object>) layout.get("viewport");
        assertEquals(1.5, viewport.get("zoom"));
    }

    // ------------------------------------------------------------ save

    @Test
    void save_firstTime_insertsWithVersionOne_andPublishesLayoutChanged() {
        when(connectionRepository.existsById(CONN_ID)).thenReturn(true);
        when(layoutRepository.findByConnectionId(CONN_ID)).thenReturn(Optional.empty());
        when(layoutRepository.save(any(IqdModelLayout.class))).thenAnswer(inv -> inv.getArgument(0));

        Map<String, Object> layout = layoutPayload();

        Map<String, Object> saved = service.save(CONN_ID, layout, 0);

        assertEquals(1, saved.get("version"), "首次保存 version 应为 1");
        assertNotNull(saved.get("nodes"));
        assertEquals(1, ((List<?>) saved.get("nodes")).size());

        ArgumentCaptor<IqdModelLayout> captor = ArgumentCaptor.forClass(IqdModelLayout.class);
        verify(layoutRepository).save(captor.capture());
        IqdModelLayout entity = captor.getValue();
        assertEquals(CONN_ID, entity.getConnectionId());
        assertEquals(1, entity.getLayoutVersion());
        assertNotNull(entity.getLayoutJson());
        assertTrue(entity.getLayoutJson().contains("mdl:model:orders"));
        assertNotNull(entity.getViewportJson());
        assertNotNull(entity.getUpdatedAt());
        verify(changeEventPublisher).publish(eq("iqd.layout.changed"), anyString());
    }

    @Test
    void save_existingLayout_bumpsVersionMonotonically() {
        when(connectionRepository.existsById(CONN_ID)).thenReturn(true);
        IqdModelLayout existing = new IqdModelLayout();
        existing.setId(1L);
        existing.setConnectionId(CONN_ID);
        existing.setLayoutJson("{\"nodes\":[],\"edges\":[]}");
        existing.setAutoLayoutVersion(0);
        existing.setLayoutVersion(3);
        when(layoutRepository.findByConnectionId(CONN_ID)).thenReturn(Optional.of(existing));
        when(layoutRepository.save(any(IqdModelLayout.class))).thenAnswer(inv -> inv.getArgument(0));

        Map<String, Object> saved = service.save(CONN_ID, layoutPayload(), 3);

        assertEquals(4, saved.get("version"));
        assertEquals(4, existing.getLayoutVersion());
    }

    @Test
    void save_staleBaseVersion_throws40900_withCurrentVersion() {
        when(connectionRepository.existsById(CONN_ID)).thenReturn(true);
        IqdModelLayout existing = new IqdModelLayout();
        existing.setId(1L);
        existing.setConnectionId(CONN_ID);
        existing.setLayoutJson("{\"nodes\":[],\"edges\":[]}");
        existing.setLayoutVersion(5);
        when(layoutRepository.findByConnectionId(CONN_ID)).thenReturn(Optional.of(existing));

        BusinessException ex = assertThrows(BusinessException.class,
                () -> service.save(CONN_ID, layoutPayload(), 4));

        assertEquals(40900, ex.getCode());
        @SuppressWarnings("unchecked")
        Map<String, Object> data = (Map<String, Object>) ex.getData();
        assertEquals(5, data.get("current_version"));
        verify(layoutRepository, never()).save(any(IqdModelLayout.class));
    }

    @Test
    void save_oversizedLayout_throws42200() {
        when(connectionRepository.existsById(CONN_ID)).thenReturn(true);

        Map<String, Object> node = new LinkedHashMap<>();
        node.put("item_key", "mdl:model:huge");
        node.put("blob", "x".repeat(1_100_000));
        Map<String, Object> oversize = new LinkedHashMap<>();
        oversize.put("nodes", List.of(node));
        oversize.put("edges", new ArrayList<>());

        BusinessException ex = assertThrows(BusinessException.class,
                () -> service.save(CONN_ID, oversize, 0));

        assertEquals(42200, ex.getCode());
        verify(layoutRepository, never()).save(any(IqdModelLayout.class));
    }

    @Test
    void save_whenConnectionMissing_throws404() {
        when(connectionRepository.existsById(CONN_ID)).thenReturn(false);

        BusinessException ex = assertThrows(BusinessException.class,
                () -> service.save(CONN_ID, layoutPayload(), 0));

        assertEquals(ResultCode.NOT_FOUND.getCode(), ex.getCode());
    }

    // ------------------------------------------------------------ autoLayout（A-02：按设计不实现）

    @Test
    void autoLayout_isNotImplementedServerSide_byDesign() {
        UnsupportedOperationException ex = assertThrows(UnsupportedOperationException.class,
                () -> service.autoLayout(CONN_ID, Map.of("algorithm", "dagre", "direction", "LR")));

        assertTrue(ex.getMessage().contains("A-02"));
        assertTrue(ex.getMessage().contains("PUT /api/v1/iqd/modeling/layout/" + CONN_ID),
                "异常信息必须指明替代路径（前端算完经 PUT 落库）");
        // 不触达存储
        verify(layoutRepository, never()).save(any(IqdModelLayout.class));
    }

    // ------------------------------------------------------------ 辅助

    private static Map<String, Object> layoutPayload() {
        Map<String, Object> node = new LinkedHashMap<>();
        node.put("item_key", "mdl:model:orders");
        node.put("x", 10);
        node.put("y", 20);
        node.put("width", 240);
        node.put("height", 160);
        node.put("collapsed", false);
        Map<String, Object> edge = new LinkedHashMap<>();
        edge.put("id", "e1");
        edge.put("source", "mdl:model:orders");
        edge.put("target", "mdl:model:customers");
        Map<String, Object> viewport = new LinkedHashMap<>();
        viewport.put("x", 0);
        viewport.put("y", 0);
        viewport.put("zoom", 1);

        Map<String, Object> layout = new LinkedHashMap<>();
        layout.put("nodes", List.of(node));
        layout.put("edges", List.of(edge));
        layout.put("viewport", viewport);
        return layout;
    }
}
