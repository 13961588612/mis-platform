package com.mis.kb.domain.service;

import com.mis.common.core.exception.BusinessException;
import com.mis.common.core.exception.ResultCode;
import com.mis.kb.api.dto.KbEngineRefVO;
import com.mis.kb.api.dto.KbLibraryCreateRequest;
import com.mis.kb.api.dto.KbLibraryDeleteResultVO;
import com.mis.kb.api.dto.KbLibraryUpdateRequest;
import com.mis.kb.api.dto.KbLibraryVO;
import com.mis.kb.domain.entity.KbCategory;
import com.mis.kb.domain.entity.KbLibrary;
import com.mis.kb.domain.model.CreateLibraryCmd;
import com.mis.kb.domain.model.EngineLibraryRef;
import com.mis.kb.domain.model.EngineSyncStatus;
import com.mis.kb.domain.model.KbResultCode;
import com.mis.kb.domain.model.LibraryDeleteMode;
import com.mis.kb.domain.model.LibraryStatus;
import com.mis.kb.domain.model.RagSettings;
import com.mis.kb.domain.model.Secrecy;
import com.mis.kb.domain.repository.KbAclRepository;
import com.mis.kb.domain.repository.KbCategoryRepository;
import com.mis.kb.domain.repository.KbDocumentRepository;
import com.mis.kb.domain.repository.KbLibraryRepository;
import com.mis.kb.engine.KnowledgeEnginePort;
import com.mis.kb.engine.RagflowDatasetNaming;
import com.mis.kb.engine.RagflowProperties;
import com.mis.kb.support.IdGenerator;
import com.mis.kb.support.KbBusinessException;
import com.mis.kb.support.KbJson;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

import java.time.Instant;
import java.time.LocalDate;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.Objects;
import java.util.Optional;
import java.util.Set;

/** 知识库服务（L-01~08）。 */
@Service
public class KbLibraryService {

    private static final Logger log = LoggerFactory.getLogger(KbLibraryService.class);

    /**
     * 分类树向上回溯的最大深度。
     *
     * <p>防脏数据成环（{@code A.parent=B, B.parent=A}）时把线程转死。分类树实际只有
     * 两三层，16 层已是数量级冗余。
     */
    private static final int MAX_CATEGORY_DEPTH = 16;

    private final KbLibraryRepository libraryRepository;
    private final KbDocumentRepository documentRepository;
    private final KbAclRepository aclRepository;
    private final KbCategoryRepository categoryRepository;
    private final KnowledgeEnginePort enginePort;
    private final RagflowProperties engineProperties;
    private final NodeAdminResolver nodeAdminResolver;
    private final KbVisibilityService visibilityService;

    public KbLibraryService(
            KbLibraryRepository libraryRepository,
            KbDocumentRepository documentRepository,
            KbAclRepository aclRepository,
            KbCategoryRepository categoryRepository,
            KnowledgeEnginePort enginePort,
            RagflowProperties engineProperties,
            NodeAdminResolver nodeAdminResolver,
            KbVisibilityService visibilityService) {
        this.libraryRepository = libraryRepository;
        this.documentRepository = documentRepository;
        this.aclRepository = aclRepository;
        this.categoryRepository = categoryRepository;
        this.enginePort = enginePort;
        this.engineProperties = engineProperties;
        this.nodeAdminResolver = nodeAdminResolver;
        this.visibilityService = visibilityService;
    }

    /**
     * 库级管理合成（知识库域一期，Q9）：{@code 节点管辖 ∨ kb_acl.manage}。
     *
     * <p>文档写操作双闸门（权限码 + 管辖）统一走这里；判定收口在
     * {@link NodeAdminResolver#hasLibraryManage}，禁止内联。
     */
    public boolean hasLibraryManage(Long userId, Long libraryId) {
        return nodeAdminResolver.hasLibraryManage(userId, libraryId);
    }

