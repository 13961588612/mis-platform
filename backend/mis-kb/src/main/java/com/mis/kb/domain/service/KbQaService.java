package com.mis.kb.domain.service;

import com.mis.common.core.exception.BusinessException;
import com.mis.common.core.exception.ResultCode;
import com.mis.kb.api.dto.AclSummaryVO;
import com.mis.kb.api.dto.KbQaFeedbackVO;
import com.mis.kb.api.dto.KbQaSessionDetailVO;
import com.mis.kb.api.dto.KbQaSessionVO;
import com.mis.kb.api.dto.QaCitationBatchRequest;
import com.mis.kb.api.dto.QaCitationItem;
import com.mis.kb.api.dto.QaCitationVO;
import com.mis.kb.api.dto.QaFeedbackRequest;
import com.mis.kb.api.dto.QaMessageCreateRequest;
import com.mis.kb.api.dto.QaMessageVO;
import com.mis.kb.api.dto.QaSessionCreateRequest;
import com.mis.kb.api.dto.RecallParamsVO;
import com.mis.kb.api.dto.VisibilityVO;
import com.mis.kb.domain.entity.KbAcl;
import com.mis.kb.domain.entity.KbLibrary;
import com.mis.kb.domain.entity.KbQaCitation;
import com.mis.kb.domain.entity.KbQaFeedback;
import com.mis.kb.domain.entity.KbQaMessage;
import com.mis.kb.domain.entity.KbQaSession;
import com.mis.kb.domain.model.KbResultCode;
import com.mis.kb.domain.model.QaRole;
import com.mis.kb.domain.model.RagSettings;
import com.mis.kb.domain.model.Secrecy;
import com.mis.kb.domain.repository.KbAclRepository;
import com.mis.kb.domain.repository.KbLibraryRepository;
import com.mis.kb.domain.repository.KbQaCitationRepository;
import com.mis.kb.domain.repository.KbQaFeedbackRepository;
import com.mis.kb.domain.repository.KbQaMessageRepository;
import com.mis.kb.domain.repository.KbQaSessionRepository;
import com.mis.kb.support.IdGenerator;
import com.mis.kb.support.KbBusinessException;
import com.mis.kb.support.KbJson;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

/**
 * 问答会话/消息/引用/反馈落库服务（A-02 / A-02a）。
 *
 * <p>写入责任划分：会话、消息、引用由 <b>mis-rag</b> 经内部 API 触发；反馈由 <b>前端 → BFF</b> 触发。
 * 反馈遵循 {@code editable_once} 语义：首次提交后仅允许再修改一次，之后置 0 并拒绝写入。
 * 所有跨用户读取一律做归属校验，防止越权查看他人会话。
 */
@Service
public class KbQaService {

    private static final Logger log = LoggerFactory.getLogger(KbQaService.class);

    private final KbQaSessionRepository sessionRepository;
    private final KbQaMessageRepository messageRepository;
    private final KbQaCitationRepository citationRepository;
    private final KbQaFeedbackRepository feedbackRepository;
    private final KbLibraryRepository libraryRepository;
    private final KbAclRepository aclRepository;

    public KbQaService(
            KbQaSessionRepository sessionRepository,
            KbQaMessageRepository messageRepository,
            KbQaCitationRepository citationRepository,
            KbQaFeedbackRepository feedbackRepository,
            KbLibraryRepository libraryRepository,
            KbAclRepository aclRepository) {
        this.sessionRepository = sessionRepository;
        this.messageRepository = messageRepository;
        this.citationRepository = citationRepository;
        this.feedbackRepository = feedbackRepository;
        this.libraryRepository = libraryRepository;
        this.aclRepository = aclRepository;
    }

    // ---------------------------------------------------------------- 写入（mis-rag）

    /**
     * 创建问答会话，返回新会话 id。
     *
     * <p><b>归属以透传身份为准：</b>请求体里的 {@code userId} 来自 mis-rag 转发，
     * 最终源头仍是用户可控输入；只要能解析出 {@code actingUserId}（{@code X-User-Id} 头），
     * 就以它覆盖，防止把会话挂到他人名下造成历史/运营数据污染。
     *
     * @param req          会话创建请求
     * @param actingUserId 实际发起用户；{@code null} 时回退用请求体的 {@code userId}
     */
    @Transactional
    public Long createSession(QaSessionCreateRequest req, Long actingUserId) {
        Long owner = actingUserId != null ? actingUserId : req.userId();
        if (actingUserId != null && !actingUserId.equals(req.userId())) {
            log.warn("问答会话归属被纠正 claimed={} acting={}", req.userId(), actingUserId);
        }
        KbQaSession entity = new KbQaSession();
        entity.setId(IdGenerator.nextId());
        entity.setUserId(owner);
        entity.setAppId(req.appId());
        entity.setTitle(truncateTitle(req.title()));
        entity.setCreatedAt(Instant.now());
        KbQaSession saved = sessionRepository.save(entity);
        log.debug("问答会话已创建 sessionId={} userId={}", saved.getId(), saved.getUserId());
        return saved.getId();
    }

