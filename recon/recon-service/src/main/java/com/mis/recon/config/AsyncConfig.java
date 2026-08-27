package com.mis.recon.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableAsync;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;

import java.util.concurrent.ThreadPoolExecutor;

/**
 * 异步线程池装配：非关键路径（邮件/Webhook 通知等）用 @Async("reconTaskExecutor")。
 * <ul>
 *   <li>引擎热路径（对账比对）不用此线程池——同步走 reconJdbcTemplate。</li>
 *   <li>Quartz 任务用 Quartz 自己的线程池（spring.quartz.properties.org.quartz.threadPool.*）。
 *       两个线程池职责分离，不得混用。</li>
 * </ul>
 */
@Configuration
@EnableAsync
public class AsyncConfig {

    @Bean("reconTaskExecutor")
    public ThreadPoolTaskExecutor reconTaskExecutor() {
        ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
        executor.setCorePoolSize(4);        // 可读 mis.recon.async.core-pool-size
        executor.setMaxPoolSize(16);        // 可读 mis.recon.async.max-pool-size
        executor.setQueueCapacity(200);     // 可读 mis.recon.async.queue-capacity
        executor.setThreadNamePrefix("recon-async-");
        executor.setRejectedExecutionHandler(new ThreadPoolExecutor.CallerRunsPolicy()); // 拒绝即调用线程执行，不丢任务
        executor.setWaitForTasksToCompleteOnShutdown(true);
        executor.setAwaitTerminationSeconds(10);
        executor.initialize();
        return executor;
    }
}
