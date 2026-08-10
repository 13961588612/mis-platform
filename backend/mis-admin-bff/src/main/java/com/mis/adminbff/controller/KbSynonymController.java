package com.mis.adminbff.controller;

import com.mis.adminbff.dto.kb.KbSynonymConfigUpdateRequest;
import com.mis.adminbff.dto.kb.KbSynonymConfigVO;
import com.mis.adminbff.dto.kb.KbSynonymFileVO;
import com.mis.adminbff.dto.kb.KbSynonymGroupSaveRequest;
import com.mis.adminbff.dto.kb.KbSynonymGroupSnapshot;
import com.mis.adminbff.dto.kb.KbSynonymGroupVO;
import com.mis.adminbff.dto.kb.KbSynonymImportCommitRequest;
import com.mis.adminbff.dto.kb.KbSynonymImportCommitVO;
import com.mis.adminbff.dto.kb.KbSynonymImportPrecheckVO;
import com.mis.adminbff.service.KbSynonymFacadeService;
import com.mis.common.core.result.PageResult;
import com.mis.common.core.result.Result;
import com.mis.common.web.audit.OperLog;
import jakarta.validation.Valid;
import org.springframework.core.io.ByteArrayResource;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
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

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;

/**
 * 同义词与术语表 BFF 端点（S-07，Wave D / T10）。
 *
 * <p><b>为什么独立成类而不并入 {@code KbController}</b>：后者已 700+ 行、覆盖分类/知识库/
 * 文档/ACL/问答/运营/工单/引擎八个子域。同义词是自成一体的第九个子域，
 * 塞进去只会让那个文件继续朝「谁都不敢动」的方向长。
 *
 * <h2>路径必须与 {@code sys_api} 注册表逐字一致</h2>
 * V18 登记了 11 行 {@code sys_api}（91062–91072）。BFF 配的是
 * {@code api-permission.deny-unmapped: false}（未映射即放行），
 * 这意味着<b>路径写错不会 404，而是「悄悄不判权」</b>——一个不报错的越权口子，
 * 比直接报错危险得多。因此：
 * <ul>
 *   <li>列表与新建用<b>裸</b> {@code @GetMapping} / {@code @PostMapping}（不写 {@code "/"}）。
 *       写成 {@code "/"} 会映射到 {@code /api/v1/kb/synonyms/}（带尾斜杠），
 *       与注册表里的 {@code /api/v1/kb/synonyms} 对不上；</li>
 *   <li>ID 类路径一律显式写 {@code {id:[0-9]+}} 正则，与注册表的
 *       {@code /api/v1/kb/synonyms/{id:[0-9]+}} 完全同形。</li>
 * </ul>
 *
 * <h2>{@code /config} 与 {@code /export} 不会被 {@code /{id}} 抢走</h2>
 * 两道保险，各自独立成立：
 * <ol>
 *   <li><b>本类的正则约束</b>：{@code {id:[0-9]+}} 只接受纯数字段，
 *       {@code config} / {@code export} 压根不匹配，与优先级规则无关；</li>
 *   <li><b>Spring 的模式优先级</b>：{@code PathPattern} 判定字面量段优于变量段，
 *       即便不加正则也是 {@code /config} 胜出。</li>
 * </ol>
 * 只靠第 2 条是有风险的——它对<b>请求路由</b>成立，却不影响
 * {@code ApiPermissionRegistry} 那边基于 {@code AntPathMatcher} 的<b>判权匹配</b>：
 * 若这里写成宽松的 {@code {id}}，{@code GET /api/v1/kb/synonyms/config} 在判权时
 * 仍可能先撞上 {@code {id:[0-9]+}} 之外的某条规则。写死正则才是真正的隔离。
 *
 * <h2>判权走主路径，不写 {@code @PreAuthorize}</h2>
 * 三档权限码 {@code kb:config:synonym:view|write|import} 由
 * {@code ApiPermissionInterceptor} + {@code sys_api} 注册表判定（设计 §7.2）。
 * 在这里再写一遍注解式判权，就成了两个真值来源——改权限时漏改一处，
 * 表现是「菜单上收了权限但接口还能调」。
 *
 * <h2>⚠ 40927 冲突明细必须原样透出</h2>
 * 术语冲突时下游返回 {@code Result{code:40927, data:{term, ownerGroupId, ownerCanonicalTerm}}}。
 * 本类<b>不 catch 任何业务异常</b>：明细由 {@code KbWebClient.resolveSynonym}
 * 装进 {@code BusinessException.data}，再由全局异常处理器写回响应体。
 * 中途 catch 一次就得自己重新组装，明细必丢，前端的「指名道姓」提示当场降级成
 * 一个没有意义的 {@code #-}。
 */