    /**
     * 知识库列表（L-01~08；权限模型改造新增 scope 数据面收敛）。
     *
     * <p><b>scope 语义（两端字面量统一，缺省 / 空 / 非法 = 现状全量兼容，零回归）：</b>
     * <ul>
     *   <li>{@code manageable}：取 {@code nodeAdminResolver.resolveManageableLibraryIds(userId)}
     *       与全量库的交集（可叠加 {@code categoryId} 再收敛）；{@code userId == null} 返回空集（安全侧收紧）；</li>
     *   <li>{@code visible}：取 {@code visibilityService.resolveVisibleLibraryIds} 口径交集
     *       （public∧enabled ∪ ACL read − disabled，与检索可见性完全一致）；</li>
     *   <li>其余（含不带 scope）：现状行为（{@code categoryId != null ? findByCategoryIdOrderByNameAsc : findAll}）。</li>
     * </ul>
     */
    @Transactional(readOnly = true)
    public List<KbLibraryVO> list(Long userId, Long categoryId, String scope) {
        List<KbLibrary> entities;
        if ("manageable".equalsIgnoreCase(scope)) {
            Set<Long> manageableIds = nodeAdminResolver.resolveManageableLibraryIds(userId);
            entities = libraryRepository.findAll().stream()
                    .filter(lib -> manageableIds.contains(lib.getId()))
                    .filter(lib -> categoryId == null || categoryId.equals(lib.getCategoryId()))
                    .sorted(Comparator.comparing(KbLibrary::getName))
                    .toList();
        } else if ("visible".equalsIgnoreCase(scope)) {
            // tenantId 为预留参数（P0 单租户），沿用 resolveVisibleLibraryIds 现有语义
            Set<Long> visibleIds = new HashSet<>(visibilityService.resolveVisibleLibraryIds(userId, null));
            entities = libraryRepository.findAll().stream()
                    .filter(lib -> visibleIds.contains(lib.getId()))
                    .filter(lib -> categoryId == null || categoryId.equals(lib.getCategoryId()))
                    .sorted(Comparator.comparing(KbLibrary::getName))
                    .toList();
        } else {
            entities = categoryId != null
                    ? libraryRepository.findByCategoryIdOrderByNameAsc(categoryId)
                    : libraryRepository.findAll();
        }
        return entities.stream().map(this::toVo).toList();
    }

    @Transactional(readOnly = true)
    public KbLibraryVO get(Long id) {
        return toVo(require(id));
    }

    /**
     * 知识库的引擎引用（Q4 有限暴露 dataset_id，T03）。
     *
     * <p>内部端点<b>不重复判权</b>——权限码 {@code kb:library:engine-ref:view} 与审计
     * 都在 BFF 侧收口，与仓库既有内部端点口径一致。
     *
     * @param id 知识库 id
     * @return 引擎引用视图
     */
    @Transactional(readOnly = true)
    public KbEngineRefVO engineRef(Long id) {
        KbLibrary e = require(id);
        return new KbEngineRefVO(
                e.getId(), e.getEngineType(), e.getEngineLibraryRef(),
                e.getEngineSyncStatus(), e.getEngineCheckedAt());
    }

