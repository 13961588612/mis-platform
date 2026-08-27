package com.mis.recon.service.engine;

import com.mis.recon.common.BizException;
import com.mis.recon.custom.CustomCheckExecutor;
import com.mis.recon.custom.CustomComparator;
import com.mis.recon.custom.CustomMatcher;
import com.mis.recon.custom.TestMatcher;
import com.mis.recon.custom.example.CrossSystemIdMatcher;
import com.mis.recon.custom.example.OrderLifecycleCheck;
import com.mis.recon.custom.example.TieredPricingComparator;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.NoSuchBeanDefinitionException;
import org.springframework.context.ApplicationContext;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * CustomLoader 单测（第三批 C1，L 组）：Spring 容器优先 / 反射无参构造兜底 / 简名补全 / 类与接口校验。
 */
class CustomLoaderTest {

    private ApplicationContext ctx;
    private CustomLoader loader;

    @BeforeEach
    void setUp() {
        ctx = mock(ApplicationContext.class);
        loader = new CustomLoader(ctx);
    }

    @Test
    void loadReflectionFallbackWhenNoSpringBean() {
        // L-1：容器无该类型 Bean → 反射无参构造兜底实例化（§13.2）
        when(ctx.getBean(TestMatcher.class)).thenThrow(new NoSuchBeanDefinitionException(TestMatcher.class));
        CustomMatcher m = loader.load(TestMatcher.class.getName(), CustomMatcher.class);
        assertNotNull(m);
        assertTrue(m instanceof TestMatcher);
    }

    @Test
    void loadSpringBeanTakesPriority() {
        // L-2：容器有该类型 Bean → 返回容器实例（可注入依赖），不走反射
        TestMatcher bean = mock(TestMatcher.class);
        when(ctx.getBean(TestMatcher.class)).thenReturn(bean);
        assertSame(bean, loader.load(TestMatcher.class.getName(), CustomMatcher.class));
    }

    @Test
    void resolveShortNameAutoPrefix() {
        // L-3：简名自动补 com.mis.recon.custom. 前缀；全限定名原样；空白 → null
        assertEquals("com.mis.recon.custom.TestMatcher", loader.resolveClassName("TestMatcher"));
        assertEquals(TestMatcher.class.getName(), loader.resolveClassName(TestMatcher.class.getName()));
        assertNull(loader.resolveClassName("   "));
        assertNull(loader.resolveClassName(null));
    }

    @Test
    void validateRejectsMissingClass() {
        // L-4：类不存在 → 6215
        BizException ex = assertThrows(BizException.class,
                () -> loader.validate("com.nonexistent.Foo", CustomMatcher.class));
        assertEquals(6215, ex.getCode());
    }

    @Test
    void validateRejectsWrongInterface() {
        // L-5：类存在但未实现对应接口 → 6216
        BizException ex = assertThrows(BizException.class,
                () -> loader.validate(TestMatcher.class.getName(), CustomCheckExecutor.class));
        assertEquals(6216, ex.getCode());
    }

    @Test
    void validateRejectsBlankClass() {
        // L-6：类名为空 → 6214
        BizException ex = assertThrows(BizException.class,
                () -> loader.validate(null, CustomMatcher.class));
        assertEquals(6214, ex.getCode());
    }

    @Test
    void builtinExampleMatcherLoadable() {
        // L-7：内置示例 CrossSystemIdMatcher 可加载且实现 CustomMatcher（容器 mock 无 Bean → 反射兜底）
        when(ctx.getBean(CrossSystemIdMatcher.class)).thenThrow(new NoSuchBeanDefinitionException(CrossSystemIdMatcher.class));
        CustomMatcher m = loader.load(CrossSystemIdMatcher.class.getName(), CustomMatcher.class);
        assertNotNull(m);
        assertTrue(m instanceof CrossSystemIdMatcher);
    }

    @Test
    void builtinExampleCheckExecutorLoadable() {
        // L-8：内置示例 OrderLifecycleCheck 可加载且实现 CustomCheckExecutor
        when(ctx.getBean(OrderLifecycleCheck.class)).thenThrow(new NoSuchBeanDefinitionException(OrderLifecycleCheck.class));
        CustomCheckExecutor e = loader.load(OrderLifecycleCheck.class.getName(), CustomCheckExecutor.class);
        assertNotNull(e);
        assertTrue(e instanceof OrderLifecycleCheck);
    }

    @Test
    void builtinExampleComparatorLoadable() {
        // L-9：内置示例 TieredPricingComparator 可加载且实现 CustomComparator
        when(ctx.getBean(TieredPricingComparator.class)).thenThrow(new NoSuchBeanDefinitionException(TieredPricingComparator.class));
        CustomComparator c = loader.load(TieredPricingComparator.class.getName(), CustomComparator.class);
        assertNotNull(c);
        assertTrue(c instanceof TieredPricingComparator);
    }
}