    /**
     * 标题截断（VARCHAR(255) 上限防御）。
     *
     * <p>mis-rag 侧新建时已按 30 字符截断，此处再做一次 255 上限兜底，
     * 防止任何上游直接调用本端点时携带超长标题触发 DB 写入失败。
     */
    private String truncateTitle(String title) {
        if (title == null) {
            return null;
        }
        if (title.length() > 255) {
            return title.substring(0, 255);
        }
        return title;
    }

    /**
     * 追加一条问答消息（role ∈ user/assistant），返回新消息 id。
     *
     * <p><b>越权防护：</b>{@code sessionId} 由前端经 BFF → mis-rag 透传（续聊场景），
     * 属用户可控输入，因此必须校验会话归属，否则可向他人会话注入消息并污染运营看板。
     *
     * @param req           消息创建请求
     * @param actingUserId  实际发起用户（由 {@code X-User-Id} 透传头解析）；
     *                      为 {@code null} 表示无用户身份的纯内部调用，跳过归属校验
     */
    @Transactional
    public Long appendMessage(QaMessageCreateRequest req, Long actingUserId) {
        if (!QaRole.isValid(req.role())) {
            throw new BusinessException(ResultCode.VALIDATION_ERROR, "消息角色非法（应为 user/assistant）");
        }
        requireOwnedSession(req.sessionId(), actingUserId);
        KbQaMessage entity = new KbQaMessage();
        entity.setId(IdGenerator.nextId());
        entity.setSessionId(req.sessionId());
        entity.setRole(req.role());
        entity.setContent(req.content());
        entity.setCreatedAt(Instant.now());
        return messageRepository.save(entity).getId();
    }

    /**
     * 批量落库某条消息的引用（仅存 MIS 业务 id），返回写入条数。
     *
     * <p>同样校验目标消息所属会话的归属，避免借 {@code messageId} 向他人会话挂引用。
     *
     * @param req          引用批量请求
     * @param actingUserId 实际发起用户；{@code null} 时跳过归属校验
     */
    @Transactional
    public int saveCitations(QaCitationBatchRequest req, Long actingUserId) {
        KbQaMessage message = messageRepository.findById(req.messageId())
                .orElseThrow(() -> new BusinessException(ResultCode.NOT_FOUND, "问答消息不存在"));
        requireOwnedSession(message.getSessionId(), actingUserId);
        List<QaCitationItem> items = req.citations() == null ? List.of() : req.citations();
        if (items.isEmpty()) {
            return 0;
        }
        Instant now = Instant.now();
        List<KbQaCitation> entities = new ArrayList<>(items.size());
        for (QaCitationItem item : items) {
            KbQaCitation entity = new KbQaCitation();
            entity.setId(IdGenerator.nextId());
            entity.setMessageId(message.getId());
            entity.setLibraryId(item.libraryId());
            entity.setDocumentId(item.documentId());
            entity.setChunkText(item.chunkText());
            entity.setScore(item.score());
            // F-04：溯源定位信息，引擎给不出时为 null，不阻断落库
            entity.setChunkOffset(item.offset());
            entity.setPageNo(item.page());
            entity.setSource(item.source());
            entity.setCreatedAt(now);
            entities.add(entity);
        }
        citationRepository.saveAll(entities);
        return entities.size();
    }

    // ---------------------------------------------------------------- 读取（BFF / 运营）

    /** 我的问答历史（按会话倒序，过滤软删除）。 */
    @Transactional(readOnly = true)
    public List<KbQaSessionVO> listMySessions(Long userId) {
        if (userId == null) {
            return List.of();
        }
        return sessionRepository.findByUserIdAndDeletedAtIsNullOrderByIdDesc(userId).stream()
                .map(KbQaService::toSessionVo)
                .toList();
    }

