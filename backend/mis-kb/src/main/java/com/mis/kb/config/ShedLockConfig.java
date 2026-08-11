package com.mis.kb.config;

import net.javacrumbs.shedlock.core.LockProvider;
import net.javacrumbs.shedlock.provider.jdbctemplate.JdbcTemplateLockProvider;
import net.javacrumbs.shedlock.spring.annotation.EnableSchedulerLock;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.jdbc.core.JdbcTemplate;

import javax.sql.DataSource;

/**
 * ShedLock 配置：定时任务的多实例互斥（引擎删除策略 P0 / T01）。
 *
 * <p>mis-kb 在生产是多副本部署，{@code @Scheduled} 会在<b>每个副本上各跑一次</b>。
 * 引擎对账要读全量 dataset 并批量回写 {@code engine_sync_status}，多副本并发跑
 * 既浪费引擎侧配额，又会互相覆盖对账结果。故用 ShedLock 做数据库级互斥。
 *
 * <p><b>约定（勿改）：</b>
 * <ul>
 *   <li>锁表名固定 {@code shedlock}（V26 建表，列 name/lock_until/locked_at/locked_by）；</li>
 *   <li>全服务只有一个 lock name：{@code kb-engine-reconcile}，别再起第二个；</li>
 *   <li>{@code KbApplication} <b>已有</b> {@code @EnableScheduling}（Wave D 加的），
 *       本类只负责 {@code @EnableSchedulerLock} + {@code LockProvider}，不要重复加。</li>
 * </ul>
 *
 * <p>{@code defaultLockAtMostFor} 是兜底：持锁实例崩溃且没来得及释放时，锁最多被占这么久。
 * 具体任务在 {@code @SchedulerLock} 上按 {@code mis.kb.engine.reconcile.lock-at-most-for} 覆盖。
 */
@Configuration
@EnableSchedulerLock(defaultLockAtMostFor = "PT10M")
public class ShedLockConfig {

    /** V26 建的锁表名，与 ShedLock 的列约定一致。 */
    public static final String LOCK_TABLE = "shedlock";

    /** 引擎对账任务的锁名，全服务唯一。 */
    public static final String LOCK_ENGINE_RECONCILE = "kb-engine-reconcile";

    /**
     * 基于 JdbcTemplate 的锁提供者。
     *
     * <p>刻意用 {@code usingDbTime()}：以<b>数据库时间</b>而非各实例的本地时间判定锁是否过期。
     * 多副本机器时钟哪怕只差几秒，用本地时间都可能出现两个实例同时认为锁已释放。
     *
     * @param dataSource 业务库数据源（与 kb_library 同库，事务/时钟天然一致）
     * @return ShedLock 锁提供者
     */
    @Bean
    public LockProvider lockProvider(DataSource dataSource) {
        return new JdbcTemplateLockProvider(
                JdbcTemplateLockProvider.Configuration.builder()
                        .withJdbcTemplate(new JdbcTemplate(dataSource))
                        .withTableName(LOCK_TABLE)
                        .usingDbTime()
                        .build());
    }
}