    /**
     * 新建知识库（L-01）。
     *
     * <p><b>T02 调整了执行顺序：</b>原实现是「先调引擎、后 {@code IdGenerator.nextId()}」，
     * 导致 adapter 拿不到 MIS 库 ID，引擎侧 dataset 名只能用裸库名——三个分类下都叫
     * 「制度」的库在 RAGFlow 控制台里完全无法区分。现在把 ID 生成<b>提前到调引擎之前</b>，
     * 连同一级分类名一起塞进 {@link CreateLibraryCmd}，由 adapter 按
     * {@code {一级分类名}-{库名}-{ID后6位}} 拼名。
     *
     * <p>ID 提前生成不会浪费号段：雪花 ID 本就不连续，引擎调用失败时事务回滚，
     * 该 ID 丢弃即可。
     */
    @Transactional
    public KbLibraryVO create(Long userId, KbLibraryCreateRequest req) {
        // KBP-01：消除「非管辖分类下建库」根因——首行管辖断言（统一走 NodeAdminResolver）
        nodeAdminResolver.assertNodeManage(userId, req.categoryId());
        if (!Secrecy.isValid(req.secrecy())) {
            throw new BusinessException(ResultCode.VALIDATION_ERROR, "密级非法（应为 public/internal/secret/confidential）");
        }
        String name = req.name().trim();
        if (libraryRepository.existsByNameAndCategoryId(name, req.categoryId())) {
            throw new KbBusinessException(KbResultCode.KB_LIBRARY_NAME_EXISTS);
        }
        long libraryId = IdGenerator.nextId();
        String topCategoryName = resolveTopCategoryName(req.categoryId());
        EngineLibraryRef ref = enginePort.createLibrary(new CreateLibraryCmd(
                name, req.secrecy(), req.owner(), req.settings(), libraryId, topCategoryName));
        Instant now = Instant.now();
        KbLibrary entity = new KbLibrary();
        entity.setId(libraryId);
        entity.setCategoryId(req.categoryId());
        entity.setName(name);
        entity.setSecrecy(req.secrecy());
        entity.setStatus(LibraryStatus.ENABLED.code());
        entity.setOwner(req.owner());
        entity.setEngineType(ref.engineType());
        entity.setEngineLibraryRef(ref.nativeId());
        entity.setRagSettingsJson(KbJson.writeSettings(req.settings()));
        entity.setEngineSyncStatus(EngineSyncStatus.UNKNOWN);
        entity.setCreatedAt(now);
        entity.setUpdatedAt(now);
        log.info("知识库已创建 id={} engineType={} engineRef={} topCategory={}",
                entity.getId(), ref.engineType(), ref.nativeId(), topCategoryName);
        return toVo(libraryRepository.save(entity));
    }

    /**
     * 更新知识库元信息与设置（L-03）。
     *
     * <p><b>T03 修掉了引擎同步的静默失败：</b>原实现 catch 里只打一行 WARN 就返回 200，
     * 管理员看到「保存成功」，实际引擎侧参数纹丝不动。现在失败时：
     * <ol>
     *   <li>落库 {@code engine_sync_status=3} + {@code engine_checked_at=now}，让对账能看见；</li>
     *   <li>回执 VO 带 {@code engineSyncFailed=true} + 原因，前端立刻提示。</li>
     * </ol>
     * <b>仍然不上抛</b>——本地保存本身是成功的，抛异常会让前端以为整单没存下、
     * 诱导用户反复重试。
     */
    @Transactional
    public KbLibraryVO update(Long userId, Long id, KbLibraryUpdateRequest req) {
        KbLibrary entity = require(id);
        // KBP-06：库级管理双闸门（节点管辖 ∨ kb_acl.manage），统一走 NodeAdminResolver
        if (!nodeAdminResolver.hasLibraryManage(userId, id)) {
            throw new KbBusinessException(KbResultCode.KB_CATEGORY_NOT_MANAGEABLE,
                    "该知识库不在您的管理范围内");
        }
        // 【P1-T2 取消归档回滚】先快照「是否处于归档态」再改本地状态：
        // 归档判定 = status=0 且 archived_at 非空（见 KbLibrary#isArchived）。
        // 必须在 setStatus 之前抓，否则下方条件永远不成立。
        boolean wasArchived = entity.isArchived();
        if (!Secrecy.isValid(req.secrecy())) {
            throw new BusinessException(ResultCode.VALIDATION_ERROR, "密级非法（应为 public/internal/secret/confidential）");
        }
        String name = req.name().trim();
        if (!entity.getName().equals(name)
                && libraryRepository.existsByNameAndCategoryId(name, entity.getCategoryId())) {
            throw new KbBusinessException(KbResultCode.KB_LIBRARY_NAME_EXISTS);
        }
        entity.setName(name);
        entity.setSecrecy(req.secrecy());
        if (req.status() != null) {
            entity.setStatus(req.status());
        }
        String newJson = KbJson.writeSettings(req.settings());
        boolean settingsChanged = !Objects.equals(newJson, entity.getRagSettingsJson());
        entity.setRagSettingsJson(newJson);
        entity.setUpdatedAt(Instant.now());
        KbLibrary saved = libraryRepository.save(entity);

        String syncError = null;
        if (settingsChanged && LibraryStatus.isEnabled(saved.getStatus()) && saved.getEngineLibraryRef() != null) {
            try {
                enginePort.updateLibrarySettings(
                        new EngineLibraryRef(saved.getEngineType(), saved.getEngineLibraryRef()), req.settings());
            } catch (Exception e) {
                syncError = describeError(e);
                log.warn("更新引擎知识库设置失败 id={}: {}", saved.getId(), syncError);
                saved.setEngineSyncStatus(EngineSyncStatus.DRIFT_OR_FAILED);
                saved.setEngineCheckedAt(Instant.now());
                saved = libraryRepository.save(saved);
            }
        }
        // 【P1-T2 取消归档回滚】「停用中且带归档标记 → 请求改回启用」时，把引擎侧 dataset
        // 改回规范名并清掉归档标记。改名目标是 P0 的 expectedEngineName(lib)（已含本次
        // name/categoryId 变更）；引擎改名失败不阻断取消归档（本地语义优先，与 P0 archive
        // 口径一致），仅把 engine_sync_status 写 3，由 P1-T4 重命名端点修复。
        if (wasArchived
                && req.status() != null
                && LibraryStatus.isEnabled(req.status())
                && saved.getEngineLibraryRef() != null) {
            String canonical = expectedEngineName(saved);
            try {
                enginePort.renameLibrary(
                        new EngineLibraryRef(saved.getEngineType(), saved.getEngineLibraryRef()), canonical);
                // 不掩盖上面 settings 同步已记录的失败（syncError!=null 时保持 DRIFT）。
                if (syncError == null) {
                    saved.setEngineSyncStatus(EngineSyncStatus.CONSISTENT);
                }
                log.info("取消归档：引擎 dataset 已改回规范名 id={} engineRef={} name={}",
                        saved.getId(), saved.getEngineLibraryRef(), canonical);
            } catch (Exception e) {
                syncError = describeError(e);
                saved.setEngineSyncStatus(EngineSyncStatus.DRIFT_OR_FAILED);
                log.warn("取消归档：引擎 dataset 改名失败 id={} engineRef={}: {}",
                        saved.getId(), saved.getEngineLibraryRef(), syncError);
            }
            saved.setArchivedAt(null);
            saved.setEngineCheckedAt(Instant.now());
            saved = libraryRepository.save(saved);
        }

        KbLibraryVO vo = toVo(saved);
        return syncError == null ? vo : vo.withEngineSyncResult(Boolean.TRUE, "引擎同步失败：" + syncError);
    }

