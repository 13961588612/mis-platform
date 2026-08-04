package com.mis.kb.api.controller;

import com.mis.common.core.result.PageResult;
import com.mis.common.core.result.Result;
import com.mis.common.security.context.LoginUser;
import com.mis.common.security.context.SecurityContextHolder;
import com.mis.kb.api.dto.SynonymConfigUpdateRequest;
import com.mis.kb.api.dto.SynonymConfigVO;
import com.mis.kb.api.dto.SynonymFileVO;
import com.mis.kb.api.dto.SynonymGroupSaveRequest;
import com.mis.kb.api.dto.SynonymGroupVO;
import com.mis.kb.api.dto.SynonymImportCommitRequest;
import com.mis.kb.api.dto.SynonymImportCommitVO;
import com.mis.kb.api.dto.SynonymImportPrecheckVO;
import com.mis.kb.domain.service.SynonymConfigService;
import com.mis.kb.domain.service.SynonymGroupService;
import com.mis.kb.domain.model.KbResultCode;
import com.mis.kb.domain.service.SynonymImportService;
import com.mis.kb.support.KbBusinessException;
import jakarta.validation.Valid;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;

/**
 * 同义词与术语扩展的内部端点（Wave D，T09）。
 *
 * <p><b>路径为什么是复数 {@code /synonyms}：</b>前端契约（{@code features/kb/api/kb-api.ts}）
 * 与 {@code V18__kb_synonym.sql} 登记的 11 行 {@code sys_api}（91062–91072）都用复数，
 * 三处必须逐字一致——差一个字母，API 级判权就会查不到映射，
 * 而 BFF 配的是 {@code deny-unmapped: false}（未映射即放行），
 * 结果不是 404 而是「悄悄不判权」，比报错危险得多。
 *
 * <p><b>身份一律取透传头，不信任请求体：</b>与 {@link QaController} 同款做法。
 * 操作人写进 {@code updated_by} 与操作日志，请求体里带 userId 等于把审计交给调用方自证。
 *
 * <p><b>本控制器不做判权</b>：权限码 {@code kb:config:synonym:view|write|import} 的
 * 校验在 BFF 侧（{@code ApiPermissionInterceptor} + {@code sys_api} 注册表）完成。
 * {@code /internal/**} 只对集群内暴露，重复判权反而会因为拿不到菜单上下文而误伤。
 *
 * <p><b>40927 冲突明细走 {@code data} 通道</b>：
 * {@link SynonymGroupService#create} / {@link SynonymGroupService#update} 抛出的
 * {@code KbSynonymConflictException} 携带 {@code {term, ownerGroupId, ownerCanonicalTerm}}，
 * 由全局异常处理器写进响应体的 {@code data}。此处<b>刻意不 catch</b>——
 * 一 catch 就得自己重新组装，明细必丢。
 */
@RestController
@RequestMapping("/internal/v1/kb/synonyms")
public class SynonymInternalController {

    private static final Logger log = LoggerFactory.getLogger(SynonymInternalController.class);

    private final SynonymGroupService groupService;
    private final SynonymConfigService configService;
    private final SynonymImportService importService;

    public SynonymInternalController(
            SynonymGroupService groupService,
            SynonymConfigService configService,
            SynonymImportService importService) {
        this.groupService = groupService;
        this.configService = configService;
        this.importService = importService;
    }

    // ------------------------------------------------------------------ 术语组 CRUD

    /**
     * 术语组分页列表（WD-03）。
     *
     * <p>服务端分页 + 服务端搜索。词表按 5k～1 万词条验收，任何「先全量再前端过滤」的做法
     * 都会让页面失去响应，因此这里不提供「不分页」的逃生口。
     *
     * @param keyword 关键词，同时匹配规范词与别名，大小写不敏感；空白视为不过滤
     * @param status  1 启用 / 0 停用；{@code null} 为全部
     * @param page    页码，从 0 开始
     * @param size    每页条数
     * @return 分页结果
     */
    @GetMapping
    public Result<PageResult<SynonymGroupVO>> list(
            @RequestParam(required = false) String keyword,
            @RequestParam(required = false) Integer status,
            @RequestParam(required = false) Integer page,
            @RequestParam(required = false) Integer size) {
        return Result.ok(groupService.search(keyword, status, page, size));
    }

