package com.mis.taskflow.service;

import com.mis.common.core.exception.BusinessException;
import com.mis.common.core.exception.ResultCode;
import com.mis.taskflow.config.MessageStorageProperties;
import com.mis.taskflow.domain.entity.SysMessageFile;
import com.mis.taskflow.domain.repository.SysMessageFileRepository;
import com.mis.taskflow.domain.repository.SysMessageReceiverRepository;
import com.mis.taskflow.dto.MessageFileVO;
import com.mis.taskflow.support.IdGenerator;
import io.minio.BucketExistsArgs;
import io.minio.GetObjectArgs;
import io.minio.MakeBucketArgs;
import io.minio.MinioClient;
import io.minio.PutObjectArgs;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.io.ByteArrayInputStream;
import java.time.LocalDateTime;
import java.time.YearMonth;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Set;

/**
 * 消息附件与正文图片：元数据在 {@code sys_message_file}，对象在 MinIO。
 */
@Service
public class MessageFileService {

    private static final Logger log = LoggerFactory.getLogger(MessageFileService.class);

    public static final long MAX_BYTES = 20L * 1024 * 1024;
    public static final int MAX_ATTACHMENTS = 10;

    private static final Set<String> IMAGES = Set.of("image/png", "image/jpeg", "image/gif", "image/webp");
    private static final Set<String> FILES = Set.of(
            "image/png", "image/jpeg", "image/gif", "image/webp",
            "application/pdf",
            "application/msword",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "application/vnd.ms-excel",
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "application/vnd.ms-powerpoint",
            "application/vnd.openxmlformats-officedocument.presentationml.presentation",
            "application/zip",
            "text/plain");

    private final SysMessageFileRepository fileRepository;
    private final SysMessageReceiverRepository receiverRepository;
    private final MinioClient minioClient;
    private final MessageStorageProperties storage;

    public MessageFileService(SysMessageFileRepository fileRepository,
                              SysMessageReceiverRepository receiverRepository,
                              MinioClient minioClient,
                              MessageStorageProperties storage) {
        this.fileRepository = fileRepository;
        this.receiverRepository = receiverRepository;
        this.minioClient = minioClient;
        this.storage = storage;
    }

    @Transactional
    public MessageFileVO upload(Long tenantId, Long userId, String kind, String originalName, String contentType, byte[] bytes) {
        if (tenantId == null || userId == null) {
            throw new BusinessException(ResultCode.VALIDATION_ERROR, "租户或上传人不能为空");
        }
        if (bytes == null || bytes.length == 0) {
            throw new BusinessException(ResultCode.VALIDATION_ERROR, "文件不能为空");
        }
        if (bytes.length > MAX_BYTES) {
            throw new BusinessException(ResultCode.VALIDATION_ERROR, "单个文件不能超过 20MB");
        }
        String mime = normalizeMime(contentType);
        Set<String> allowed = "image".equalsIgnoreCase(kind) ? IMAGES : FILES;
        if (!allowed.contains(mime)) {
            throw new BusinessException(ResultCode.VALIDATION_ERROR, "不支持的文件类型");
        }
        String name = sanitizeName(originalName);
        Long id = IdGenerator.nextId();
        YearMonth ym = YearMonth.now();
        String key = tenantId + "/" + ym.getYear() + "/" + String.format("%02d", ym.getMonthValue()) + "/" + id;
        putObject(key, bytes, mime);

        SysMessageFile row = new SysMessageFile();
        row.setId(id);
        row.setTenantId(tenantId);
        row.setObjectKey(key);
        row.setFileName(name);
        row.setMime(mime);
        row.setSizeBytes((long) bytes.length);
        row.setCreatedBy(userId);
        row.setCreatedAt(LocalDateTime.now());
        fileRepository.save(row);
        return new MessageFileVO(String.valueOf(id), name, bytes.length, mime);
    }