@RestController
@RequestMapping("/api/v1/kb/synonyms")
public class KbSynonymController {

    private final KbSynonymFacadeService facade;

    public KbSynonymController(KbSynonymFacadeService facade) {
        this.facade = facade;
    }

    // ---------------------------------------------------------------- 术语组 CRUD

    /**
     * 术语组分页列表（{@code kb:config:synonym:view}）。
     *
     * @param keyword 关键词，同时匹配规范词与别名，大小写不敏感
     * @param status  1 启用 / 0 停用；不传为全部
     * @param page    页码，从 1 开始
     * @param size    每页条数
     * @param sort    排序表达式，原样透传
     * @return 分页结果
     */
    @GetMapping
    public Result<PageResult<KbSynonymGroupVO>> list(
            @RequestParam(required = false) String keyword,
            @RequestParam(required = false) Integer status,
            @RequestParam(required = false) Integer page,
            @RequestParam(required = false) Integer size,
            @RequestParam(required = false) String sort) {
        return Result.ok(facade.listGroups(keyword, status, page, size, sort));
    }

    /**
     * 术语组详情（{@code kb:config:synonym:view}）。
     *
     * @param id 组 ID
     * @return 详情视图，含完整词条列表
     */
    @GetMapping("/{id:[0-9]+}")
    public Result<KbSynonymGroupVO> get(@PathVariable Long id) {
        return Result.ok(facade.getGroup(id));
    }

    /**
     * 新建术语组（{@code kb:config:synonym:write}）。
     *
     * <p>{@code terms} 是<b>别名</b>列表、不含规范词，且顺序即语义。
     * 冲突（40927）由 mis-kb 裁定，明细原样上抛。
     *
     * @param body 保存请求
     * @return 新建后的详情
     */
    @PostMapping
    @OperLog(module = "知识库", operation = "新增术语组", recordParams = true)
    public Result<KbSynonymGroupVO> create(@Valid @RequestBody KbSynonymGroupSaveRequest body) {
        return Result.ok(facade.createGroup(body));
    }

    /**
     * 编辑术语组（{@code kb:config:synonym:write}）。冲突语义同 {@link #create}。
     *
     * @param id   组 ID
     * @param body 保存请求
     * @return 保存后的详情
     */
    @PutMapping("/{id:[0-9]+}")
    @OperLog(module = "知识库", operation = "编辑术语组", recordParams = true)
    public Result<KbSynonymGroupVO> update(
            @PathVariable Long id, @Valid @RequestBody KbSynonymGroupSaveRequest body) {
        return Result.ok(facade.updateGroup(id, body));
    }

    /**
     * 删除术语组（{@code kb:config:synonym:write}）。硬删，级联删词条。
     *
     * <p><b>本方法上没有 {@code @OperLog}，不是漏了。</b>设计 §7.7 要求硬删必须在操作日志里
     * 落<b>删除前快照</b>，而 {@code OperLogAspect} 只序列化方法入参——挂在这里
     * 记下的只有 {@code {"id":42}}，硬删之后再也无从知道这组原本叫什么、有哪些别名。
     * 因此注解下沉到
     * {@link KbSynonymFacadeService#deleteGroup(Long, KbSynonymGroupSnapshot)}，
     * 由它以快照为入参接收；Controller → 门面是跨 Bean 调用，代理生效，
     * 审计记录的 {@code requestUri} / {@code requestMethod} 仍是本端点的
     * {@code DELETE /api/v1/kb/synonyms/{id}}，人工检索时看不出差别。
     *
     * <p>快照先取、再删：取不到（组不存在）时下游返回 40415，
     * 用户看到「术语组不存在」，而不是一次静默成功的空删除。
     *
     * @param id 组 ID
     * @return 空结果
     */
    @DeleteMapping("/{id:[0-9]+}")
    public Result<Void> delete(@PathVariable Long id) {
        KbSynonymGroupSnapshot snapshot = facade.loadDeleteSnapshot(id);
        facade.deleteGroup(id, snapshot);
        return Result.ok();
    }

    // ---------------------------------------------------------------- 全局配置

    /**
     * 读取同义词全局配置（{@code kb:config:synonym:view}）。
     *
     * <p>{@code effective = enabled && killSwitchEnabled} 由 mis-kb 算好下发，
     * 本层不重算——两份真值来源迟早会有一份开始撒谎。
     *
     * @return 配置视图
     */
    @GetMapping("/config")
    public Result<KbSynonymConfigVO> getConfig() {
        return Result.ok(facade.getConfig());
    }