    /**
     * 删除问答会话（用户侧软删除）。
     *
     * <p><b>软删除语义：</b>仅置 {@code deleted_at} 时间戳，不物理删除任何行；
     * 运营侧统计/列表/导出保留全量。用户侧 {@link #listMySessions} 不再展示。
     *
     * <p><b>幂等：</b>对已软删的会话重复删除同样成功（再次刷新 {@code deleted_at}），
     * 便于前端「删除后列表刷新 + 重复点击」等场景零副作用。
     *
     * @param sessionId    会话 id
     * @param actingUserId 实际发起用户；为 {@code null} 时跳过归属校验（内部调用）
     * @throws KbBusinessException 会话不存在（{@code KB_SESSION_NOT_FOUND}）或非本人（统一按不存在处理）
     */
    @Transactional
    public void deleteSession(Long sessionId, Long actingUserId) {
        KbQaSession session = requireOwnedSession(sessionId, actingUserId);
        // requireOwnedSession 按 id+userId 查（不按软删过滤），已删会话可重复删；
        // 此处再置一次时间即幂等成功。
        session.setDeletedAt(Instant.now());
        sessionRepository.save(session);
        log.info("问答会话已软删除 sessionId={} userId={}", sessionId, session.getUserId());
    }

    /**
     * 会话详情（消息 + 引用 + 反馈）。
     *
     * @param sessionId 会话 id
     * @param userId    当前用户 id；非空时做归属校验，越权抛 {@code KB_SESSION_NOT_FOUND}
     */
    @Transactional(readOnly = true)
    public KbQaSessionDetailVO getSessionDetail(Long sessionId, Long userId) {
        KbQaSession session = requireSession(sessionId);
        if (userId != null && !userId.equals(session.getUserId())) {
            // 不泄露他人会话的存在性，统一按“不存在”处理
            throw new KbBusinessException(KbResultCode.KB_SESSION_NOT_FOUND);
        }
        List<KbQaMessage> messages = messageRepository.findBySessionIdOrderByIdAsc(sessionId);
        Map<Long, List<QaCitationVO>> citationsByMessage = loadCitations(messages);
        List<QaMessageVO> messageVos = messages.stream()
                .map(m -> new QaMessageVO(
                        m.getId(), m.getRole(), m.getContent(), m.getCreatedAt(),
                        citationsByMessage.getOrDefault(m.getId(), List.of())))
                .toList();
        KbQaFeedbackVO feedbackVo = feedbackRepository.findBySessionId(sessionId)
                .map(KbQaService::toFeedbackVo)
                .orElse(null);
        return new KbQaSessionDetailVO(toSessionVo(session), messageVos, feedbackVo);
    }

    /**
     * 运营视角：会话详情（A-02a）。
     *
     * <p>与 {@link #getSessionDetail} 的差别有两点，都是刻意为之：
     * <ul>
     *   <li><b>不做归属校验</b>——运营就是要看所有人的会话；权限在端点层由运营角色控制。</li>
     *   <li><b>额外返回 {@code visibility} 与 {@code recallParams}</b>——排障需要知道
     *       「这次命中的库是什么密级、授权给了谁、用什么参数召回的」。</li>
     * </ul>
     *
     * @param sessionId 会话 id
     * @return 含运营专属字段的会话详情
     */
    @Transactional(readOnly = true)
    public KbQaSessionDetailVO getSessionDetailForOperations(Long sessionId) {
        KbQaSessionDetailVO base = getSessionDetail(sessionId, null);
        // 取本会话所有引用涉及的知识库；多库命中时以「第一个」的设置作为召回参数展示口径
        List<Long> libraryIds = base.messages().stream()
                .flatMap(m -> m.citations().stream())
                .map(QaCitationVO::libraryId)
                .filter(java.util.Objects::nonNull)
                .distinct()
                .toList();
        VisibilityVO visibility = visibilitySnapshot(libraryIds);
        RecallParamsVO recallParams = recallSnapshot(libraryIds);
        return new KbQaSessionDetailVO(
                base.session(), base.messages(), base.feedback(), visibility, recallParams);
    }

