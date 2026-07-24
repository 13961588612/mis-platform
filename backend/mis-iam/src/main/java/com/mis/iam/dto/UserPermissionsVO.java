package com.mis.iam.dto;

import java.util.List;

public record UserPermissionsVO(List<String> permissions, Long permVersion) {}
