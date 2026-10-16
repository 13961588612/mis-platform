package com.mis.recon.common;

import com.fasterxml.jackson.core.JsonGenerator;
import com.fasterxml.jackson.databind.JsonSerializer;
import com.fasterxml.jackson.databind.SerializerProvider;

import java.io.IOException;

/**
 * 数值字段序列化（无参构造，避免 Spring 接管 jackson serializer 实例化）。
 * <p>全局配置 Long→String 防 JS 精度丢失（见 JacksonConfig），但统计数值字段仍需返回
 * JSON number（前端做求和运算）；本类作为 @JsonSerialize(using=...) 反控使用。
 * 注意：不能直接用 {@code com.fasterxml.jackson.databind.ser.std.NumberSerializer}——
 * Spring 的 SpringHandlerInstantiator 会将其当 bean 用带参构造创建，导致
 * "No qualifying bean of type 'Class<Number>' available" 运行时失败。</p>
 */
public class NumberFieldSerializer extends JsonSerializer<Number> {

    @Override
    public void serialize(Number value, JsonGenerator gen, SerializerProvider serializers) throws IOException {
        if (value == null) {
            gen.writeNull();
        } else {
            gen.writeNumber(value.longValue());
        }
    }
}