    /**
     * 切换库内业务开关（{@code kb:config:synonym:write}）。
     *
     * <p>只写 {@code enabled}。Nacos 熔断闸 {@code killSwitchEnabled} 不在此处开写口——
     * 业务侧能一键关掉运维的兜底开关，那就不叫熔断闸了。
     *
     * @param body 开关请求
     * @return 切换后的配置视图
     */
    @PutMapping("/config")
    @OperLog(module = "知识库", operation = "切换同义词全局开关", recordParams = true)
    public Result<KbSynonymConfigVO> updateConfig(
            @Valid @RequestBody KbSynonymConfigUpdateRequest body) {
        return Result.ok(facade.updateConfig(body));
    }

    // ---------------------------------------------------------------- 导入 / 导出

    /**
     * 导出词表（{@code kb:config:synonym:import}）。
     *
     * <p>归 {@code import} 档而非 {@code view}：导出是把整份「企业内部黑话字典」打包带走，
     * 敏感度显著高于翻页浏览（设计 §8.3）。
     *
     * <p>直吐字节流，前端按 {@code responseType: 'blob'} 接。
     * 内容是下游给的成品文本（CSV 已含 BOM），<b>此处不再加工</b>。
     *
     * @param keyword 关键词过滤
     * @param status  状态过滤
     * @param format  {@code CSV} / {@code JSON}；缺省 CSV
     * @return 文件下载响应
     */
    @GetMapping("/export")
    public ResponseEntity<ByteArrayResource> export(
            @RequestParam(required = false) String keyword,
            @RequestParam(required = false) Integer status,
            @RequestParam(required = false) String format) {
        return download(facade.export(keyword, status, format));
    }

    /**
     * 导入阶段一 · 预检（{@code kb:config:synonym:import}）。
     *
     * <p>不写任何词表数据，只产出计划与报告。multipart 原样透传，<b>BFF 不解析文件</b>。
     *
     * <p>审计说明：{@code OperLogAspect} 会跳过 {@code MultipartFile} 入参
     * （既序列化不了，记了也没信息量），因此本条 {@code request_params}
     * 落的是结果条数而非文件名；文件名与字节数由门面写应用日志。
     *
     * @param file 上传文件（CSV 或 JSON）
     * @return 预检报告，含 token / batchId / 逐行明细
     */
    @PostMapping("/import/precheck")
    @OperLog(module = "知识库", operation = "同义词导入预检", recordParams = true)
    public Result<KbSynonymImportPrecheckVO> precheck(@RequestParam("file") MultipartFile file) {
        return Result.ok(facade.precheck(file));
    }

    /**
     * 导入阶段二 · 提交（{@code kb:config:synonym:import}）。
     *
     * <p>下游会先比对 {@code dict_version}：预检之后词表被别人改过即返回 40930
     * 「词表已变更，请重新预检」。本层不做任何重试或兜底——
     * 拿一份过期计划去写库，报告上的数字就成了谎报。
     *
     * @param body 提交请求（token + 同名规范词处置策略）
     * @return 执行计数
     */
    @PostMapping("/import/commit")
    @OperLog(module = "知识库", operation = "同义词导入提交", recordParams = true)
    public Result<KbSynonymImportCommitVO> commit(
            @Valid @RequestBody KbSynonymImportCommitRequest body) {
        return Result.ok(facade.commit(body));
    }

    /**
     * 导入阶段三 · 下载未导入行（{@code kb:config:synonym:import}）。
     *
     * <p>按原始上传格式回吐被跳过的行 + 跳过原因列，管理员改完可直接再传一次。
     *
     * @param batchId 批次 ID
     * @return 文件下载响应
     */
    @GetMapping("/import/{batchId:[0-9]+}/rejected")
    public ResponseEntity<ByteArrayResource> rejected(@PathVariable Long batchId) {
        return download(facade.rejectedRows(batchId));
    }

    // ---------------------------------------------------------------- 内部

    /**
     * 把下游文件载荷落成 HTTP 下载响应。
     *
     * <p>{@code Content-Disposition} 同时给 {@code filename} 与 {@code filename*}：
     * 前者是 ASCII 兜底，后者带 RFC 5987 编码，中文文件名在各家浏览器都能正确落盘。
     * 写法与 {@code KbController.exportCsv} 保持一致。
     *
     * @param file 文件载荷
     * @return 下载响应
     */
    private static ResponseEntity<ByteArrayResource> download(KbSynonymFileVO file) {
        byte[] bytes = file.bytes();
        String filename = file.filenameOrFallback();
        String encoded = URLEncoder.encode(filename, StandardCharsets.UTF_8).replace("+", "%20");
        return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_DISPOSITION,
                        "attachment; filename=\"" + filename + "\"; filename*=UTF-8''" + encoded)
                .contentType(MediaType.parseMediaType(file.contentTypeOrFallback()))
                .contentLength(bytes.length)
                .body(new ByteArrayResource(bytes));
    }
}
