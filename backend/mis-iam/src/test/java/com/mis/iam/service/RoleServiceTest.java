package com.mis.iam.service;

import com.mis.common.core.exception.BusinessException;
import com.mis.common.core.exception.ResultCode;
import com.mis.iam.domain.entity.SysRole;
import com.mis.iam.domain.repository.SysRoleRepository;
import com.mis.iam.domain.repository.SysUserRoleRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.Instant;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class RoleServiceTest {

    @Mock
    private SysRoleRepository roleRepository;
    @Mock
    private SysUserRoleRepository userRoleRepository;

    private RoleService roleService;

    @BeforeEach
    void setUp() {
        roleService = new RoleService(roleRepository, userRoleRepository);
    }

    @Test
    void delete_builtinRole_rejected() {
        SysRole builtin = new SysRole();
        builtin.setId(1L);
        builtin.setType(1);
        builtin.setDeleted(0);
        builtin.setUpdatedAt(Instant.now());
        when(roleRepository.findById(1L)).thenReturn(Optional.of(builtin));

        BusinessException ex = assertThrows(BusinessException.class, () -> roleService.delete(1L));
        assertEquals(ResultCode.ROLE_BUILTIN_PROTECTED.getCode(), ex.getCode());
    }
}