    /**
     * 术语组详情（含完整词条列表，按 {@code sortNo} 升序）。
     *
     * @param id 组 ID
     * @return 详情视图
     */
    @GetMapping("/{id}")
    public Result<SynonymGroupVO> get(@PathVariable Long id) {
        return Result.ok(groupService.get(id));
    }

    /**
     * 新建术语组（WD-01 / WD-02）。
     *
     * <p>请求体的 {@code terms} 是<b>别名列表</b>（不含规范词）——前端契约如此，
     * 服务层 {@code mergeTerms(canonical, aliases)} 负责把规范词放到首位。
     *
     * @param request 保存请求
     * @return 新建后的详情
     */
    @PostMapping
    public Result<SynonymGroupVO> create(@Valid @RequestBody SynonymGroupSaveRequest request) {
        return Result.ok(groupService.create(
                request.canonicalTerm(),
                request.aliasesOrEmpty(),
                request.remark(),
                request.status(),
                currentUserId()));
    }

    /**
     * 编辑术语组（WD-01 / WD-02）。冲突语义同 {@link #create}。
     *
     * @param id      组 ID
     * @param request 保存请求
     * @return 保存后的详情
     */
    @PutMapping("/{id}")
    public Result<SynonymGroupVO> update(
            @PathVariable Long id, @Valid @RequestBody SynonymGroupSaveRequest request) {
        return Result.ok(groupService.update(
                id,
                request.canonicalTerm(),
                request.aliasesOrEmpty(),
                request.remark(),
                request.status(),
                currentUserId()));
    }

    /**
     * 删除术语组（硬删，级联删词条）。
     *
     * @param id 组 ID
     * @return 空结果
     */
    @DeleteMapping("/{id}")
    public Result<Void> delete(@PathVariable Long id) {
        groupService.delete(id, currentUserId());
        return Result.ok();
    }

    // ------------------------------------------------------------------ 全局配置（WD-07）

    /**
     * 同义词全局配置（双闸 + 预算 + 规模水位）。
     *
     * @return 配置视图
     */
    @GetMapping("/config")
    public Result<SynonymConfigVO> getConfig() {
        return Result.ok(configService.get());
    }

    /**
     * 切换库内业务开关（Q2 双闸中的可写那一闸）。
     *
     * <p>只改 {@code kb_synonym_config.enabled}，<b>不动词表</b>：关掉再打开，
     * 原来的术语组一条不少。Nacos 熔断闸 {@code mis.kb.synonym.enabled} 不在此处暴露写口——
     * 运维闸由运维改，页面能改就不叫熔断闸了。
     *
     * @param request 开关请求
     * @return 切换后的配置视图（含重新计算的 {@code effective} 与自增后的 {@code dictVersion}）
     */
    @PutMapping("/config")
    public Result<SynonymConfigVO> updateConfig(
            @Valid @RequestBody SynonymConfigUpdateRequest request) {
        return Result.ok(configService.setEnabled(request.enabledValue(), currentUserId()));
    }

    // ------------------------------------------------------------------ 导入 / 导出（WD-04 / WD-05）

