package com.mis.iqd.domain.service;

import com.mis.iqd.domain.repository.IqdModelLayoutRepository;
import org.springframework.stereotype.Service;

import java.util.Map;

/**
 * 建模台画布布局服务（v1.11 MR-S4 / 系统设计 §4.4 d 点）。
 *
 * <p><b>存储</b>：连接级单份 JSONB（{@code iqd_model_layout}，Q6 独立存储、不动 V71 表结构、
 * 不参与 MDL 派生）。空布局约定返回
 * {@code {nodes:[],edges:[],viewport:{x:0,y:0,zoom:1},auto_layout_version:0}}。
 *
 * <p><b>权限</b>：{@code get} 需 {@code iqd:modeling:view}；{@code save} / {@code autoLayout}
 * 需 {@code iqd:modeling:edit}（A-11：拖拽坐标即写库，与节点编辑同语义）。
 *
 * <p><b>并发 / 体积</b>：{@code save} 以 {@code baseVersion} 做乐观并发（不符 → 40900）；
 * 布局体积上限 1MB（超限 → 42200）。
 *
 * <p><b>A-02 备注</b>：dagre 默认在**前端**跑（布局计算 &lt; 2s / 200 节点），本服务的
 * {@code autoLayout} 端点作为「服务端整库重排」备选（不默认使用）。若架构师最终裁决
 * 后端不实现，可改为返回 501 —— 届时请同步更新 V87 的 sys_api/sys_menu_api 种子。
 *
 * <p><b>T01 骨架状态</b>：方法体一律 {@code throw new UnsupportedOperationException("T03 实现")}，
 * <b>不含任何业务逻辑</b>（布局持久化在 T03 = M2 建模全量落地）。
 *
 * <p>返回类型用 {@code Map<String, Object>}（snake_case wire）而非独立 DTO：
 * 布局是**纯视图数据**、结构随前端画布库演进，且 T01 不引入额外 DTO 类；
 * 若 T03 需要强类型，可再收敛为 {@code IqdModelLayoutDTO}（系统设计 §5），不影响端点契约。
 */
@Service
public class IqdModelLayoutService {

    /** 布局仓储：{@code iqd_model_layout}（连接级唯一）。 */
    private final IqdModelLayoutRepository layoutRepository;

    public IqdModelLayoutService(IqdModelLayoutRepository layoutRepository) {
        this.layoutRepository = layoutRepository;
    }

    /**
     * 取连接级布局（T03 实现）。无记录时返回空布局（见类注释约定）。
     *
     * @param connectionId 问数连接 id
     * @return {@code {connection_id, nodes, edges, viewport, auto_layout_version, version}}
     */
    public Map<String, Object> get(Long connectionId) {
        throw new UnsupportedOperationException("T03 实现");
    }

    /**
     * 保存连接级布局（T03 实现）。
     *
     * @param connectionId 问数连接 id
     * @param layout       布局 DTO（nodes/edges/viewport/auto_layout_version）
     * @param baseVersion  乐观并发基线（不符 → 40900）
     * @return 保存后的布局（version 已 +1）
     */
    public Map<String, Object> save(Long connectionId, Map<String, Object> layout, Integer baseVersion) {
        throw new UnsupportedOperationException("T03 实现");
    }

    /**
     * 一键自动布局（T03 实现）：按算法重算全部节点坐标并覆盖落库（{@code auto_layout_version} +1）。
     *
     * @param connectionId 问数连接 id
     * @param algorithm    算法与方向 {@code {algorithm:'dagre', direction:'LR'|'TB'}}
     * @return 重排后的布局
     */
    public Map<String, Object> autoLayout(Long connectionId, Map<String, Object> algorithm) {
        throw new UnsupportedOperationException("T03 实现");
    }
}
