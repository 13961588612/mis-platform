package com.mis.recon.custom;

import java.util.List;
import java.util.Map;

/**
 * 自定义取数扩展点（第四批 P7，取数层需求规格 §4.2，方案设计 §13 五个扩展点之一）。
 * <p>非 db/api 数据源（文件、加密接口、特殊分页、内部中间件等）的自定义拉取实现。</p>
 * <ul>
 *   <li>入参：{@link FetchContext}（时间窗口 + config_json 参数 Map + 连接信息，可空）；</li>
 *   <li>出参：行集 {@code List<Map<String,Object>>}，<b>字段名须与数据源 fields_json 声明的源字段一致</b>
 *       （record_key / time_field / 映射均由框架按 fields_json 处理，实现类不感知）；</li>
 *   <li>窗口 / 分页 / 重试由实现类自理：框架只传窗口边界，实现类必须按窗口圈定取数范围
 *       （全量型数据源可声明忽略窗口，配置时显式标注，取数层需求规格 §4.5/R12）。</li>
 * </ul>
 * <p>加载复用 {@code CustomLoader}：Spring 容器按类型优先（可注入 DataSource/RestTemplate 等依赖）→
 * 反射无参构造兜底；保存校验 = 类可加载 + 实现本接口。</p>
 */
public interface CustomFetcher {

    /**
     * 按窗口拉取行集。
     *
     * @param ctx 窗口边界 + config_json 参数（除 class 外键值原样）+ 连接信息
     * @return 行集；字段名与数据源 fields_json 源字段一致（可返回空列表，禁止返回 null）
     */
    List<Map<String, Object>> fetch(FetchContext ctx);
}
