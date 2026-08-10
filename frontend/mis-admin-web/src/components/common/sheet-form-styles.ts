/**
 * 右侧划入（Sheet）编辑表单间距约定。
 *
 * <p>与知识库「新增知识库」表单对齐：
 * 表单体 `space-y-3` + `px-5 py-4`；字段内标签↔控件 `space-y-1.5`。
 */
export const SHEET_FORM_BODY = 'flex-1 space-y-3 overflow-auto px-5 py-4';

/** 单个表单项（label + control [+ hint]） */
export const SHEET_FORM_FIELD = 'space-y-1.5';

/** 表单标签（不再自带 mb，间距交给 SHEET_FORM_FIELD） */
export const SHEET_FORM_LABEL = 'block text-sm font-medium text-foreground';
