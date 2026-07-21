package com.mis.adminbff.dto;

import java.util.List;

public record MeVO(
        String id,
        String username,
        String realName,
        String avatarUrl,
        List<String> roles,
        Long permVersion,
        List<String> permissions
) {}
