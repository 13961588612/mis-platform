package com.mis.adminbff.service.skill;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.mis.adminbff.dto.ai.SkillDefinition;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.core.io.Resource;
import org.springframework.core.io.support.PathMatchingResourcePatternResolver;
import org.springframework.stereotype.Service;

import jakarta.annotation.PostConstruct;
import java.io.IOException;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * 从 classpath 加载 Skill 配置的服务。
 * 启动时扫描 {@code classpath:skills/*.json}，将其反序列化为 {@link SkillDefinition}
 * 并以 skillId 为 key 缓存，提供按 ID 加载和列表查询能力。
 */
@Service
public class SkillLoader {

    private static final Logger log = LoggerFactory.getLogger(SkillLoader.class);

    private static final String SKILL_PATTERN = "classpath:skills/*.json";

    private final ObjectMapper objectMapper;

    /** skillId -> SkillDefinition 缓存。 */
    private final Map<String, SkillDefinition> skills = new ConcurrentHashMap<>();

    public SkillLoader(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
    }

    @PostConstruct
    public void init() {
        loadAllSkills();
    }

    /**
     * 按 skillId 获取 Skill 定义。
     *
     * @param skillId Skill 唯一标识
     * @return Skill 定义，未找到时返回 null
     */
    public SkillDefinition loadSkill(String skillId) {
        return skills.get(skillId);
    }

    /**
     * 获取所有已加载的 Skill 列表（不可变视图）。
     *
     * @return 只读的 Skill 定义列表
     */
    public List<SkillDefinition> listSkills() {
        return Collections.unmodifiableList(List.copyOf(skills.values()));
    }

    /**
     * 从 classpath:skills/ 目录加载所有 JSON 配置。
     */
    private void loadAllSkills() {
        PathMatchingResourcePatternResolver resolver = new PathMatchingResourcePatternResolver();
        try {
            Resource[] resources = resolver.getResources(SKILL_PATTERN);
            for (Resource resource : resources) {
                try {
                    SkillDefinition skill = objectMapper.readValue(resource.getInputStream(), SkillDefinition.class);
                    skills.put(skill.getId(), skill);
                    log.info("Loaded skill: id={}, name={}, version={}", skill.getId(), skill.getName(), skill.getVersion());
                } catch (IOException e) {
                    log.warn("Failed to parse skill config: {}", resource.getFilename(), e);
                }
            }
            log.info("SkillLoader initialized with {} skill(s).", skills.size());
        } catch (IOException e) {
            log.warn("No skill configs found at classpath:skills/*.json. This is expected if no skills are deployed yet.");
        }
    }
}
