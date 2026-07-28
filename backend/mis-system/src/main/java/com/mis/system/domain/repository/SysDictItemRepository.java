package com.mis.system.domain.repository;

import com.mis.system.domain.entity.SysDictItem;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface SysDictItemRepository extends JpaRepository<SysDictItem, Long> {

    List<SysDictItem> findByTypeIdOrderBySortAscIdAsc(Long typeId);

    void deleteByTypeId(Long typeId);
}
