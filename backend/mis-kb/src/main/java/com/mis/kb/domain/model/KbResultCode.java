package com.mis.kb.domain.model;

import com.mis.common.core.exception.ResultCode;

/**
 * 知识库模块业务响应码（段位避开 {@link ResultCode} 既有值）。
 *
 * <p>约定：{@code 4092x} 冲突类；{@code 4041x} 资源不存在；{@code 4031x} 权限不足。
 * Service 抛 {@code BusinessException(KbResultCode.xxx)}，Controller 经统一异常处理返回 {@code Result.fail}。
 */
public enum KbResultCode {

    KB_LIBRARY_NAME_EXISTS(40920, "知识库名称已存在"),
    KB_CATEGORY_HAS_CHILDREN(40921, "分类下存在子分类或知识库，无法删除"),
    KB_ACL_EXISTS(40922, "该授权已存在"),
    KB_FEEDBACK_ALREADY(40923, "反馈已提交，不可重复修改"),
    /** A-02c 工单状态机非法流转（如 closed → processing）。 */
    KB_TICKET_STATUS_ILLEGAL(40924, "工单状态流转非法"),
    /** F-06 RAG 参数取值越界或码值非法。 */
    KB_RAG_SETTINGS_INVALID(40925, "RAG 参数配置非法"),
    /** A-02e 导出条数超出上限，需缩小筛选范围。 */
    KB_EXPORT_TOO_LARGE(40926, "导出数据量超出上限，请缩小筛选范围"),
    /**
     * WD-01 术语（含别名）与既有词冲突。
     *
     * <p><b>停用的组仍占用唯一性</b>（Q3 裁决，{@code uk_synonym_term_norm} 不带 status 条件），
     * 故 message 必须点明这一点，否则用户会困惑「我明明已经停用了那个组」。
     * 抛出时 {@code data} 需带 {@code {term, ownerGroupId, ownerCanonicalTerm}} 三样，
     * 缺一样前端就拼不出 PRD §4.3 那句「第 27 行「OKR」已属于术语组「关键结果法」」。
     */
    KB_SYNONYM_TERM_CONFLICT(40927, "该术语已被其他术语组占用（已停用的术语组同样占用）"),
    /** WD-04 导入文件格式非法（表头缺失 / JSON 语法错 / 编码不可识别）。 */
    KB_SYNONYM_IMPORT_FORMAT_INVALID(40928, "导入文件格式非法"),
    /** WD-04 导入超限：术语组数超 importMaxGroups 或文件字节数超 importMaxBytes，message 中区分。 */
    KB_SYNONYM_IMPORT_TOO_LARGE(40929, "导入内容超出上限"),
    /** WD-04 提交时词表版本已变（Q10 硬约束），必须重新预检，不允许静默多跳几行。 */
    KB_SYNONYM_IMPORT_STALE(40930, "词表已变更，请重新预检"),
    /** WD-04 预检令牌不存在或已过期。 */
    KB_SYNONYM_IMPORT_TOKEN_INVALID(40931, "导入预检令牌不存在或已过期，请重新预检"),
    /** 分类节点管理员：同节点同主体重复授权（知识库域一期，T01）。 */
    KB_CATEGORY_ADMIN_EXISTS(40932, "该分类节点已授权给该主体，请勿重复授权"),
    /** 移动分类节点：目标节点是自己的后代（防环，知识库域一期，T01）。 */
    KB_CATEGORY_MOVE_CYCLE(40933, "不能把分类移动到其自身或后代节点下"),
    /**
     * 物理删除被拒：当前引擎版本不支持在线删除 dataset（Q5，配置项 {@code delete-supported=false}）。
     *
     * <p>抛出时**本地零变更**——不能出现「引擎删不掉但 MIS 行没了」的悬空引用。
     * 前端应引导用户改走归档（{@code DELETE ?mode=archive}）。
     */
    KB_ENGINE_DELETE_UNSUPPORTED(40934, "当前引擎不支持在线删除知识库，请改用归档"),
    /**
     * 物理删除时引擎侧删除调用失败。
     *
     * <p>必须让 {@code @Transactional} 回滚，禁止 catch 后继续删本地
     * （那正是本次要消灭的「吞异常假成功」）。
     */
    KB_ENGINE_DELETE_FAILED(40935, "引擎侧删除失败，本地未做任何变更"),

    KB_LIBRARY_NOT_FOUND(40410, "知识库不存在"),
    KB_DOC_NOT_FOUND(40411, "文档不存在"),
    KB_CATEGORY_NOT_FOUND(40412, "分类不存在"),
    KB_SESSION_NOT_FOUND(40413, "问答会话不存在"),
    /** A-02c 工单不存在。 */
    KB_TICKET_NOT_FOUND(40414, "工单不存在"),
    /** WD-02 同义词术语组不存在。 */
    KB_SYNONYM_GROUP_NOT_FOUND(40415, "术语组不存在"),

    KB_NO_READ_PERMISSION(40310, "无该知识库的读取权限"),
    /** 该节点不在您的管理范围内（节点管辖判定，知识库域一期，T01）。 */
    KB_CATEGORY_NOT_MANAGEABLE(40311, "该节点不在您的管理范围内"),
    /** 移动目标位置不在您的管理范围内（知识库域一期，T01）。 */
    KB_CATEGORY_MOVE_OUT_OF_SCOPE(40312, "目标位置不在您的管理范围内");

    private final int code;
    private final String message;

    KbResultCode(int code, String message) {
        this.code = code;
        this.message = message;
    }

    public int getCode() {
        return code;
    }

    public String getMessage() {
        return message;
    }
}
