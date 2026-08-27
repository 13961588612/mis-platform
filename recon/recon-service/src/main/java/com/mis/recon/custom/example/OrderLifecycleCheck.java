package com.mis.recon.custom.example;

import com.mis.recon.custom.CustomCheckContext;
import com.mis.recon.custom.CustomCheckExecutor;
import com.mis.recon.custom.CustomDiff;
import com.mis.recon.domain.runtime.LedgerRow;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * 内置示例：订单状态流整检查（strategy=custom_check，CustomCheckExecutor 参考实现）。
 *
 * <h3>适用场景</h3>
 * 对整张台账做"整体性"校验（非两两匹配）：如订单状态是否合法、状态流转是否在白名单内。
 * 本示例演示最简整检查：校验各数据集订单行的 record_data.status 是否属于合法状态集合；
 * 真实业务可在此基础上扩展：按 record_key 归并同一订单的多条记录，校验状态时序流转是否合法。
 *
 * <h3>参数（config_json 除 class 外键值原样传入）</h3>
 * <ul>
 *   <li>{@code status_flow}（可选，String）：合法状态白名单。多条用 {@code ;} 分隔、
 *       流转用 {@code ->} 连接，如 {@code "PAID->REFUNDED;CLOSED"} 表示允许状态集合
 *       {PAID, REFUNDED, CLOSED}；未配置 → 跳过校验（功能降级，无差异产出）。</li>
 *   <li>{@code notify_channel}（可选，String）：通知渠道，仅随差异描述展示，不参与判定。</li>
 * </ul>
 *
 * <h3>示例配置</h3>
 * <pre>{@code
 * {
 *   "class": "com.mis.recon.custom.example.OrderLifecycleCheck",
 *   "status_flow": "PAID->REFUNDED;CLOSED",
 *   "notify_channel": "dingtalk"
 * }
 * }</pre>
 *
 * <h3>运行语义（演示简化）</h3>
 * <ul>
 *   <li>输入：{@link CustomCheckContext}（scenarioCode / checkName / dataset / params）；多数据集 1~N 个，无左右角色</li>
 *   <li>遍历全部数据集订单行：record_data.status 在合法集合内或缺失 → 跳过；
 *       未知状态 → 产出 {@link CustomDiff}（身份=record_key、直接 confirmed，由实现类决定）</li>
 *   <li>差异直接 confirmed：diff_type=custom_check、pair_segment=-、锚点不写，
 *       现场数据经 left_data_json 展示</li>
 * </ul>
 * 输出：{@code List<CustomDiff>}（空列表 = 通过；实现类未给身份的行会被跳过）。
 *
 * <h3>诊断说明</h3>
 * 本示例未附带诊断上下文（custom_context 缺省 → 空诊断，功能降级可用）；
 * 差异描述（diffDesc）已含未知状态与允许集合，可通过诊断面板直接查看。
 *
 * <h3>注意事项</h3>
 * <ul>
 *   <li>差异身份由实现类决定：matchKeyHash 取 record_key，需保证唯一且稳定（真实场景用稳定 hash）</li>
 *   <li>位于 example 子包，配置须写<b>全限定类名</b>（简名补全仅对契约包生效）</li>
 *   <li>注册为 Spring 组件：优先从容器获取（可注入依赖），容器无则反射无参构造兜底</li>
 * </ul>
 */
@Component
public class OrderLifecycleCheck implements CustomCheckExecutor {

    @Override
    public List<CustomDiff> execute(CustomCheckContext ctx) {
        Map<String, Object> params = ctx.getParams();
        String flow = params == null ? null : params.get("status_flow") == null
                ? null : String.valueOf(params.get("status_flow"));
        String channel = params == null ? null : params.get("notify_channel") == null
                ? null : String.valueOf(params.get("notify_channel"));

        Set<String> allowed = new HashSet<>();
        if (flow != null && !flow.isBlank()) {
            for (String seg : flow.split(";")) {
                for (String st : seg.split("->")) {
                    String s = st.trim();
                    if (!s.isEmpty()) {
                        allowed.add(s);
                    }
                }
            }
        }

        List<CustomDiff> diffs = new ArrayList<>();
        for (Map.Entry<String, List<LedgerRow>> e : ctx.getDataset().entrySet()) {
            for (LedgerRow row : e.getValue()) {
                String status = row.getRecordData() == null ? null : row.getRecordData().path("status").asText(null);
                if (status == null || allowed.isEmpty() || allowed.contains(status)) {
                    continue;
                }
                diffs.add(CustomDiff.builder()
                        .matchKeyHash(row.getRecordKey())
                        .matchKeyDisplay(row.getRecordKey())
                        .diffDesc("订单状态非法：" + status + "（允许：" + String.join(" / ", allowed) + "）"
                                + (channel != null ? "；通知渠道：" + channel : ""))
                        .leftDataJson(row.getRecordData() == null ? null : row.getRecordData().toString())
                        .build());
            }
        }
        return diffs;
    }
}
