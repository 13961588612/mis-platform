package com.mis.recon.service.engine;

import com.mis.recon.common.BizException;
import com.mis.recon.common.ErrorCode;
import org.springframework.beans.BeansException;
import org.springframework.context.ApplicationContext;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;

/**
 * 自定义类加载器（第三批 C1，方案设计 §13.2）。
 * <p>兑现 §13.2：<b>优先 Spring 容器按类型获取</b>（可注入 DataSource/RestTemplate 等依赖），
 * 容器无则<b>反射无参构造</b>兜底。类名解析：全限定类名原样；无包名简名自动补
 * {@code com.mis.recon.custom.} 前缀。保存校验 = 类可加载 + 实现对应接口（§13.2）。</p>
 */
@Component
public class CustomLoader {

    private static final String DEFAULT_PACKAGE = "com.mis.recon.custom.";

    private final ApplicationContext applicationContext;

    public CustomLoader(ApplicationContext applicationContext) {
        this.applicationContext = applicationContext;
    }

    /** 类名解析：空白 → null；无包名（不含 "."）自动补 com.mis.recon.custom. 前缀。 */
    public String resolveClassName(String className) {
        if (!StringUtils.hasText(className)) {
            return null;
        }
        String c = className.trim();
        return c.contains(".") ? c : DEFAULT_PACKAGE + c;
    }

    /**
     * 保存校验（§13.2）：类可加载 + 实现对应接口；不通过抛 BizException。
     *
     * @param className         配置的全限定类名（可为 null/空白 → 6214）
     * @param requiredInterface 期望接口（CustomMatcher / CustomCheckExecutor / CustomComparator）
     */
    public void validate(String className, Class<?> requiredInterface) {
        Class<?> type = loadClass(className);
        if (requiredInterface != null && !requiredInterface.isAssignableFrom(type)) {
            throw new BizException(ErrorCode.CUSTOM_INTERFACE_MISMATCH,
                    "未实现接口：" + requiredInterface.getSimpleName() + "（" + type.getName() + "）");
        }
    }

    /**
     * 加载实例：① Spring 容器按类型优先（可注入依赖）→ ② 反射无参构造兜底（§13.2）。
     *
     * @param className    配置的全限定类名
     * @param expectedType 期望接口类型（接口校验 + 泛型返回）
     */
    @SuppressWarnings("unchecked")
    public <T> T load(String className, Class<T> expectedType) {
        Class<?> type = loadClass(className);
        if (!expectedType.isAssignableFrom(type)) {
            throw new BizException(ErrorCode.CUSTOM_INTERFACE_MISMATCH,
                    "未实现接口：" + expectedType.getSimpleName() + "（" + type.getName() + "）");
        }
        try {
            return (T) applicationContext.getBean(type);
        } catch (BeansException e) {
            // 容器无该 Bean → 反射无参构造兜底
        }
        try {
            return (T) type.getDeclaredConstructor().newInstance();
        } catch (Exception e) {
            throw new BizException(ErrorCode.SYSTEM_ERROR,
                    "自定义类实例化失败: " + type.getName() + "（需要无参构造或注册为 Spring Bean）");
        }
    }

    /** 类名解析 + 加载：空白 → 6214；不可加载 → 6215。 */
    private Class<?> loadClass(String className) {
        String resolved = resolveClassName(className);
        if (resolved == null) {
            throw new BizException(ErrorCode.CUSTOM_CLASS_BLANK, "自定义类名必填");
        }
        try {
            return Class.forName(resolved);
        } catch (ClassNotFoundException e) {
            throw new BizException(ErrorCode.CUSTOM_CLASS_NOT_FOUND, "类不存在：" + resolved);
        }
    }
}
