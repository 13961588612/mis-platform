package com.mis.adminbff.client.model;

import java.util.List;

public record ProcessDetailVO(
        WfInstanceVO instance, List<WfTaskVO> tasks, List<WfHistoryVO> history) {
}
