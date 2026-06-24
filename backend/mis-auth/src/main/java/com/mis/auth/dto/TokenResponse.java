package com.mis.auth.dto;

public record TokenResponse(String accessToken, long expiresIn) {
}
