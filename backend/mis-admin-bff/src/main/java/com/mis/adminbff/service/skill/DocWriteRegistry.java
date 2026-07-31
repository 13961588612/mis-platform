package com.mis.adminbff.service.skill;

import org.springframework.stereotype.Service;

import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * docType → 写处理器 路由（设计 §4.4 / T04）。
 *
 * <p>收集所有 {@link DocWriteHandler} Bean，按 docType 路由到首个 {@code supports} 的处理器；
 * 未命中时返回明确错误（不静默成功）。新增单据类型只需新增一个 {@code @Component} 处理器，
 * 无需改动本类——满足 P1-6 即开即用。
 */
@Service
public class DocWriteRegistry {

    private final List<DocWriteHandler> handlers;

    public DocWriteRegistry(List<DocWriteHandler> handlers) {
        this.handlers = handlers;
    }

    public Optional<DocWriteHandler> resolve(String docType) {
        if (docType == null || docType.isBlank()) {
            return Optional.empty();
        }
        return handlers.stream()
                .filter(h -> h.supports(docType))
                .findFirst();
    }

    public DocWriteResult apply(
            String skillId,
            String docType,
            String docId,
            Map<String, Object> values) {
        return resolve(docType)
                .map(h -> h.apply(skillId, docType, docId, values))
                .orElseGet(() -> DocWriteResult.error(
                        docId, "未配置 docType 的写处理器: " + docType));
    }
}
