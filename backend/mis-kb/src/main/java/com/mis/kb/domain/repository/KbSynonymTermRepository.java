package com.mis.kb.domain.repository;

import com.mis.kb.domain.entity.KbSynonymTerm;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.Collection;
import java.util.List;

/**
 * 同义词词条仓储（Wave D）。
 */
public interface KbSynonymTermRepository extends JpaRepository<KbSynonymTerm, Long> {

    /**
     * <b>批量</b>冲突检测：一次查出所有已被占用的归一化词形。
     *
     * <p>⛔ 禁止用 N 次单查代替 —— 导入一次两千组，单查就是两千次往返。
     * 这也是 {@code SynonymGroupService.checkTermConflicts} 只允许调一次库的原因。
     *
     * @param termNorms 归一化词形集合
     * @return 已存在的词条（含所属 groupId，用于拼「已属于术语组 X」的提示）
     */
    List<KbSynonymTerm> findByTermNormIn(Collection<String> termNorms);

    /**
     * 按组批量取词条，按 {@code sortNo} 升序（规范词恒在首位）。
     *
     * @param groupIds 组 ID 集合
     * @return 词条列表；同组内 {@code sortNo} 升序
     */
    List<KbSynonymTerm> findByGroupIdInOrderBySortNo(Collection<Long> groupIds);

    /**
     * 取单组词条，按 {@code sortNo} 升序。
     *
     * @param groupId 组 ID
     * @return 词条列表
     */
    List<KbSynonymTerm> findByGroupIdOrderBySortNo(Long groupId);

    /**
     * 删除某组的全部词条（编辑时「先删后插」）。
     *
     * @param groupId 组 ID
     * @return 删除行数
     */
    @Modifying
    @Query("DELETE FROM KbSynonymTerm t WHERE t.groupId = :groupId")
    int deleteByGroupId(@Param("groupId") Long groupId);

    /**
     * 词条总数（水位提示 WD-15 用）。
     *
     * @return 词条总数
     */
    @Query("SELECT COUNT(t) FROM KbSynonymTerm t")
    long countAll();
}
