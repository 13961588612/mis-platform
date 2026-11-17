package com.mis.recon.service.engine;

import com.mis.recon.common.BizException;
import com.mis.recon.common.ErrorCode;
import com.mis.recon.dao.DetailDao;
import com.mis.recon.dao.DiffHandleDao;
import com.mis.recon.domain.dto.DiffHandleReq;
import com.mis.recon.domain.enums.ResultEnums.HandleStatus;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

/**
 * 差异人工处理服务（T07-spec §6，G30）：写 recon_diff_handle + 更新 recon_detail.handle_status。
 * <p>V4：handle/revert 写入 recon_diff_status_history（handle_status 流转留痕）。</p>
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class DiffHandleService {

    private final DiffHandleDao diffHandleDao;
    private final DetailDao detailDao;

    /** 人工处理一条差异；返回处理记录 id。 */
    public long handle(long detailId, DiffHandleReq req) {
        HandleStatus status = HandleStatus.from(req.getHandleStatus());
        if (status == HandleStatus.unhandled) {
            throw new BizException(ErrorCode.PARAM_ERROR, "处理状态不可为 unhandled");
        }
        DetailDao.DetailRow d = detailDao.findById(detailId);
        if (d == null) {
            throw new BizException(ErrorCode.RESOURCE_NOT_FOUND, "差异不存在");
        }
        long id = diffHandleDao.insert(detailId, status.code(), req.getOperator(), req.getRemark());
        diffHandleDao.updateDetailHandle(detailId, status.code());
        detailDao.insertStatusHistory(detailId, "handle_status",
                d.handleStatus, status.code(), "manual_handle", req.getOperator());
        log.info("[diff][handle] detailId={} -> {} by {} remark={}",
                detailId, status.code(), req.getOperator(), req.getRemark());
        return id;
    }

    /** 回退为未处理（V4）；返回新写入的 diff_handle 记录 id。 */
    public long revert(long detailId, String operator, String remark) {
        DetailDao.DetailRow d = detailDao.findById(detailId);
        if (d == null) {
            throw new BizException(ErrorCode.RESOURCE_NOT_FOUND, "差异不存在");
        }
        if ("unhandled".equals(d.handleStatus)) {
            throw new BizException(ErrorCode.PARAM_ERROR, "当前为未处理，无需回退");
        }
        long id = diffHandleDao.insert(detailId, "unhandled", operator, remark);
        diffHandleDao.revertDetailHandle(detailId);
        detailDao.insertStatusHistory(detailId, "handle_status",
                d.handleStatus, "unhandled", "manual_revert", operator);
        log.info("[diff][revert] detailId={} from {} by {} remark={}",
                detailId, d.handleStatus, operator, remark);
        return id;
    }
}
