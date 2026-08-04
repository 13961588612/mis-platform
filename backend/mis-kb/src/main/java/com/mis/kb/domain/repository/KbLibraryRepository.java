package com.mis.kb.domain.repository;

import com.mis.kb.domain.entity.KbLibrary;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface KbLibraryRepository extends JpaRepository<KbLibrary, Long> {

    List<KbLibrary> findByCategoryIdOrderByNameAsc(Long categoryId);

    List<KbLibrary> findByStatus(Integer status);

    List<KbLibrary> findByStatusAndSecrecy(Integer status, String secrecy);

    boolean existsByNameAndCategoryId(String name, Long categoryId);

    boolean existsByCategoryId(Long categoryId);

    Optional<KbLibrary> findByEngineLibraryRef(String engineLibraryRef);
}
