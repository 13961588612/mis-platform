package com.mis.kb.engine;

import com.mis.kb.domain.repository.KbDocumentRepository;
import com.mis.kb.domain.repository.KbLibraryRepository;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.client.RestClient;

/**
 * 引擎适配器选择器（S-04）。
 *
 * <p>按 {@code mis.kb.engine.type} 选择 {@link KnowledgeEnginePort} 实现：
 * <ul>
 *   <li>{@code ragflow} → {@link RagflowAdapter}（真实 HTTP）</li>
 *   <li>{@code mock} → {@link MockAdapter}（CI 假数据）</li>
 *   <li>其他/未配置 → {@link NoopAdapter}（无引擎也能跑通主流程）</li>
 * </ul>
 *
 * <p>顺带承担 {@code engine} 包下配置类的注册：除引擎自身的 {@link RagflowProperties}，
 * Wave D 的 {@link SynonymProperties}（{@code mis.kb.synonym.*}）也在此登记，
 * 避免为一个配置类单开一个 {@code @Configuration}。
 */
@Configuration
@EnableConfigurationProperties({RagflowProperties.class, SynonymProperties.class})
public class EngineAdapterSelector {

    @Bean
    public KnowledgeEnginePort knowledgeEnginePort(
            RagflowProperties props,
            RestClient.Builder restClientBuilder,
            KbLibraryRepository libraryRepository,
            KbDocumentRepository documentRepository) {
        String type = props.getType() == null ? "noop" : props.getType();
        return switch (type) {
            case "ragflow" ->
                    new RagflowAdapter(props, restClientBuilder, libraryRepository, documentRepository);
            case "mock" -> new MockAdapter();
            default -> new NoopAdapter();
        };
    }
}
