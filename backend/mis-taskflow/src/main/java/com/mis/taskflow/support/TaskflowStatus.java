package com.mis.taskflow.support;

/**
 * 任务流全域状态枚举冻结清单（见 07-full-development-plan.md 附 C）。
 */
public final class TaskflowStatus {

    private TaskflowStatus() {
    }

    /** 代办任务状态 */
    public static final class Task {
        public static final String PENDING = "PENDING";
        public static final String APPROVING = "APPROVING";
        public static final String APPROVED = "APPROVED";
        public static final String REJECTED = "REJECTED";
        public static final String EXPIRED = "EXPIRED";
        public static final String CANCELLED = "CANCELLED";

        private Task() {
        }
    }

    /** 流程实例状态 */
    public static final class Instance {
        public static final String RUNNING = "RUNNING";
        public static final String COMPLETED = "COMPLETED";
        public static final String TERMINATED = "TERMINATED";
        public static final String SUSPENDED = "SUSPENDED";

        private Instance() {
        }
    }

    /** 后处理状态 */
    public static final class PostProcess {
        public static final String WAITING = "WAITING";
        public static final String SUCCESS = "SUCCESS";
        public static final String FAILED = "FAILED";
        public static final String RETRYING = "RETRYING";
        public static final String MANUAL_FIX = "MANUAL_FIX";

        private PostProcess() {
        }
    }

    /** 本地执行任务状态 */
    public static final class Execution {
        public static final String WAITING = "WAITING";
        public static final String SUCCESS = "SUCCESS";
        public static final String FAILED = "FAILED";

        private Execution() {
        }
    }

    /** 分布式锁状态 */
    public static final class Lock {
        public static final String RUNNING = "RUNNING";
        public static final String SUCCESS = "SUCCESS";
        public static final String FAILED = "FAILED";

        private Lock() {
        }
    }
}