    /**
     * 删除知识库（T03，三分支中的两支走这里）。
     *
     * <p><b>破坏性语义变更：</b>不带 {@code mode} 时默认走 {@link LibraryDeleteMode#ARCHIVE 归档}，
     * 而不是旧版的「物理删（且吞异常假成功）」。旧行为的危害见
     * {@link com.mis.kb.api.dto.KbLibraryDeleteResultVO} 类级说明。
     *
     * <p>「停用」不在这里——沿用既有 {@code PUT /libraries/{id}} + {@code status=0}。
     *
     * @param userId 当前用户 id
     * @param id     知识库 id
     * @param mode   删除模式；{@code null} 视为归档
     * @return 回执，如实描述引擎侧与本地各做了什么
     */
    @Transactional
    public KbLibraryDeleteResultVO delete(Long userId, Long id, LibraryDeleteMode mode) {
        LibraryDeleteMode effective = mode == null ? LibraryDeleteMode.ARCHIVE : mode;
        KbLibrary entity = require(id);
        // KBP-06：库级管理双闸门（节点管辖 ∨ kb_acl.manage）——归档 / 物理删共用一道闸
        if (!nodeAdminResolver.hasLibraryManage(userId, id)) {
            throw new KbBusinessException(KbResultCode.KB_CATEGORY_NOT_MANAGEABLE,
                    "该知识库不在您的管理范围内");
        }
        return switch (effective) {
            case ARCHIVE -> archive(entity);
            case PHYSICAL -> physicalDelete(entity);
        };
    }

