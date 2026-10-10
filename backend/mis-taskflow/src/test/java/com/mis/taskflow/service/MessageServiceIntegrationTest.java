package com.mis.taskflow.service;

import com.mis.common.core.exception.BusinessException;
import com.mis.common.core.result.PageResult;
import com.mis.taskflow.domain.repository.SysMessageReceiverRepository;
import com.mis.taskflow.dto.MarkReadRequest;
import com.mis.taskflow.dto.MessageStatsVO;
import com.mis.taskflow.dto.MessageVO;
import com.mis.taskflow.dto.PublishMessageRequest;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * 消息中心集成测试（P2）—— 连接真实测试库，事务内回滚不污染数据。
 *
 * <p>启用：`MIS_DB_TEST=true` + DB_HOST/DB_USER/... 环境变量。
 */
@SpringBootTest
@Transactional
@EnabledIfEnvironmentVariable(named = "MIS_DB_TEST", matches = "true")
class MessageServiceIntegrationTest {

    private static final long TENANT = 900001L;

    @Autowired
    private MessageService messageService;

    @Autowired
    private SysMessageReceiverRepository receiverRepository;

    private long nextUser(long base) {
        return base + (System.nanoTime() % 10_000);
    }

    private Long publish(String title, List<Long> receivers) {
        return messageService.publish(TENANT, new PublishMessageRequest(
                "NOTIFY", "ANNOUNCEMENT", title, "summary-" + title, null, null,
                1L, "系统", receivers, null, null));
    }

    @Test
    @DisplayName("P2：群发消息为每个接收者生成一条明细")
    void groupPublishCreatesReceiverRows() {
        long u1 = nextUser(700001);
        long u2 = nextUser(710001);
        long u3 = nextUser(720001);

        Long msgId = publish("群发测试", List.of(u1, u2, u3));

        var rows = receiverRepository.findByMessageId(msgId);
        assertEquals(3, rows.size(), "应为 3 个接收者各生成一条明细");
        assertTrue(rows.stream().allMatch(r -> Boolean.FALSE.equals(r.getRead())), "初始应全部未读");

        var msg = messageService.detail(msgId, u1);
        assertEquals("GROUP", messageService.inbox(TENANT, u1, null, 1, 20)
                .getList().stream().filter(v -> v.id().equals(String.valueOf(msgId))).findFirst()
                .orElseThrow().receiverGroupType());
        assertEquals(3, msg.receiverUserIds().size());
    }

    @Test
    @DisplayName("P2：单发消息只生成一条明细，且 groupType=SINGLE")
    void singlePublish() {
        long u = nextUser(730001);
        Long msgId = publish("单发测试", List.of(u));

        assertEquals(1, receiverRepository.findByMessageId(msgId).size());
        MessageVO vo = messageService.inbox(TENANT, u, null, 1, 20).getList().stream()
                .filter(v -> v.id().equals(String.valueOf(msgId))).findFirst().orElseThrow();
        assertEquals("SINGLE", vo.receiverGroupType());
        assertFalse(vo.read(), "初始未读");
    }

    @Test
    @DisplayName("P2：接收者去重（重复 userId 只产生一条明细）")
    void dedupeReceivers() {
        long u = nextUser(740001);
        Long msgId = publish("去重测试", List.of(u, u, u));
        assertEquals(1, receiverRepository.findByMessageId(msgId).size(), "重复接收者应被去重");
    }

    @Test
    @DisplayName("P2：标记已读幂等，第二次调用不重复计数")
    void markReadIdempotent() {
        long u = nextUser(750001);
        Long msgId = publish("已读测试", List.of(u));

        int first = messageService.markRead(new MarkReadRequest(List.of(msgId)), u);
        assertEquals(1, first, "首次应恰好标记 1 条");
        int second = messageService.markRead(new MarkReadRequest(List.of(msgId)), u);
        assertEquals(0, second, "重复标记应为 0（幂等）");

        MessageVO vo = messageService.inbox(TENANT, u, null, 1, 20).getList().stream()
                .filter(v -> v.id().equals(String.valueOf(msgId))).findFirst().orElseThrow();
        assertTrue(vo.read(), "应显示为已读");
        assertEquals(1, vo.readCount(), "主表 read_count 应回写为 1");
    }

    @Test
    @DisplayName("P2：A 标记已读不影响 B 的未读状态")
    void readStateIsolatedPerUser() {
        long a = nextUser(760001);
        long b = nextUser(770001);
        Long msgId = publish("隔离测试", List.of(a, b));

        messageService.markRead(new MarkReadRequest(List.of(msgId)), a);

        assertTrue(messageService.inbox(TENANT, a, null, 1, 20).getList().stream()
                .filter(v -> v.id().equals(String.valueOf(msgId))).findFirst().orElseThrow().read(), "A 应已读");
        assertFalse(messageService.inbox(TENANT, b, null, 1, 20).getList().stream()
                .filter(v -> v.id().equals(String.valueOf(msgId))).findFirst().orElseThrow().read(), "B 应仍为未读");
    }

