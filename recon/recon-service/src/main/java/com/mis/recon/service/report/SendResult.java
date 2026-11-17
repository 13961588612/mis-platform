package com.mis.recon.service.report;

/**
 * 报告渠道发送结果（T07-spec §3）。
 */
public class SendResult {

    public static final SendResult OK = new SendResult(true, null);

    private final boolean success;
    private final String error;

    public SendResult(boolean success, String error) {
        this.success = success;
        this.error = error;
    }

    public static SendResult ok() {
        return OK;
    }

    public static SendResult fail(String error) {
        return new SendResult(false, error);
    }

    public boolean isSuccess() {
        return success;
    }

    public String getError() {
        return error;
    }
}