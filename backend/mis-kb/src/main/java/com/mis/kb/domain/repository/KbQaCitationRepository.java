package com.mis.kb.domain.repository;

import com.mis.kb.domain.entity.KbQaCitation;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface KbQaCitationRepository extends JpaRepository<KbQaCitation, Long> {

    List<KbQaCitation> findByMessageIdOrderByIdAsc(Long messageId);

    List<KbQaCitation> findByMessageIdIn(List<Long> messageIds);

    /** 按知识库查引用（A-02b 库维度筛选用）。 */
    List<KbQaCitation> findByLibraryId(Long libraryId);
}