    @Test
    @DisplayName("P2：收件箱只返回我收到的消息")
    void inboxOnlyMine() {
        long mine = nextUser(780001);
        long other = nextUser(790001);
        Long toMe = publish("给我的", List.of(mine));
        publish("给别人的", List.of(other));

        List<String> ids = messageService.inbox(TENANT, mine, null, 1, 100).getList().stream()
                .map(MessageVO::id).toList();
        assertTrue(ids.contains(String.valueOf(toMe)), "应包含发给我的消息");
        assertTrue(ids.stream().noneMatch(id -> id.equals(String.valueOf(toMe + 1))), "不应包含他人消息");
    }

    @Test
    @DisplayName("P2：关键词检索命中标题与摘要")
    void searchHitsTitleAndSummary() {
        long u = nextUser(800001);
        String marker = "ZQ" + System.nanoTime();
        publish(marker + "标题命中", List.of(u));
        publish("普通标题", List.of(u)); // summary 不同

        // msgType=null ⇒ 跨类型检索（保持既有行为）
        PageResult<MessageVO> hit = messageService.search(TENANT, u, null, marker, 1, 20);
        assertTrue(hit.getTotal() >= 1, "应至少命中一条");
        assertTrue(hit.getList().stream().allMatch(v -> v.title().contains(marker)), "命中应来自该关键词");
    }

    @Test
    @DisplayName("PRD D-5/Q3：msgType 非空时只搜该类型；null 时跨类型回退")
    void searchScopedByMsgType() {
        long u = nextUser(850001);
        String marker = "ZD" + System.nanoTime();
        // 同关键词、同接收者，两种类型各一条
        messageService.publish(TENANT, new PublishMessageRequest(
                "APPROVAL", "TASK", marker + "审批类", "s", null, null, 1L, "系统", List.of(u), null, null));
        messageService.publish(TENANT, new PublishMessageRequest(
                "SYSTEM_ALERT", "SYSTEM", marker + "告警类", "s", null, null, 1L, "系统", List.of(u), null, null));

        // 限定 SYSTEM_ALERT ⇒ 只返回该类型
        PageResult<MessageVO> scoped = messageService.search(TENANT, u, "SYSTEM_ALERT", marker, 1, 20);
        assertTrue(scoped.getTotal() >= 1, "限定类型应至少命中一条");
        assertTrue(scoped.getList().stream().allMatch(v -> "SYSTEM_ALERT".equals(v.msgType())),
                "限定 msgType 后不应混入其它类型");

        // msgType=null ⇒ 跨类型，两种都能搜到（回退行为）
        PageResult<MessageVO> all = messageService.search(TENANT, u, null, marker, 1, 20);
        assertTrue(all.getList().stream().anyMatch(v -> "APPROVAL".equals(v.msgType())),
                "跨类型检索应包含 APPROVAL");
        assertTrue(all.getList().stream().anyMatch(v -> "SYSTEM_ALERT".equals(v.msgType())),
                "跨类型检索应包含 SYSTEM_ALERT");
    }

    @Test
    @DisplayName("P2：角标统计未读数正确")
    void statsUnread() {
        long u = nextUser(810001);
        Long m1 = publish("统计A", List.of(u));
        publish("统计B", List.of(u));

        MessageStatsVO before = messageService.stats(TENANT, u);
        assertTrue(before.unread() >= 2, "未读数应 >= 2");
        assertTrue(before.total() >= before.unread(), "总数应 >= 未读数");

        messageService.markRead(new MarkReadRequest(List.of(m1)), u);
        MessageStatsVO after = messageService.stats(TENANT, u);
        assertEquals(before.unread() - 1, after.unread(), "标记 1 条后未读应减 1");
    }

    @Test
    @DisplayName("P2：非接收者查看详情被拒绝")
    void nonReceiverForbidden() {
        long owner = nextUser(820001);
        long outsider = nextUser(830001);
        Long msgId = publish("隐私测试", List.of(owner));
        assertThrows(BusinessException.class, () -> messageService.detail(msgId, outsider));
    }

    @Test
    @DisplayName("P2：空接收者发布被拒绝")
    void emptyReceiversRejected() {
        assertThrows(BusinessException.class, () -> messageService.publish(TENANT,
                new PublishMessageRequest("NOTIFY", "ANNOUNCEMENT", "空", null, null, null, 1L, "x", List.of(), null, null)));
    }
}