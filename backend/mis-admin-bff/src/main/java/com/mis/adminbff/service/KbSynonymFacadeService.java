package com.mis.adminbff.service;

import com.mis.adminbff.client.KbWebClient;
import com.mis.adminbff.dto.kb.KbSynonymConfigUpdateRequest;
import com.mis.adminbff.dto.kb.KbSynonymConfigVO;
import com.mis.adminbff.dto.kb.KbSynonymFileVO;
import com.mis.adminbff.dto.kb.KbSynonymGroupSaveRequest;
import com.mis.adminbff.dto.kb.KbSynonymGroupSnapshot;
import com.mis.adminbff.dto.kb.KbSynonymGroupVO;
import com.mis.adminbff.dto.kb.KbSynonymImportCommitRequest;
import com.mis.adminbff.dto.kb.KbSynonymImportCommitVO;
import com.mis.adminbff.dto.kb.KbSynonymImportPrecheckVO;
import com.mis.common.core.exception.BusinessException;
import com.mis.common.core.exception.ResultCode;
import com.mis.common.core.result.PageResult;
import com.mis.common.web.audit.OperLog;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * 同义词与术语表聚合门面（Wave D / T10）。
 *
 * <p>把前端 {@code /api/v1/kb/synonyms/**} 编排到 mis-kb 的
 * {@code /internal/v1/kb/synonyms/**}。<b>本层不做业务判断</b>：
 * 词条冲突（40927）、导入格式（40928）、体量超限（40929）、计划过期（40930）、
 * 令牌失效（40931）全部由 mis-kb 裁定——规则只有一个定义点，才不会两边各判一次然后互相打架。
 *
 * <p><b>为什么保留这一层而不让 Controller 直调 {@link KbWebClient}：</b>
 * 三个理由，任一单独看都不足以立层，合起来足够：
 * <ol>
 *   <li><b>与既有分层一致</b>——{@code KbController} → {@code KbFacadeService} → {@code KbWebClient}
 *       是本模块既定惯例，同义词单开一条「Controller 直连 Client」的支线，
 *       会让下一个人先花时间搞清楚为什么这块不一样；</li>
 *   <li><b>Controller 之外唯一能放「取字节 + 体量守卫」的地方</b>——multipart 读字节
 *       （{@link #precheck}）有 IO 异常与内存风险要处理，塞进 Controller 就把
 *       HTTP 适配和资源管理揉成一团；</li>
 *   <li><b>删除前快照必须落在一次<u>跨 Bean</u>调用上</b>（见 {@link #deleteGroup}）——
 *       这是 {@code @OperLog} 能拿到快照的<b>唯一</b>位置，Controller 内部自调用不走代理，
 *       注解根本不触发。</li>
 * </ol>
 */
@Service
public class KbSynonymFacadeService {

    private static final Logger log = LoggerFactory.getLogger(KbSynonymFacadeService.class);

    /**
     * 导入文件读入内存的硬上限（8MB）。
     *
     * <p><b>这不是业务规则，是内存守卫。</b>真正的导入体量上限是
     * {@code mis.kb.synonym.import-max-bytes}（默认 2MB，超出即 40929），由 mis-kb 裁定并
     * 给出带文案的业务错误。此处只拦「大到会威胁 BFF 堆内存」的输入，
     * 阈值刻意留出数倍余量：让绝大多数超限请求走到下游、拿回那句
     * 能指导用户下一步的业务提示，而不是在这里被一句笼统的「文件过大」截胡。
     */
    private static final long MAX_IMPORT_BYTES = 8L * 1024 * 1024;

    private final KbWebClient kbWebClient;

    public KbSynonymFacadeService(KbWebClient kbWebClient) {
        this.kbWebClient = kbWebClient;
    }

    // ---------------------------------------------------------------- 术语组 CRUD

    /**
     * 术语组分页列表（服务端分页 + 服务端搜索）。
     *
     * <p>{@code sort} 原样透传：当前 mis-kb 侧固定按 {@code id} 排序、忽略该参数，
     * 但前端契约里带了它，在这里丢掉的话，将来下游支持排序时会出现
     * 「前端传了、后端没收到」这种最难查的一类问题。
     *
     * @param keyword 关键词，同时匹配规范词与别名
     * @param status  1 启用 / 0 停用；{@code null} 为全部
     * @param page    页码，从 1 开始（平台统一契约）
     * @param size    每页条数
     * @param sort    排序表达式
     * @return 分页结果；下游异常返回空时收敛为空页
     */
    public PageResult<KbSynonymGroupVO> listGroups(
            String keyword, Integer status, Integer page, Integer size, String sort) {
        Map<String, Object> params = new LinkedHashMap<>();
        params.put("keyword", keyword);
        params.put("status", status);
        params.put("page", page);
        params.put("size", size);
        params.put("sort", sort);
        PageResult<KbSynonymGroupVO> result = kbWebClient.listSynonymGroups(params);
        return result != null
                ? result
                : PageResult.empty(page != null && page > 0 ? page : 1, size != null ? size : 20);
    }

    /**
     * 术语组详情。
     *
     * @param id 组 ID
     * @return 详情视图
     */
    public KbSynonymGroupVO getGroup(Long id) {
        return requireDownstream(kbWebClient.getSynonymGroup(id), "术语组详情");
    }

    /**
     * 新建术语组。
     *
     * @param request 保存请求
     * @return 新建后的详情
     */
    public KbSynonymGroupVO createGroup(KbSynonymGroupSaveRequest request) {
        return requireDownstream(kbWebClient.createSynonymGroup(request), "新建术语组");
    }

    /**
     * 编辑术语组。
     *
     * @param id      组 ID
     * @param request 保存请求
     * @return 保存后的详情
     */
    public KbSynonymGroupVO updateGroup(Long id, KbSynonymGroupSaveRequest request) {
        return requireDownstream(kbWebClient.updateSynonymGroup(id, request), "编辑术语组");
    }

    /**
     * 读取删除前快照。
     *
     * <p>单独暴露一个方法而不是塞进 {@link #deleteGroup}，是因为快照必须以
     * <b>方法入参</b>的形态出现在被 {@code @OperLog} 拦截的那次调用上——
     * {@code OperLogAspect.collectParams} 读的是 {@code ProceedingJoinPoint.getArgs()}，
     * 只有入参进得了 {@code sys_oper_log.request_params}，返回值和方法内部取到的东西都不行。
     *
     * <p>顺带承担「组不存在就早失败」：先读一次详情，组不在时下游返回 40415，
     * 用户看到的是「术语组不存在」而不是一次静默成功的空删除。
     *
     * @param id 组 ID
     * @return 快照，恒非 {@code null}
     */
    public KbSynonymGroupSnapshot loadDeleteSnapshot(Long id) {
        return KbSynonymGroupSnapshot.from(id, kbWebClient.getSynonymGroup(id));
    }

    /**
     * 删除术语组（硬删，级联删词条）。
     *
     * <p><b>{@code @OperLog} 为什么挂在门面方法上，而不是像其余写端点那样挂在 Controller：</b>
     * 设计 §7.7 要求硬删必须在操作日志里落<b>删除前快照</b>——硬删之后词条随组消失，
     * 快照是唯一的追溯手段，也是当初选择硬删而非软删的前提条件。
     * 而 {@code OperLogAspect} 只能序列化<b>方法入参</b>：
     * Controller 的 {@code delete(Long id)} 签名里除了一个 ID 什么都没有，
     * 挂在那里记下的是 {@code {"id":42}}，等于没记。
     * 把注解下沉到这个接收 {@code snapshot} 的门面方法，
     * Controller → 门面是<b>跨 Bean 调用</b>、走 Spring 代理，注解正常触发，
     * 快照被切面摊平进 {@code request_params}。
     *
     * <p>Controller 内部自调用（先查快照再调本类另一个方法）是行不通的：
     * 自调用不经过代理，注解静默失效——这类「注解写了但没生效」的失败没有任何报错。
     *
     * <p>参数顺序也是刻意的：{@code id} 在前，切面会先按形参名记下 {@code id}，
     * 随后快照对象被<b>摊平覆盖</b>到同名键上，两者取值一致，不会互相矛盾。
     *
     * @param id       组 ID
     * @param snapshot 删除前快照，由 {@link #loadDeleteSnapshot} 预先取得；仅用于留痕，不参与业务
     */
    @OperLog(module = "知识库", operation = "删除术语组", recordParams = true)
    public void deleteGroup(Long id, KbSynonymGroupSnapshot snapshot) {
        kbWebClient.deleteSynonymGroup(id);
        log.info("删除术语组 id={} canonical={} termCount={}",
                id,
                snapshot != null ? snapshot.canonicalTerm() : null,
                snapshot != null && snapshot.terms() != null ? snapshot.terms().size() : 0);
    }

    // ---------------------------------------------------------------- 全局配置

    /**
     * 读取同义词全局配置。
     *
     * @return 配置视图
     */
    public KbSynonymConfigVO getConfig() {
        return requireDownstream(kbWebClient.getSynonymConfig(), "同义词配置");
    }

    /**
     * 切换库内业务开关。
     *
     * @param request 开关请求
     * @return 切换后的配置视图
     */
    public KbSynonymConfigVO updateConfig(KbSynonymConfigUpdateRequest request) {
        return requireDownstream(kbWebClient.updateSynonymConfig(request), "切换同义词开关");
    }

    // ---------------------------------------------------------------- 导入 / 导出

    /**
     * 导出词表。
     *
     * <p>下游给的 {@code content} 已经是<b>成品文本</b>（CSV 场景含 BOM、已做公式注入防护）。
     * 本层只负责把它落成 HTTP 下载响应，<b>不得再加一次 BOM</b>——
     * 加两次的表现是 Excel 首格出现一串乱码前缀，而单元测试全绿。
     *
     * @param keyword 关键词过滤，与列表页同口径
     * @param status  状态过滤
     * @param format  {@code CSV} / {@code JSON}
     * @return 文件载荷
     */
    public KbSynonymFileVO export(String keyword, Integer status, String format) {
        Map<String, Object> params = new LinkedHashMap<>();
        params.put("keyword", keyword);
        params.put("status", status);
        params.put("format", format);
        return requireDownstream(kbWebClient.exportSynonyms(params), "导出词表");
    }

    /**
     * 导入阶段一 · 预检。
     *
     * <p><b>BFF 只做三件事：非空、体量守卫、取字节。</b>格式嗅探、表头校验、别名切分、
     * 冲突判定统统在 mis-kb —— CSV/JSON 语义写两份，改一处漏一处是必然。
     *
     * @param file 上传文件
     * @return 预检报告
     */
    public KbSynonymImportPrecheckVO precheck(MultipartFile file) {
        if (file == null || file.isEmpty()) {
            throw new BusinessException(ResultCode.VALIDATION_ERROR, "请选择要导入的文件");
        }
        if (file.getSize() > MAX_IMPORT_BYTES) {
            throw new BusinessException(ResultCode.VALIDATION_ERROR,
                    "导入文件过大，单个文件不能超过 " + (MAX_IMPORT_BYTES / 1024 / 1024) + "MB");
        }
        byte[] bytes;
        try {
            bytes = file.getBytes();
        } catch (IOException ex) {
            log.warn("读取同义词导入文件失败 filename={}: {}", file.getOriginalFilename(), ex.getMessage());
            throw new BusinessException(ResultCode.INTERNAL_ERROR, "读取上传文件失败，请重新上传");
        }
        log.info("同义词导入预检 filename={} bytes={}", file.getOriginalFilename(), bytes.length);
        return requireDownstream(
                kbWebClient.precheckSynonymImport(
                        file.getOriginalFilename(), file.getContentType(), bytes),
                "导入预检");
    }

    /**
     * 导入阶段二 · 提交。
     *
     * @param request 提交请求
     * @return 执行计数
     */
    public KbSynonymImportCommitVO commit(KbSynonymImportCommitRequest request) {
        return requireDownstream(kbWebClient.commitSynonymImport(request), "导入提交");
    }

    /**
     * 导入阶段三 · 下载未导入行。
     *
     * @param batchId 批次 ID
     * @return 文件载荷
     */
    public KbSynonymFileVO rejectedRows(Long batchId) {
        return requireDownstream(kbWebClient.rejectedSynonymRows(batchId), "下载未导入行");
    }

    // ---------------------------------------------------------------- 内部

    /**
     * 下游返回 {@code null} 视为异常。
     *
     * <p>下游成功码配空 {@code data} 是协议层面的自相矛盾，继续往上传只会让 NPE
     * 在更远的地方炸开、堆栈里再也看不到是哪一跳出的问题。
     *
     * @param value 下游数据
     * @param what  出错文案里的场景名
     * @param <T>   数据类型
     * @return 非空数据
     */
    private static <T> T requireDownstream(T value, String what) {
        if (value == null) {
            throw new BusinessException(ResultCode.INTERNAL_ERROR, what + "失败：下游返回空数据");
        }
        return value;
    }
}
