package com.mis.recon.config;

import org.quartz.spi.JobFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.autoconfigure.quartz.SchedulerFactoryBeanCustomizer;
import org.springframework.context.ApplicationContext;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.quartz.SpringBeanJobFactory;

/**
 * Quartz 调度装配（受开关 mis.recon.scheduler.enabled 控制，默认 false）。
 * <ul>
 *   <li>JobStore 参数（org.quartz.jobStore.* 等）放在 application.yml 的
 *       spring.quartz.properties.org.quartz.*，不写在 Java 代码里（保持配置可调）。</li>
 *   <li>不重复声明 SchedulerFactoryBean：Boot 3.2.5 的 QuartzAutoConfiguration 会按
 *       spring.quartz.* 装配（job-store-type / properties / auto-startup），只通过
 *       SchedulerFactoryBeanCustomizer 覆盖规格要求的开关项，保证 yml 驱动的 JobStore 配置生效。</li>
 *   <li>JobFactory 用 Spring 6.1（Boot 3.2.5）提供的 SpringBeanJobFactory 子类，
 *       Job 实例可注入 Spring Bean。规格 §4.3 的 AutowireCapableBeanJobFactory 在
 *       Boot 3.2.5 依赖中不存在（幻觉 API），以等价实现替代。</li>
 *   <li>QRTZ_ 表由 Flyway 建（T02 的 V1__init.sql），spring.quartz.jdbc.initialize-schema=never，
 *       Quartz 绝不自动建表。</li>
 *   <li>调度开关默认 false：T01 阶段无 QRTZ_ 表，避免启动即失败；T02 建表后置 true。</li>
 * </ul>
 */
@Configuration
@ConditionalOnProperty(name = "mis.recon.scheduler.enabled",
                       havingValue = "true", matchIfMissing = false)
public class QuartzConfig {

    @Bean
    public JobFactory quartzJobFactory(ApplicationContext applicationContext) {
        SpringBeanJobFactory factory = new SpringBeanJobFactory();
        factory.setApplicationContext(applicationContext);
        return factory;
    }

    @Bean
    public SchedulerFactoryBeanCustomizer reconQuartzCustomizer(JobFactory quartzJobFactory) {
        return factory -> {
            factory.setJobFactory(quartzJobFactory);            // Job 可注入 Spring Bean
            factory.setOverwriteExistingJobs(true);
            factory.setSchedulerName("reconScheduler");
            factory.setWaitForJobsToCompleteOnShutdown(true);   // 优雅停机
            // autoStartup 不在此覆盖：由 spring.quartz.auto-startup（yml）控制，随调度开关联动
        };
    }
}
