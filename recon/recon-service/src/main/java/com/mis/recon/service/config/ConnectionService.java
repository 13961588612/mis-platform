package com.mis.recon.service.config;

import com.mis.recon.common.BizException;
import com.mis.recon.common.ErrorCode;
import com.mis.recon.common.PageResult;
import com.mis.recon.domain.config.ReconConnection;
import com.mis.recon.domain.config.ReconDatasource;
import com.mis.recon.domain.dto.ConnectionSaveReq;
import com.mis.recon.domain.enums.ConfigEnums.ConnectionType;
import com.mis.recon.repository.ConnectionRepository;
import com.mis.recon.repository.DatasourceRepository;
import com.mis.recon.service.support.ConnectionPoolManager;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.stream.Collectors;

/**
 * 连接配置服务（F77）。
 */
@Service
@RequiredArgsConstructor
public class ConnectionService {

    private final ConnectionRepository connectionRepository;
    private final DatasourceRepository datasourceRepository;
    private final ConfigValidationService configValidationService;
    private final ConnectionPoolManager connectionPoolManager;

    public PageResult<ReconConnection> page(PageRequest pageable, String keyword, Integer enabled) {
        Page<ReconConnection> page = connectionRepository.search(keyword, enabled, pageable);
        return PageResult.from(page);
    }

    public ReconConnection get(String connCode) {
        return connectionRepository.findByConnCode(connCode)
                .orElseThrow(() -> new BizException(ErrorCode.CONN_NOT_FOUND));
    }

    public ReconConnection save(ConnectionSaveReq req) {
        if (configValidationService.existsConnCode(req.getConnCode())) {
            throw new BizException(ErrorCode.CONN_CODE_EXISTS);
        }
        ConnectionType.from(req.getType());
        ReconConnection entity = new ReconConnection();
        entity.setConnCode(req.getConnCode());
        apply(entity, req);
        return connectionRepository.save(entity);
    }

    public ReconConnection update(String connCode, ConnectionSaveReq req) {
        ReconConnection entity = connectionRepository.findByConnCode(connCode)
                .orElseThrow(() -> new BizException(ErrorCode.CONN_NOT_FOUND));
        if (!connCode.equals(req.getConnCode())) {
            throw new BizException(ErrorCode.CONN_NOT_FOUND, "连接编码创建后不可修改，路径为准");
        }
        ConnectionType.from(req.getType());
        apply(entity, req);
        return connectionRepository.save(entity);
    }

    public void delete(String connCode) {
        ReconConnection existing = connectionRepository.findByConnCode(connCode)
                .orElseThrow(() -> new BizException(ErrorCode.CONN_NOT_FOUND));
        List<ReconDatasource> refs = datasourceRepository.findByConnCode(connCode);
        if (!refs.isEmpty()) {
            String dsCodes = refs.stream().map(ReconDatasource::getDsCode).collect(Collectors.joining(", "));
            throw new BizException(ErrorCode.CONN_REFERENCED,
                    "连接已被数据源 ds_code=" + dsCodes + " 引用，无法删除");
        }
        connectionRepository.deleteById(existing.getId());
    }

    public void testConnection(String connCode) {
        ReconConnection conn = connectionRepository.findByConnCode(connCode)
                .orElseThrow(() -> new BizException(ErrorCode.CONN_NOT_FOUND));
        connectionPoolManager.testConnection(conn);
    }

    private void apply(ReconConnection entity, ConnectionSaveReq req) {
        entity.setName(req.getName());
        entity.setType(req.getType());
        entity.setJdbcUrl(req.getJdbcUrl());
        entity.setUsername(req.getUsername());
        entity.setPassword(req.getPassword());
        entity.setPropsJson(req.getPropsJson());
        entity.setDbTimezone(req.getDbTimezone());
        entity.setFetchOverlapSec(req.getFetchOverlapSec() == null ? 300 : req.getFetchOverlapSec());
        entity.setClockProbeSql(req.getClockProbeSql());
        entity.setJdbcPropsLocked(req.getJdbcPropsLocked());
        entity.setEnabled(Boolean.TRUE.equals(req.getEnabled()) ? 1 : 0);
    }
}
