# 5) Replace buildMisEnrichmentHeaders catch block + add new methods
old_catch = '''            } catch (Exception ignored) {
                // \\u964d\\u7ea7\\uff1aIAM \\u4e0d\\u53ef\\u8fbe / \\u89e3\\u6790\\u5931\\u8d25 -> \\u7701\\u7565 X-Mis-* \\u5934\\uff0c\\u5e73\\u53f0\\u9000\\u5316\\u4e3a\\u65e7\\u884c\\u4e3a\\uff08\\u4e0d\\u963b\\u65ad\\u4e3b\\u6d41\\u7a0b\\uff09
            }
        };
    }

    /**
     * \\u53d6 MIS IAM \\u7528\\u6237\\u660e\\u7ec6\\uff0c\\u5e26\\u77ed TTL \\u7f13\\u5b58\\uff08T4.4\\uff09\\u3002'''

new_body = '''            // --- IQD \\u884c\\u7ea7\\u6570\\u636e\\u8303\\u56f4\\u5934\\u6ce8\\u5165 ---
            try {
                LoginUser user = SecurityContextHolder.getOptional().orElse(null);
                if (user != null && user.getUserId() != null) {
                    injectDataRowScopeHeaders(headers, user.getUserId());
                }
            } catch (Exception ignored) {
                // mis-org \\u4e0d\\u53ef\\u8fbe / \\u89e3\\u6790\\u5931\\u8d25 -> \\u4e0d\\u52a0\\u8303\\u56f4\\u5934\\uff0cWorker \\u4fa7 fail-closed
            }
        };
    }

    /**
     * \\u4ece mis-org \\u67e5\\u8be2\\u7528\\u6237\\u6570\\u636e\\u8303\\u56f4\\u5e76\\u6ce8\\u5165\\u95ee\\u6570 Worker \\u8303\\u56f4\\u63a7\\u5236\\u5934\\u3002
     */
    private void injectDataRowScopeHeaders(HttpHeaders headers, Long userId) {
        UserDataSetScopeVO scope = lookupOrgDataScope(userId);
        if (scope == null) return; // mis-org \\u4e0d\\u53ef\\u8fbe

        // ALL \\u663e\\u5f0f\\u653e\\u884c
        if (Boolean.TRUE.equals(scope.all())) {
            headers.set(HEADER_MIS_DATA_SCOPE, \"all\");
            return;
        }

        // deptAnchors -> PATH_PREFIX range header
        List<UserDataSetScopeVO.DeptAnchor> anchors = scope.deptAnchors();
        if (anchors != null && !anchors.isEmpty()) {
            List<Map<String, Object>> anchorJsonList = new ArrayList<>();
            for (UserDataSetScopeVO.DeptAnchor a : anchors) {
                Map<String, Object> m = new LinkedHashMap<>();
                m.put(\"id\", String.valueOf(a.id()));
                if (a.path() != null && !a.path().isEmpty()) m.put(\"path\", a.path());
                if (a.scope() != null && !a.scope().isEmpty()) m.put(\"scope\", a.scope());
                anchorJsonList.add(m);
            }
            try {
                headers.set(HEADER_MIS_DEPT_SCOPE, objectMapper.writeValueAsString(anchorJsonList));
            } catch (JsonProcessingException e) {
                // ignore
            }
        }

        // storeIds -> ENUM range header
        List<Long> storeIds = scope.storeIds();
        if (storeIds != null && !storeIds.isEmpty()) {
            List<String> storeCodes = new ArrayList<>(storeIds.size());
            for (Long sid : storeIds) storeCodes.add(String.valueOf(sid));
            try {
                headers.set(HEADER_MIS_STORES, objectMapper.writeValueAsString(storeCodes));
            } catch (JsonProcessingException e) {
                // ignore
            }
        }
    }

    /** Cache lookup for mis-org data scope view (~60s TTL). Returns null on failure. */
    private UserDataSetScopeVO lookupOrgDataScope(Long userId) {
        OrgCacheEntry entry = orgCache.get(userId);
        if (entry != null && entry.isAlive()) return entry.scope();
        try {
            UserDataSetScopeVO scope = orgWebClient.getUserDataSetScope(userId);
            if (scope != null) {
                orgCache.put(userId, new OrgCacheEntry(scope, System.currentTimeMillis() + IAM_CACHE_TTL_MS));
            }
            return scope;
        } catch (Exception e) {
            return null; // mis-org unavailable -> skip injecting
        }
    }

    private record OrgCacheEntry(UserDataSetScopeVO scope, long expireAt) {
        boolean isAlive() { return System.currentTimeMillis() < expireAt; }
    }

    /**
     * \\u53d6 MIS IAM \\u7528\\u6237\\u660e\\u7ec6\\uff0c\\u5e26\\u77ed TTL \\u7f13\\u5b58\\uff08T4.4\\uff09\\u3002'''

if old_catch in content:
    content = content.replace(old_catch, new_body)
    print('injectDataRowScopeHeaders added: OK')
else:
    print('WARNING: could not find old_catch')

with open(path, 'w', encoding='utf-8') as f:
    f.write(content)
print('Step 3c step3 complete')
