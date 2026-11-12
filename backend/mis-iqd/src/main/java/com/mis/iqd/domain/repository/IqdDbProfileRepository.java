package com.mis.iqd.domain.repository;

import com.mis.iqd.domain.entity.IqdDbProfile;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface IqdDbProfileRepository extends JpaRepository<IqdDbProfile, Long> {

    Optional<IqdDbProfile> findByName(String name);

    boolean existsByName(String name);

    List<IqdDbProfile> findAllByOrderByIdAsc();

    Optional<IqdDbProfile> findFirstByIsDefaultAndEnabledOrderByIdAsc(Integer isDefault, Integer enabled);
}
