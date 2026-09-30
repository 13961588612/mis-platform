package com.mis.iqd.api.controller;

import com.mis.common.core.result.Result;
import com.mis.iqd.api.dto.IqdDbProfileSaveRequest;
import com.mis.iqd.api.dto.IqdDbProfileVO;
import com.mis.iqd.domain.entity.IqdDbProfile;
import com.mis.iqd.domain.repository.IqdDbProfileRepository;
import com.mis.iqd.domain.service.IqdDbProfileService;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 数据库连接配置（Tab① = wren profile 平台登记）管理面。
 *
 * <p>路径 {@code /api/v1/iqd/db-profiles/**}，对外由 BFF 代理（默认复用 {@code iqd:config:*}
 * 权限码）。与「项目（= wren context）」分层：本控制器只管业务库连接。
 */
@RestController
@RequestMapping("/api/v1/iqd/db-profiles")
public class IqdDbProfileController {

    private final IqdDbProfileService profileService;
    private final IqdDbProfileRepository profileRepository;

    public IqdDbProfileController(
            IqdDbProfileService profileService,
            IqdDbProfileRepository profileRepository) {
        this.profileService = profileService;
        this.profileRepository = profileRepository;
    }

    /** 清单（密码恒不回显）。 */
    @GetMapping
    public Result<List<IqdDbProfileVO>> list() {
        return Result.ok(profileService.listProfiles());
    }

    /** 单条。 */
    @GetMapping("/{id}")
    public Result<IqdDbProfileVO> get(@PathVariable Long id) {
        return Result.ok(profileService.getProfile(id));
    }

    /** 新建。 */
    @PostMapping
    public Result<IqdDbProfileVO> create(@RequestBody IqdDbProfileSaveRequest dto) {
        return Result.ok(profileService.saveProfile(null, dto));
    }

    /** 按 id 更新。 */
    @PutMapping("/{id}")
    public Result<IqdDbProfileVO> update(
            @PathVariable Long id,
            @RequestBody IqdDbProfileSaveRequest dto) {
        return Result.ok(profileService.saveProfile(id, dto));
    }

    /** 删除（被 project 引用时 42200 + data.dependents）。 */
    @DeleteMapping("/{id}")
    public Result<Map<String, Object>> delete(@PathVariable Long id) {
        return Result.ok(profileService.deleteProfile(id));
    }

    /**
     * 取连接凭证引用 + 坐标（**服务端内部编排专用**：供 BFF 驱动 ai-platform 直连测试）。
     *
     * <p>仅回 {@code secret_ref} 与**非敏感坐标**，绝不回密码（密码在 ai-platform vault）。
     */
    @GetMapping("/{id}/credentials")
    public Result<Map<String, Object>> credentials(@PathVariable Long id) {
        IqdDbProfile p = profileRepository.findById(id)
                .orElseThrow(() -> new com.mis.common.core.exception.BusinessException(
                        com.mis.common.core.exception.ResultCode.NOT_FOUND,
                        "数据库连接配置不存在: " + id));
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("profile_id", p.getId());
        m.put("secret_ref", p.getSecretRef());
        m.put("db_type", p.getDbType());
        m.put("host", p.getDbHost());
        m.put("port", p.getDbPort());
        m.put("database", p.getDbDatabase());
        m.put("user", p.getDbUser());
        return Result.ok(m);
    }

    /**
     * 回写连通性测试结果（BFF 调 ai-platform 直连业务库后回调本端点）。
     */
    @PostMapping("/{id}/test-result")
    public Result<IqdDbProfileVO> reportTest(
            @PathVariable Long id,
            @RequestParam boolean ok,
            @RequestParam(required = false) String message) {
        return Result.ok(profileService.reportTest(id, ok, message));
    }
}
