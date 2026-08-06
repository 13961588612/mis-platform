package com.mis.adminbff.dto.agentops;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.List;

/**
 * 配置文件树节点（§4.3 #22，对应前端 {@code types.ts:ConfigFileNode}）。
 *
 * <h2>{@code editable} 由服务端下发，不由前端推断</h2>
 * 白名单（impl-plan §4.4）决定哪些文件可编辑。前端<b>可以</b>按扩展名自己猜，
 * 但猜错的方向是危险的：把不可编辑的文件渲染成可编辑，用户改了、点保存，
 * 服务端拒绝——白白丢失一次编辑。更糟的是白名单调整时前端逻辑不会跟着变。
 * 服务端下发是唯一能保证「显示的可编辑性 == 实际的可编辑性」的做法。
 *
 * @param path      相对 agent 工作目录的路径，也是 #23/#24 的定位键
 * @param name      文件 / 目录名
 * @param type      {@code dir} | {@code file}
 * @param format    {@code yaml} | {@code markdown}
 * @param editable  是否允许编辑（白名单结果）
 * @param size      字节数，目录为 0
 * @param updatedAt 最后修改时间
 * @param children  子节点，{@code type=file} 时为 null
 */
public record AgentConfigFileNodeVO(
        @JsonProperty("path") String path,
        @JsonProperty("name") String name,
        @JsonProperty("type") String type,
        @JsonProperty("format") String format,
        @JsonProperty("editable") Boolean editable,
        @JsonProperty("size") Long size,
        @JsonProperty("updated_at") String updatedAt,
        @JsonProperty("children") List<AgentConfigFileNodeVO> children) {

    /** 目录节点。 */
    public static final String TYPE_DIR = "dir";

    /** 文件节点。 */
    public static final String TYPE_FILE = "file";

    /** @return 是否为目录节点 */
    public boolean isDirectory() {
        return TYPE_DIR.equals(type);
    }
}