    /**
     * 导出词表（WD-05）。
     *
     * <p>返回 {@link SynonymFileVO} 而不是字节流：这一跳是服务间调用，
     * 由 BFF 决定怎么落成 HTTP 下载响应。内部接口吐 JSON，
     * 出错时才能走统一的 {@code Result} 错误通道（比如 40926 导出超限），
     * 直接吐字节流的话，错误就只能靠 HTTP 状态码表达，信息量骤减。
     *
     * @param keyword 关键词过滤，与列表页同口径（筛什么就导什么）
     * @param status  状态过滤
     * @param format  {@code CSV} / {@code JSON}；缺省 CSV
     * @return 文件载荷
     */
    @GetMapping("/export")
    public Result<SynonymFileVO> export(
            @RequestParam(required = false) String keyword,
            @RequestParam(required = false) Integer status,
            @RequestParam(required = false) String format) {
        return Result.ok(importService.export(keyword, status, format));
    }

    /**
     * 导入阶段一 · 预检（WD-04）。
     *
     * <p><b>不写任何词表数据</b>，只 INSERT 一行 {@code kb_synonym_import_batch} 落计划。
     * 文件由本服务解析——CSV/JSON 语义只能有一份实现，BFF 原样透传 multipart。
     *
     * @param file 上传文件（CSV 或 JSON，按扩展名与内容嗅探）
     * @return 预检报告（含 token / batchId / 逐行明细）
     */
    @PostMapping("/import/precheck")
    public Result<SynonymImportPrecheckVO> precheck(@RequestParam("file") MultipartFile file) {
        if (file == null || file.isEmpty()) {
            throw new KbBusinessException(
                    KbResultCode.KB_SYNONYM_IMPORT_FORMAT_INVALID,
                    "文件格式不合法：未收到上传文件。请下载模板对照修改后重新上传。");
        }
        byte[] bytes;
        try {
            bytes = file.getBytes();
        } catch (IOException ex) {
            log.warn("读取同义词导入文件失败 filename={}: {}", file.getOriginalFilename(), ex.getMessage());
            throw new KbBusinessException(
                    KbResultCode.KB_SYNONYM_IMPORT_FORMAT_INVALID,
                    "文件格式不合法：上传内容读取失败。请重新上传。");
        }
        return Result.ok(importService.precheck(bytes, file.getOriginalFilename(), currentUserId()));
    }

    /**
     * 导入阶段二 · 提交（WD-04）。
     *
     * <p>严格照阶段一落库的 {@code plan_json} 执行，<b>不重新判定</b>。
     * 提交前先比对 {@code dict_version}：预检之后词表被别人改过就返回
     * {@code KB_SYNONYM_IMPORT_STALE(40930)}，让管理员重新预检——
     * 拿着一份已经过期的计划去写库，报告上写「新增 12 组」实际可能只成 8 组，
     * 那份报告就成了谎报。
     *
     * @param request 提交请求（token + 同名规范词的处置策略）
     * @return 执行结果计数
     */
    @PostMapping("/import/commit")
    public Result<SynonymImportCommitVO> commit(
            @Valid @RequestBody SynonymImportCommitRequest request) {
        return Result.ok(importService.commit(
                request.token(), request.mergeExisting(), currentUserId()));
    }

    /**
     * 导入阶段三 · 下载未导入行（WD-04）。
     *
     * <p>按原始上传格式回吐被跳过的行 + 跳过原因列，管理员改完可直接再传一次。
     * 这是「跳过而非整批回滚」这个产品决策的第 3 条前置条件。
     *
     * @param batchId 批次 ID
     * @return 文件载荷
     */
    @GetMapping("/import/{batchId}/rejected")
    public Result<SynonymFileVO> rejectedRows(@PathVariable Long batchId) {
        return Result.ok(importService.rejectedRows(batchId, currentUserId()));
    }

    // ------------------------------------------------------------------ 内部

    /**
     * 当前操作人。
     *
     * <p>取自 Gateway/BFF 透传的 {@code X-User-Id}（由 {@code SecurityContextHolder} 承载），
     * 不读请求体。无上下文时返回 {@code null}，由服务层按「系统操作」记账。
     *
     * @return 用户 ID；无上下文时 {@code null}
     */
    private Long currentUserId() {
        return SecurityContextHolder.getOptional().map(LoginUser::getUserId).orElse(null);
    }
}
