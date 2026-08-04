package com.mis.kb.domain.repository;

import com.mis.kb.domain.entity.KbSynonymConfig;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.Instant;

/**
 * 同义词全局配置仓储（单行表，Wave D）。
 *
 * <p>两个写方法都写成 {@code @Modifying} 批量语句而非「读实体 → setter → save」，
 * 理由有二：
 * <ol>
 *   <li>{@code dict_version + 1} 交给数据库做，多实例并发下天然安全；读改写会丢更新；</li>
 *   <li>避免受管实体在同一事务内被脏检查回写，覆盖掉刚刚自增的版本号。</li>
 * </ol>
 */
public interface KbSynonymConfigRepository extends JpaRepository<KbSynonymConfig, Long> {

    /**
     * 词表版本号 +1（DB 侧自增，多实例并发安全）。
     *
     * <p>调用时机：任何词表写操作的<b>同一事务内</b>。
     * 事务提交后再调 {@code SynonymDictLoader.reloadNow(newVersion)}（L1 即时生效）。
     *
     * @param now    更新时刻
     * @param userId 操作人；可为 {@code null}
     * @return 影响行数（正常恒为 1）
     */
    @Modifying(flushAutomatically = true)
    @Query("""
            UPDATE KbSynonymConfig c
               SET c.dictVersion = c.dictVersion + 1,
                   c.updatedAt = :now,
                   c.updatedBy = :userId
             WHERE c.id = 1
            """)
    int bumpVersion(@Param("now") Instant now, @Param("userId") Long userId);

    /**
     * 切换库内业务开关。
     *
     * <p><b>不动 {@code dictVersion}</b>：开关切换不改变词表内容，
     * 版本号由调用方在同一事务里另行 {@link #bumpVersion} —— 这样其它实例也能感知开关变化。
     *
     * @param enabled 1=开 0=关
     * @param now     更新时刻
     * @param userId  操作人；可为 {@code null}
     * @return 影响行数
     */
    @Modifying(flushAutomatically = true)
    @Query("""
            UPDATE KbSynonymConfig c
               SET c.enabled = :enabled,
                   c.updatedAt = :now,
                   c.updatedBy = :userId
             WHERE c.id = 1
            """)
    int updateEnabled(
            @Param("enabled") Integer enabled,
            @Param("now") Instant now,
            @Param("userId") Long userId);

    /**
     * 只读版本号（L2 轮询的唯一查询：单行主键命中，不碰词表）。
     *
     * @param id 固定传 {@code 1L}
     * @return 版本号；行不存在返回 {@code null}
     */
    @Query("SELECT c.dictVersion FROM KbSynonymConfig c WHERE c.id = :id")
    Long findVersionById(@Param("id") Long id);

    /**
     * 只读开关位。
     *
     * @param id 固定传 {@code 1L}
     * @return 1=开 0=关；行不存在返回 {@code null}
     */
    @Query("SELECT c.enabled FROM KbSynonymConfig c WHERE c.id = :id")
    Integer findEnabledById(@Param("id") Long id);
}
