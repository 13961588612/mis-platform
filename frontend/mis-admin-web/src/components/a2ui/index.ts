/**
 * A2UI 渲染层桶导出（mis-admin-web 源码模块，单前端一份）。
 */
export { A2UI_REGISTRY, A2UI_CATALOG, getA2uiRegistryEntry, getA2uiComponent, isKnownA2uiComponent, getActionBinding } from './registry';
export { A2uiProvider, useA2ui, type A2uiContextValue } from './A2uiProvider';
export { useA2ui as useA2uiContext } from './a2ui-context';
export { A2uiPermissionGate } from './A2uiPermissionGate';
export { PermissionErrorBanner, permissionErrorMessage } from './PermissionErrorBanner';
export { callBffAction, resolveBindingUrl, toBffActionError } from './bff-actions';
export { ApprovalCard } from './components/ApprovalCard';
export { DataTable } from './components/DataTable';
export { FormSheet } from './components/FormSheet';
export { EntitySelect } from './components/EntitySelect';
export { A2uiText } from './components/A2uiText';
export { A2uiContainer } from './components/A2uiContainer';
export { A2uiButton } from './components/A2uiButton';
export { A2uiInput } from './components/A2uiInput';
