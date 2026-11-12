package com.mis.adminbff.dto;

import java.util.List;

public record PhoneResolveResult(List<MatchedUser> matched, List<String> missing) {
    public record MatchedUser(String userId, String name, String phone) {
    }
}
