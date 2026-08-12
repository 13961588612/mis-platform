package com.mis.kb.api.controller;

import com.mis.common.core.exception.BusinessException;
import com.mis.common.core.exception.ResultCode;
import com.mis.common.core.result.Result;
import com.mis.common.security.context.LoginUser;
import com.mis.common.security.context.SecurityContextHolder;
import com.mis.kb.api.dto.KbEngineRefVO;
import com.mis.kb.api.dto.KbGraphBuildResultVO;
import com.mis.kb.api.dto.KbGraphStatusVO;
import com.mis.kb.api.dto.KbLibraryCreateRequest;
import com.mis.kb.api.dto.KbLibraryDeleteResultVO;
import com.mis.kb.api.dto.KbLibraryDetailVO;
import com.mis.kb.api.dto.KbLibraryUpdateRequest;
import com.mis.kb.api.dto.KbLibraryVO;
import com.mis.kb.api.dto.KbRaptorBuildResultVO;
import com.mis.kb.api.dto.KbRaptorStatusVO;
import com.mis.kb.domain.model.LibraryDeleteMode;
import com.mis.kb.domain.model.RagSettings;
import com.mis.kb.domain.service.KbGraphService;
import com.mis.kb.domain.service.KbLibraryService;
import com.mis.kb.domain.service.KbRaptorService;
import com.mis.kb.domain.service.RagSettingsService;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/** 知识库管理（内部端点，供 BFF 聚合）。 */
@RestController
@RequestMapping("/internal/v1/kb/libraries")
public class LibraryController {

    private final KbLibraryService libraryService;
    private final RagSettingsService ragSettingsService;
    private final KbGraphService graphService;
    private final KbRaptorService raptorService;

    public LibraryController(
            KbLibraryService libraryService,
            RagSettingsService ragSettingsService,
            KbGraphService graphService,
            KbRaptorService raptorService) {
        this.libraryService = libraryService;
        this.ragSettingsService = ragSettingsService;
        this.graphService = graphService;
        this.raptorService = raptorService;
    }

    @GetMapping
    public Result<List<KbLibraryVO>> list(
            @RequestParam(required = false) Long categoryId,
            @RequestParam(required = false) String scope) {
        // scope=manageable|visible 数据面收敛；缺省 / 空 / 非法 = 现状全量兼容（见 KbLibraryService.list）
        return Result.ok(libraryService.list(currentUserId(), categoryId, scope));
    }

    @GetMapping("/{id}")
    public Result<KbLibraryVO> get(@PathVariable Long id) {
        return Result.ok(libraryService.get(id));
    }

    /**
     * 知识库详情聚合（L-06）。
     *
     * <p>一次返回「基本信息 + 文档数 + 授权摘要 + RAG 设置」，供详情页三个 Tab 首屏共用，
     * 避免前端进页面就打三四个请求。{@code aclSummary.subjectName} 在 mis-kb 侧为 {@code null}，
     * 由 BFF 回填——领域服务不该为了显示一个名字去远程 IAM 拉 N 次。
     *
     * @param id 知识库 id
     * @return 详情聚合视图
     */
    @GetMapping("/{id}/detail")
    public Result<KbLibraryDetailVO> detail(@PathVariable Long id) {
        return Result.ok(ragSettingsService.detail(id));
    }

    /**
     * 读取知识库 RAG 设置（L-08）。
     *
     * @param id 知识库 id
     * @return 已用默认值补齐的设置
     */
    @GetMapping("/{id}/engine/settings")
    public Result<RagSettings> getEngineSettings(@PathVariable Long id) {
        return Result.ok(ragSettingsService.get(id));
    }

    /**
     * 保存知识库 RAG 设置并同步引擎（L-08，依赖 X-03 修复）。
     *
     * <p>引擎同步失败<b>不回滚</b>本地保存，仅记 error 日志；口径见
     * {@link RagSettingsService} 类级说明。
     *
     * @param id       知识库 id
     * @param settings 待保存设置
     * @return 落库后生效的设置
     */
    @PutMapping("/{id}/engine/settings")
    public Result<RagSettings> updateEngineSettings(
            @PathVariable Long id, @RequestBody RagSettings settings) {
        return Result.ok(ragSettingsService.save(currentUserId(), id, settings));
    }

    /**
     * 触发图谱构建（Wave B GraphRAG PoC，T02；手动按钮/重试）。
     *
     * <p><b>内部端点不重复判权限码</b>（与仓库既有口径一致）：BFF 侧 {@code kb:library:edit}
     * 权限码 + {@code @OperLog} 审计收口；本方法内 {@code KbGraphService.build} 仍执行
     * {@code hasLibraryManage} 管辖双闸门 + 能力/上限/状态机校验（设计 §2.5）。
     *
     * @param id 知识库 id
     * @return 构图触发回执（building/taskId/kgBuildStatus）
     */
    @PostMapping("/{id}/graph/build")
    public Result<KbGraphBuildResultVO> buildGraph(@PathVariable Long id) {
        return Result.ok(graphService.build(id, currentUserId()));
    }