    /**
     * 归档：引擎侧改名保留数据，本地停用并打归档标记。
     *
     * <p>引擎改名失败<b>不阻断</b>归档——归档是以本地语义为主的动作，为了引擎侧一次抖动
     * 就让管理员归不了档并不划算。失败时把 {@code engine_sync_status=3} 落库，
     * 由对账服务后续兜底，并在回执里如实说明。
     *
     * <p><b>MIS 侧 {@code name} 绝不改</b>：改了会撞 {@code (name, category_id)} 唯一键，
     * 也会让用户在列表里找不到自己刚归档的库。
     */
    private KbLibraryDeleteResultVO archive(KbLibrary entity) {
        Instant now = Instant.now();
        boolean engineSynced = true;
        String engineError = null;
        String archivedName = null;

        if (entity.getEngineLibraryRef() != null) {
            String expectedCurrentName = expectedEngineName(entity);
            String targetName = RagflowDatasetNaming.forArchive(expectedCurrentName, LocalDate.now());
            try {
                enginePort.renameLibrary(
                        new EngineLibraryRef(entity.getEngineType(), entity.getEngineLibraryRef()), targetName);
                archivedName = targetName;
                entity.setEngineSyncStatus(EngineSyncStatus.CONSISTENT);
                log.info("知识库归档：引擎侧已改名 id={} engineRef={} newName={}",
                        entity.getId(), entity.getEngineLibraryRef(), targetName);
            } catch (Exception e) {
                engineSynced = false;
                engineError = describeError(e);
                entity.setEngineSyncStatus(EngineSyncStatus.DRIFT_OR_FAILED);
                log.warn("知识库归档：引擎侧改名失败（已记入待对账）id={} engineRef={}: {}",
                        entity.getId(), entity.getEngineLibraryRef(), engineError);
            }
            entity.setEngineCheckedAt(now);
        } else {
            log.info("知识库归档：该库未绑定引擎 dataset，跳过引擎侧动作 id={}", entity.getId());
        }

        entity.setStatus(LibraryStatus.DISABLED.code());
        entity.setArchivedAt(now);
        entity.setUpdatedAt(now);
        libraryRepository.save(entity);

        return new KbLibraryDeleteResultVO(
                LibraryDeleteMode.ARCHIVE.wire(), engineSynced, engineError, archivedName, 0L, 0L,
                archiveMessage(engineSynced, engineError, archivedName));
    }

    /**
     * 物理删除：引擎侧删成功才动本地，三表按 文档 → 授权 → 库 的顺序清。
     *
     * <p>两道闸门缺一不可：
     * <ol>
     *   <li>{@code delete-supported=false}（某环境部署的 RAGFLOW 版本删除接口仍不可用、
     *       由 Nacos 关掉）直接拒，<b>本地零变更</b>；默认 {@code true}（增量 P0-T01 已放开
     *       官方批量删除接口），业务侧正常走物理删除；</li>
     *   <li>引擎删除抛异常 → 抛 {@code KB_ENGINE_DELETE_FAILED} 让事务回滚。
     *       <b>绝不 catch 后继续</b>——那正是旧版「本地删干净、引擎侧留一堆孤儿 dataset」的成因。</li>
     * </ol>
     *
     * <p>清 {@code kb_document} 是 Q6 补的：旧版只清了 {@code kb_acl}，库删掉后
     * {@code kb_document} 里一堆 {@code library_id} 指向不存在的库。
     */
    private KbLibraryDeleteResultVO physicalDelete(KbLibrary entity) {
        if (!engineProperties.isDeleteSupported()) {
            log.warn("拒绝物理删除：当前引擎不支持在线删除 id={} engineType={}",
                    entity.getId(), entity.getEngineType());
            throw new KbBusinessException(KbResultCode.KB_ENGINE_DELETE_UNSUPPORTED);
        }
        if (entity.getEngineLibraryRef() != null) {
            try {
                enginePort.deleteLibrary(
                        new EngineLibraryRef(entity.getEngineType(), entity.getEngineLibraryRef()));
            } catch (Exception e) {
                String reason = describeError(e);
                log.error("引擎侧删除失败，本地不做任何变更 id={} engineRef={}: {}",
                        entity.getId(), entity.getEngineLibraryRef(), reason, e);
                throw new KbBusinessException(
                        KbResultCode.KB_ENGINE_DELETE_FAILED,
                        KbResultCode.KB_ENGINE_DELETE_FAILED.getMessage() + "：" + reason);
            }
        }
        Long id = entity.getId();
        long docCleaned = documentRepository.countByLibraryId(id);
        long aclCleaned = aclRepository.findByLibraryId(id).size();
        documentRepository.deleteByLibraryId(id);
        aclRepository.deleteByLibraryId(id);
        libraryRepository.delete(entity);
        log.info("知识库已物理删除 id={} 清理文档={} 清理授权={}", id, docCleaned, aclCleaned);
        return new KbLibraryDeleteResultVO(
                LibraryDeleteMode.PHYSICAL.wire(), true, null, null, docCleaned, aclCleaned,
                String.format("已彻底删除：引擎侧 dataset 已删除，本地清理文档 %d 条、授权 %d 条。",
                        docCleaned, aclCleaned));
    }

