package com.mis.kb;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.cloud.client.discovery.EnableDiscoveryClient;
import org.springframework.scheduling.annotation.EnableScheduling;

/**
 * 知识库与 RAG 微服务启动类。
 *
 * <p>端口 {@code 8108}；内部端点前缀 {@code /internal/v1/kb/**}，由 BFF 与 mis-rag 经内网调用。
 * 复用 mis-common 的统一响应、异常、安全上下文与 JPA 基础设施。
 *
 * <p><b>Wave D 新增 {@link EnableScheduling}（设计文档 §8.1-5.5 风险点）：</b>
 * 这是 mis-kb <b>首次</b>开启 Spring 定时任务，唯一驱动的是
 * {@code SynonymDictLoader#pollForChanges()}（L2 词典版本轮询，默认 3 秒一次主键查询）。
 *
 * <p>开启前已全模块检索确认：本服务及其依赖的 {@code mis-common-*} 里
 * <b>没有任何其它 {@code @Scheduled} 方法</b>会因此被动激活 —— 否则一个注解就可能
 * 悄悄唤醒一批从未上线跑过的后台任务，这类事故很难在灰度期暴露。
 * 后续若新增 {@code @Scheduled}，务必同步复核此处的假设。
 *
 * <p><b>引擎删除策略 P0（T04）新增第 2 个定时任务</b>：
 * {@code KbEngineReconcileService#scheduledReconcile()}（引擎对账，默认 5 分钟一次）。
 * 多副本并发跑会互相覆盖对账结果，故用 ShedLock 做数据库级互斥
 * （见 {@code com.mis.kb.config.ShedLockConfig}，锁名 {@code kb-engine-reconcile}）。
 * {@link EnableScheduling} 保持在本类这唯一一处，<b>不要在 ShedLockConfig 里重复加</b>。
 */
@SpringBootApplication
@EnableDiscoveryClient
@EnableScheduling
public class KbApplication {

    public static void main(String[] args) {
        SpringApplication.run(KbApplication.class, args);
    }
}