    /**
     * 查询图谱构建状态（Wave B GraphRAG PoC，T02；前端 3s 轮询）。
     *
     * <p><b>读操作：</b>BFF 侧 {@code kb:library:engine-ref:view} 权限码收口，
     * 不挂审计（U6：轮询刷审计表噪声）。每次调用触发引擎刷新 + 有变化才回写。
     *
     * @param id 知识库 id
     * @return 状态回执（kgBuildStatus/kgBuildMessage/graphragTaskId/updatedAt）
     */
    @GetMapping("/{id}/graph/build-status")
    public Result<KbGraphStatusVO> graphBuildStatus(@PathVariable Long id) {
        return Result.ok(graphService.refreshStatus(id));
    }

    /**
     * 触发 RAPTOR 摘要构建（Wave C RAPTOR，T02；手动按钮/重试）。
     *
     * <p><b>内部端点不重复判权限码</b>（与仓库既有口径一致）：BFF 侧 {@code kb:library:edit}
     * 权限码 + {@code @OperLog} 审计收口；本方法内 {@code KbRaptorService.build} 仍执行
     * {@code hasLibraryManage} 管辖双闸门 + 能力/状态机校验（设计 §2.5）。
     * <b>U4：无库数上限</b>——只有平台总开关 {@code mis.kb.engine.raptor-enabled} + 能力
     * {@code raptor} 闸门。
     *
     * @param id 知识库 id
     * @return 构建触发回执（building/taskId/raptorBuildStatus）
     */
    @PostMapping("/{id}/raptor/build")
    public Result<KbRaptorBuildResultVO> buildRaptor(@PathVariable Long id) {
        return Result.ok(raptorService.build(id, currentUserId()));
    }

    /**
     * 查询 RAPTOR 构建状态（Wave C RAPTOR，T02；前端 3s 轮询）。
     *
     * <p><b>读操作：</b>BFF 侧 {@code kb:library:engine-ref:view} 权限码收口，
     * 不挂审计（U6：轮询刷审计表噪声）。每次调用触发引擎刷新 + 有变化才回写。
     *
     * @param id 知识库 id
     * @return 状态回执（raptorBuildStatus/raptorBuildMessage/raptorTaskId/updatedAt）
     */
    @GetMapping("/{id}/raptor/build-status")
    public Result<KbRaptorStatusVO> raptorBuildStatus(@PathVariable Long id) {
        return Result.ok(raptorService.refreshStatus(id));
    }

    @PostMapping
    public Result<KbLibraryVO> create(@Valid @RequestBody KbLibraryCreateRequest request) {
        // owner 缺省为当前登录用户
        KbLibraryCreateRequest effective = request.owner() != null
                ? request
                : new KbLibraryCreateRequest(
                        request.categoryId(), request.name(), request.secrecy(),
                        currentUserId(), request.settings());
        return Result.ok(libraryService.create(currentUserId(), effective));
    }

    @PutMapping("/{id}")
    public Result<KbLibraryVO> update(@PathVariable Long id, @Valid @RequestBody KbLibraryUpdateRequest request) {
        return Result.ok(libraryService.update(currentUserId(), id, request));
    }

    /**
     * 删除知识库（T03，语义按 {@code mode} 分两支）。
     *
     * <p><b>破坏性语义变更：</b>不带 {@code mode} 时走<b>归档</b>（引擎侧改名保留数据 +
     * 本地停用），而不是旧版的「物理删且吞异常假成功」。回执 {@code message} 会明说
     * 「已归档，未删除引擎数据」，前端必须原样展示。
     *
     * <p>非法 {@code mode} <b>直接拒</b>而不是静默回落归档——用户把 {@code physical}
     * 拼成 {@code physicial} 时若静默归档，他会以为数据已经删干净了。
     *
     * @param id   知识库 id
     * @param mode {@code archive}（默认）或 {@code physical}
     * @return 删除回执
     */
    @DeleteMapping("/{id}")
    public Result<KbLibraryDeleteResultVO> delete(
            @PathVariable Long id,
            @RequestParam(required = false, defaultValue = "archive") String mode) {
        LibraryDeleteMode parsed = LibraryDeleteMode.parse(mode);
        if (parsed == null) {
            throw new BusinessException(
                    ResultCode.VALIDATION_ERROR, "删除模式非法（应为 archive/physical）：" + mode);
        }
        return Result.ok(libraryService.delete(currentUserId(), id, parsed));
    }

    /**
     * 查看知识库的引擎引用（Q4 有限暴露 dataset_id）。
     *
     * <p><b>内部端点不重复判权</b>（与仓库既有口径一致）：权限码
     * {@code kb:library:engine-ref:view} 与 {@code @OperLog} 审计都在 BFF 侧收口。
     * 这条端点破了「不暴露 engine_library_ref」的架构红线，审计是它成立的前提，
     * BFF 那行 {@code @OperLog} 不能省。
     *
     * @param id 知识库 id
     * @return 引擎引用视图（含 dataset_id 与同步状态）
     */
    @GetMapping("/{id}/engine-ref")
    public Result<KbEngineRefVO> engineRef(@PathVariable Long id) {
        return Result.ok(libraryService.engineRef(id));
    }

    private Long currentUserId() {
        return SecurityContextHolder.getOptional().map(LoginUser::getUserId).orElse(null);
    }
}