    /**
     * 该库在引擎侧的<b>期望</b> dataset 名（未归档口径）。
     *
     * <p>MIS 侧不存引擎 dataset 名——存了就得双写、就会漂移。命名规则是确定性函数，
     * 用 {@code (一级分类名, 库名, 库ID)} 现算即可。归档改名与对账的期望名判定都基于它。
     *
     * @param lib 知识库实体
     * @return 按 {@link RagflowDatasetNaming#forCreate} 规则算出的期望名
     */
    public String expectedEngineName(KbLibrary lib) {
        return RagflowDatasetNaming.forCreate(
                resolveTopCategoryName(lib.getCategoryId()), lib.getName(), lib.getId());
    }

    /**
     * 由分类 ID 向上回溯出一级分类名。
     *
     * @param categoryId 分类 ID，允许 {@code null}
     * @return 一级分类名；查不到返回 {@link RagflowDatasetNaming#UNCATEGORIZED}
     */
    public String resolveTopCategoryName(Long categoryId) {
        if (categoryId == null) {
            return RagflowDatasetNaming.UNCATEGORIZED;
        }
        Long cursor = categoryId;
        String topName = null;
        for (int depth = 0; depth < MAX_CATEGORY_DEPTH && cursor != null; depth++) {
            Optional<KbCategory> found = categoryRepository.findById(cursor);
            if (found.isEmpty()) {
                break;
            }
            KbCategory category = found.get();
            topName = category.getName();
            Long parentId = category.getParentId();
            if (parentId == null || parentId == 0L || parentId.equals(category.getId())) {
                break;
            }
            cursor = parentId;
        }
        return StringUtils.hasText(topName) ? topName : RagflowDatasetNaming.UNCATEGORIZED;
    }

    private KbLibrary require(Long id) {
        return libraryRepository.findById(id)
                .orElseThrow(() -> new KbBusinessException(KbResultCode.KB_LIBRARY_NOT_FOUND));
    }

    private KbLibraryVO toVo(KbLibrary e) {
        RagSettings settings = KbJson.readSettings(e.getRagSettingsJson());
        long docCount = documentRepository.countByLibraryId(e.getId());
        return new KbLibraryVO(
                e.getId(), e.getCategoryId(), e.getName(), e.getSecrecy(), e.getStatus(),
                e.getOwner(), e.getEngineType(), settings, docCount,
                e.getCreatedAt(), e.getUpdatedAt(),
                e.getEngineSyncStatus(), e.getEngineCheckedAt(), e.getArchivedAt(),
                null, null);
    }

    /** 归档回执文案：无论成败都必须明说「未删除引擎数据」（§1.10-2）。 */
    private static String archiveMessage(boolean engineSynced, String engineError, String archivedName) {
        if (engineSynced && archivedName != null) {
            return "已归档，未删除引擎数据。引擎侧 dataset 已改名为「" + archivedName
                    + "」，本地已停用；文档与授权全部保留。";
        }
        if (engineSynced) {
            return "已归档，未删除引擎数据。该库未绑定引擎 dataset，仅本地停用；文档与授权全部保留。";
        }
        return "已归档，未删除引擎数据。引擎侧改名失败（" + engineError
                + "），已记入待对账；本地已停用，文档与授权全部保留。";
    }

    /** 异常摘要（避免把整个堆栈塞进回执给前端）。 */
    private static String describeError(Exception e) {
        String message = e.getMessage();
        return StringUtils.hasText(message) ? message : e.getClass().getSimpleName();
    }
}