    /**
     * 汇总命中库的可见范围（密级 + ACL 摘要）。
     *
     * <p>多库命中时密级取<b>最严</b>的一个（confidential &gt; secret &gt; internal &gt; public），
     * 因为运营关心的是「这次回答里最敏感的内容是什么级别」，取最宽会低估风险。
     */
    private VisibilityVO visibilitySnapshot(List<Long> libraryIds) {
        if (libraryIds.isEmpty()) {
            return VisibilityVO.empty();
        }
        String strictest = null;
        int strictestRank = -1;
        List<AclSummaryVO> acls = new ArrayList<>();
        for (Long libId : libraryIds) {
            KbLibrary lib = libraryRepository.findById(libId).orElse(null);
            if (lib == null) {
                continue;
            }
            int rank = secrecyRank(lib.getSecrecy());
            if (rank > strictestRank) {
                strictestRank = rank;
                strictest = lib.getSecrecy();
            }
            for (KbAcl acl : aclRepository.findByLibraryId(libId)) {
                acls.add(new AclSummaryVO(acl.getSubjectType(), acl.getSubjectId(), acl.getAction()));
            }
        }
        return new VisibilityVO(strictest, acls);
    }

    /** 密级严格程度排序（数值越大越严）。 */
    private static int secrecyRank(String secrecy) {
        if (Secrecy.CONFIDENTIAL.code().equals(secrecy)) {
            return 3;
        }
        if (Secrecy.SECRET.code().equals(secrecy)) {
            return 2;
        }
        if (Secrecy.INTERNAL.code().equals(secrecy)) {
            return 1;
        }
        return 0;
    }

    /**
     * 召回参数快照。
     *
     * <p><b>口径说明：</b>P1 未按会话持久化参数快照，这里取<b>首个命中库当前生效的设置</b>作为近似。
     * 若期间管理员改过参数，展示的是改后的值。要精确回溯需在 {@code kb_qa_message}
     * 增加 {@code recall_params_json} 快照列，属 P2 范畴，已在 {@link RecallParamsVO} 记录。
     */
    private RecallParamsVO recallSnapshot(List<Long> libraryIds) {
        if (libraryIds.isEmpty()) {
            return RecallParamsVO.from(null);
        }
        KbLibrary lib = libraryRepository.findById(libraryIds.get(0)).orElse(null);
        RagSettings settings = lib == null ? null : KbJson.readSettings(lib.getRagSettingsJson());
        return RecallParamsVO.from(settings);
    }

    /** 运营视角：全量会话列表（只读，不做归属过滤）。 */
    @Transactional(readOnly = true)
    public List<KbQaSessionVO> listAllSessions() {
        return sessionRepository.findAll().stream()
                .sorted((a, b) -> Long.compare(b.getId(), a.getId()))
                .map(KbQaService::toSessionVo)
                .toList();
    }

    /** 运营视角：全量反馈列表（只读）。 */
    @Transactional(readOnly = true)
    public List<KbQaFeedbackVO> listAllFeedback() {
        return feedbackRepository.findAll().stream()
                .map(KbQaService::toFeedbackVo)
                .toList();
    }

    // ---------------------------------------------------------------- 反馈（前端 → BFF）

    /**
     * 提交或修改问答反馈。
     *
     * <p>首次提交创建记录并置 {@code editable_once=1}；第二次提交在原记录上更新并置 0；
     * 第三次及以后抛 {@link KbResultCode#KB_FEEDBACK_ALREADY}。
     *
     * <p><b>并发安全：</b>「读取 {@code editable_once} → 判断 → 写回」本身非原子，
     * 两个并发的「第二次提交」若都读到 1，会各自置 0 并 save，实际发生 3 次有效写入。
     * 因此这里用 {@link KbQaFeedbackRepository#findWithLockBySessionId} 取悲观写锁
     * （{@code SELECT ... FOR UPDATE}）串行化同一会话的写路径；本方法的 {@code @Transactional}
     * 是读写事务，锁在提交前持有。并发「首次提交」（无行可锁）由
     * {@code kb_qa_feedback} 唯一约束 {@code uk_kb_feedback_session} 兜底。
     * 只读端点（{@link #getFeedback} / {@link #getSessionDetail}）仍走无锁的
     * {@code findBySessionId}，不引入读放大。
     */
    @Transactional
    public KbQaFeedbackVO submitFeedback(QaFeedbackRequest req, Long userId) {
        KbQaSession session = requireSession(req.sessionId());
        if (userId != null && !userId.equals(session.getUserId())) {
            throw new KbBusinessException(KbResultCode.KB_SESSION_NOT_FOUND);
        }
        validateScore("accuracy", req.accuracy());
        validateScore("helpful", req.helpful());
        validateScore("offtopic", req.offtopic());
        validateScore("citeError", req.citeError());

        Instant now = Instant.now();
        // 悲观写锁：仅此写路径使用，读路径保持无锁
        KbQaFeedback entity = feedbackRepository.findWithLockBySessionId(req.sessionId()).orElse(null);
        if (entity == null) {
            entity = new KbQaFeedback();
            entity.setId(IdGenerator.nextId());
            entity.setSessionId(req.sessionId());
            entity.setEditableOnce(1);
            entity.setCreatedAt(now);
        } else if (entity.getEditableOnce() == null || entity.getEditableOnce() == 0) {
            throw new KbBusinessException(KbResultCode.KB_FEEDBACK_ALREADY);
        } else {
            // 用掉唯一一次修改机会
            entity.setEditableOnce(0);
        }
        entity.setAccuracy(req.accuracy());
        entity.setHelpful(req.helpful());
        entity.setOfftopic(req.offtopic());
        entity.setCiteError(req.citeError());
        entity.setUpdatedAt(now);
        return toFeedbackVo(feedbackRepository.save(entity));
    }