    @Transactional(readOnly = true)
    public SysMessageFile requireReadable(Long tenantId, Long fileId, Long userId) {
        SysMessageFile file = fileRepository.findByIdAndTenantId(fileId, tenantId)
                .orElseThrow(() -> new BusinessException(ResultCode.NOT_FOUND, "文件不存在"));
        if (userId != null && userId.equals(file.getCreatedBy())) {
            return file;
        }
        if (file.getMessageId() != null && userId != null
                && receiverRepository.findByMessageIdAndUserId(file.getMessageId(), userId).isPresent()) {
            return file;
        }
        throw new BusinessException(ResultCode.FORBIDDEN, "无权下载该文件");
    }

    public byte[] readBytes(SysMessageFile file) {
        try (var in = minioClient.getObject(GetObjectArgs.builder()
                .bucket(storage.getBucket())
                .object(file.getObjectKey())
                .build())) {
            return in.readAllBytes();
        } catch (Exception ex) {
            throw new BusinessException(ResultCode.INTERNAL_ERROR, "读取文件失败");
        }
    }

    /**
     * 发送时绑定附件与正文图片。文件必须属于发送人且尚未挂到其他消息。
     */
    @Transactional
    public void bind(Long tenantId, Long senderId, Long messageId, List<Long> fileIds) {
        List<SysMessageFile> files = requireOwned(tenantId, senderId, fileIds);
        for (SysMessageFile file : files) {
            file.setMessageId(messageId);
        }
        if (!files.isEmpty()) {
            fileRepository.saveAll(files);
        }
    }

    /** 校验文件属于发送人且未绑定消息，按入参顺序返回。 */
    @Transactional(readOnly = true)
    public List<SysMessageFile> requireOwned(Long tenantId, Long senderId, List<Long> fileIds) {
        if (fileIds == null || fileIds.isEmpty()) {
            return List.of();
        }
        List<Long> distinct = fileIds.stream().distinct().toList();
        var found = fileRepository.findByTenantIdAndIdIn(tenantId, distinct).stream()
                .collect(java.util.stream.Collectors.toMap(SysMessageFile::getId, f -> f));
        if (found.size() != distinct.size()) {
            throw new BusinessException(ResultCode.VALIDATION_ERROR, "附件不存在或不属于当前租户");
        }
        List<SysMessageFile> ordered = new ArrayList<>();
        for (Long id : distinct) {
            SysMessageFile file = found.get(id);
            if (!senderId.equals(file.getCreatedBy())) {
                throw new BusinessException(ResultCode.FORBIDDEN, "不能使用他人上传的文件");
            }
            if (file.getMessageId() != null) {
                throw new BusinessException(ResultCode.VALIDATION_ERROR, "文件已用于其他消息");
            }
            ordered.add(file);
        }
        return ordered;
    }

    private void putObject(String key, byte[] bytes, String mime) {
        try {
            String bucket = storage.getBucket();
            boolean exists = minioClient.bucketExists(BucketExistsArgs.builder().bucket(bucket).build());
            if (!exists) {
                minioClient.makeBucket(MakeBucketArgs.builder().bucket(bucket).build());
            }
            minioClient.putObject(PutObjectArgs.builder()
                    .bucket(bucket)
                    .object(key)
                    .stream(new ByteArrayInputStream(bytes), bytes.length, -1)
                    .contentType(mime)
                    .build());
        } catch (Exception ex) {
            log.error("MinIO putObject failed: bucket={}, key={}, endpoint配置见 mis.message.storage",
                    storage.getBucket(), key, ex);
            throw new BusinessException(ResultCode.INTERNAL_ERROR, "上传到对象存储失败");
        }
    }

    private static String normalizeMime(String contentType) {
        if (contentType == null || contentType.isBlank()) {
            return "";
        }
        String mime = contentType.toLowerCase(Locale.ROOT).trim();
        int semi = mime.indexOf(';');
        return semi > 0 ? mime.substring(0, semi).trim() : mime;
    }

    private static String sanitizeName(String originalName) {
        String name = originalName == null ? "file" : originalName.trim();
        name = name.replace("\\", "/");
        int slash = name.lastIndexOf('/');
        if (slash >= 0) {
            name = name.substring(slash + 1);
        }
        if (name.isBlank()) {
            name = "file";
        }
        return name.length() > 256 ? name.substring(name.length() - 256) : name;
    }
}
