package com.mis.recon.domain.dto;

import lombok.Data;

/**
 * 单条重拉结果（V4）。
 */
@Data
public class FetchOneResult {

    /** 锚表行侧：left/right */
    private String side;

    /** 锚表行 ds_code */
    private String dsCode;

    /** 锚表行 record_key */
    private String recordKey;

    /** 拉取是否命中（fetch_one_sql 找到记录） */
    private boolean found;

    /** 台账插入数（0/1，重拉通常 0） */
    private int insert;

    /** 台账更新数（0/1） */
    private int update;

    /** 失败时填，成功为 null */
    private String error;
}