    /** 查询某会话的反馈；不存在返回 {@code null}。 */
    @Transactional(readOnly = true)
    public KbQaFeedbackVO getFeedback(Long sessionId) {
        return feedbackRepository.findBySessionId(sessionId)
                .map(KbQaService::toFeedbackVo)
                .orElse(null);
    }

    // ---------------------------------------------------------------- 内部辅助

    private KbQaSession requireSession(Long sessionId) {
        return sessionRepository.findById(sessionId)
                .orElseThrow(() -> new KbBusinessException(KbResultCode.KB_SESSION_NOT_FOUND));
    }

    /**
     * 取会话并校验归属。
     *
     * <p>越权一律按 {@code KB_SESSION_NOT_FOUND} 返回，不泄露他人会话的存在性
     * （与 {@link #getSessionDetail} 保持一致的错误语义）。
     *
     * @param sessionId    会话 id
     * @param actingUserId 实际发起用户；{@code null} 表示无用户身份，跳过校验
     */
    private KbQaSession requireOwnedSession(Long sessionId, Long actingUserId) {
        KbQaSession session = requireSession(sessionId);
        if (actingUserId != null && !actingUserId.equals(session.getUserId())) {
            log.warn("拒绝跨用户写入问答会话 sessionId={} owner={} acting={}",
                    sessionId, session.getUserId(), actingUserId);
            throw new KbBusinessException(KbResultCode.KB_SESSION_NOT_FOUND);
        }
        return session;
    }

    private Map<Long, List<QaCitationVO>> loadCitations(List<KbQaMessage> messages) {
        if (messages.isEmpty()) {
            return Collections.emptyMap();
        }
        List<Long> messageIds = messages.stream().map(KbQaMessage::getId).toList();
        return citationRepository.findByMessageIdIn(messageIds).stream()
                .collect(Collectors.groupingBy(
                        KbQaCitation::getMessageId,
                        Collectors.mapping(KbQaService::toCitationVo, Collectors.toList())));
    }

    private static void validateScore(String field, Integer value) {
        if (value == null) {
            return;
        }
        if (value < 0 || value > 5) {
            throw new BusinessException(ResultCode.VALIDATION_ERROR, "反馈项 " + field + " 取值应在 0~5 之间");
        }
    }

    private static KbQaSessionVO toSessionVo(KbQaSession e) {
        return new KbQaSessionVO(e.getId(), e.getUserId(), e.getAppId(), e.getCreatedAt(), e.getTitle());
    }

    /**
     * 引用实体 → 视图。
     *
     * <p>注意列名与对外字段名的映射：{@code chunkOffset → offset}、{@code pageNo → page}
     * （落库列避开 SQL 保留字，对外契约保持设计文档定义的 offset/page）。
     */
    static QaCitationVO toCitationVo(KbQaCitation e) {
        return new QaCitationVO(
                e.getId(), e.getLibraryId(), e.getDocumentId(), e.getChunkText(), e.getScore(),
                e.getChunkOffset(), e.getPageNo(), e.getSource());
    }

    private static KbQaFeedbackVO toFeedbackVo(KbQaFeedback e) {
        return new KbQaFeedbackVO(
                e.getId(), e.getSessionId(), e.getAccuracy(), e.getHelpful(),
                e.getOfftopic(), e.getCiteError());
    }
}
