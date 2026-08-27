package com.mis.recon.config;

import com.fasterxml.jackson.databind.SerializationFeature;
import com.fasterxml.jackson.databind.ser.std.ToStringSerializer;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import com.fasterxml.jackson.datatype.jsr310.deser.LocalDateDeserializer;
import com.fasterxml.jackson.datatype.jsr310.deser.LocalDateTimeDeserializer;
import com.fasterxml.jackson.datatype.jsr310.deser.LocalTimeDeserializer;
import com.fasterxml.jackson.datatype.jsr310.ser.LocalDateSerializer;
import com.fasterxml.jackson.datatype.jsr310.ser.LocalDateTimeSerializer;
import com.fasterxml.jackson.datatype.jsr310.ser.LocalTimeSerializer;
import org.springframework.boot.autoconfigure.jackson.Jackson2ObjectMapperBuilderCustomizer;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.time.format.DateTimeFormatter;
import java.util.TimeZone;

/**
 * Jackson 全局序列化约定。
 * <ul>
 *   <li>Long/long 序列化为字符串：防前端 JS 精度丢失（ID 等）。</li>
 *   <li>java.time 类型统一格式：yyyy-MM-dd HH:mm:ss / yyyy-MM-dd / HH:mm:ss（spring.jackson.date-format
 *       只对 java.util.Date 生效，LocalDateTime 等必须自定义 JavaTimeModule）。</li>
 *   <li>时区 Asia/Shanghai；关闭 WRITE_DATES_AS_TIMESTAMPS。</li>
 * </ul>
 * 全局 Long 转字符串会波及所有 Long 字段（含统计数值）；个别需要返回数值的字段用
 * @JsonSerialize(using = NumberSerializer.class) 反控。
 */
@Configuration
public class JacksonConfig {

    private static final DateTimeFormatter DATETIME = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss");
    private static final DateTimeFormatter DATE     = DateTimeFormatter.ofPattern("yyyy-MM-dd");
    private static final DateTimeFormatter TIME     = DateTimeFormatter.ofPattern("HH:mm:ss");

    @Bean
    public Jackson2ObjectMapperBuilderCustomizer jacksonCustomizer() {
        return builder -> {
            builder.serializerByType(Long.class, ToStringSerializer.instance);
            builder.serializerByType(Long.TYPE, ToStringSerializer.instance);

            JavaTimeModule module = new JavaTimeModule();
            module.addSerializer(LocalDateTime.class, new LocalDateTimeSerializer(DATETIME));
            module.addSerializer(LocalDate.class, new LocalDateSerializer(DATE));
            module.addSerializer(LocalTime.class, new LocalTimeSerializer(TIME));
            module.addDeserializer(LocalDateTime.class, new LocalDateTimeDeserializer(DATETIME));
            module.addDeserializer(LocalDate.class, new LocalDateDeserializer(DATE));
            module.addDeserializer(LocalTime.class, new LocalTimeDeserializer(TIME));
            builder.modules(module);

            builder.timeZone(TimeZone.getTimeZone("Asia/Shanghai"));
            builder.featuresToDisable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS);
        };
    }
}
