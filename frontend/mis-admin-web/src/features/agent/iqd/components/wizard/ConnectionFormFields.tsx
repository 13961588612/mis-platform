/**
 * ConnectionFormFields.tsx — 连接表单**字段控件层**（T07 抽出）。
 *
 * <h2>为什么抽出来</h2>
 * 「编辑既有连接」要改的字段集（`name` / `base_url` / `default_connector` / `timeout_seconds` /
 * `language` / `auth_type` / `secret_ref`）与新建向导的步骤 1 / 2 **完全同源**。
 * 若在编辑弹窗里再手写一份，两份控件迟早漂移（改了校验/占位文案只改一处），且
 * `secret_ref` 的「留空 = 保留原值」这种关键文案一旦在某一处漏掉就会**静默清空凭证**。
 *
 * 故本组件按 **section** 渲染同一套控件：
 * <ul>
 *   <li>`section="basic"` —— 步骤 1 的字段（名称 / 地址 / connector / 超时 / 语言）；
 *       编辑弹窗里也单独渲染这一块；</li>
 *   <li>`section="datasource"` —— 步骤 2 的字段（认证方式 / `secret_ref` / `project_id`）；</li>
 * </ul>
 *
 * <h2>字段可见性 / 安全铁律</h2>
 * `secret_ref` 恒 `type="password"` + `autoComplete="new-password"`，**编辑模式预填为空**
 * （见 `connectionEditUtils.connectionToDraft`）—— 凭证永不回显明文（后端 GET 恒回 `******`）。
 *
 * <h2>UI 规范</h2>
 * 圆角 4px / 标签 `text-[13px]` / 间距由外层控制（本组件不加内层 padding）。
 */
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  AUTH_TYPE_OPTIONS,
  DB_TYPE_OPTIONS,
  buildConnectorOptions,
  type ConnectionDraft,
  type ConnectionFormMode,
} from './connectionEditUtils';

/** `ConnectionFormFields` Props。 */
export interface ConnectionFormFieldsProps {
  /** 渲染哪一段控件（对齐新建向导的步骤 1 / 2）。 */
  section: 'basic' | 'datasource';
  /** 表单模式（影响占位文案与提示语）。 */
  mode: ConnectionFormMode;
  draft: ConnectionDraft;
  /** 局部更新草稿（父组件 `setDraft(prev => ({ ...prev, ...patch }))`）。 */
  onDraftChange: (patch: Partial<ConnectionDraft>) => void;
  /** 提交中禁用全部输入。 */
  disabled?: boolean;
  /** 【分层】可选：数据库连接配置清单（供 project 选题 profile；未传则回退结构化录入）。 */
  dbProfiles?: ReadonlyArray<{ id?: number | null; name: string; db_type?: string | null }>;
}

/**
 * 连接表单字段控件（`section` 可分两次渲染 = 新建向导两步；一次全渲染 = 编辑弹窗）。
 */
export function ConnectionFormFields({
  section,
  mode,
  draft,
  onDraftChange,
  disabled = false,
  dbProfiles,
}: ConnectionFormFieldsProps) {
  if (section === 'basic') {
    return (
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label className="text-[13px]">连接名称 *</Label>
          <Input
            value={draft.name}
            disabled={disabled}
            onChange={(e) => onDraftChange({ name: e.target.value })}
            placeholder="如：销售库"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-[13px]">WrenAI 地址</Label>
          <Input
            value={draft.baseUrl}
            disabled={disabled}
            onChange={(e) => onDraftChange({ baseUrl: e.target.value })}
            placeholder={mode === 'edit' ? '留空 = 保留原值' : 'http://127.0.0.1:3000'}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-[13px]">默认 connector</Label>
          <Select
            value={draft.defaultConnector}
            disabled={disabled}
            onValueChange={(value) => onDraftChange({ defaultConnector: value })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {/* 值未知时追加「（现有）」动态项：不让历史值静默丢失 */}
              {buildConnectorOptions(draft.defaultConnector).map((option) => (
                <SelectItem key={option} value={option}>
                  {option}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-[13px]">超时（秒）</Label>
          <Input
            type="number"
            min={1}
            value={draft.timeoutSeconds}
            disabled={disabled}
            onChange={(e) => onDraftChange({ timeoutSeconds: Number(e.target.value) })}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-[13px]">语言</Label>
          <Input
            value={draft.language}
            disabled={disabled}
            onChange={(e) => onDraftChange({ language: e.target.value })}
            placeholder="zh-CN"
          />
        </div>
      </div>
    );
  }

  if (dbProfiles && dbProfiles.length > 0) {
    return (
      <div className="space-y-3">
        <Alert>
          <AlertTitle className="text-[13px]">选择数据库连接</AlertTitle>
          <AlertDescription className="text-[12px]">
            项目（= wren context）通过这里选定业务库连接（profile）。数据库连接的 host / 账号 / 密码在
            「数据库连接配置」里维护，项目侧不再重复填写。
          </AlertDescription>
        </Alert>
        <div className="space-y-1">
          <Label className="text-[13px]">数据库连接配置 *</Label>
          <Select
            value={draft.profileId !== '' ? draft.profileId : undefined}
            disabled={disabled}
            onValueChange={(value) => onDraftChange({ profileId: value })}
          >
            <SelectTrigger>
              <SelectValue placeholder="选择数据库连接" />
            </SelectTrigger>
            <SelectContent>
              {dbProfiles.filter((p) => p.id != null).map((p) => (
                <SelectItem key={p.id} value={String(p.id)}>
                  {p.name}
                  {p.db_type ? ` · ${p.db_type}` : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <Alert>
        <AlertTitle className="text-[13px]">业务库连接（平台侧管理）</AlertTitle>
        <AlertDescription className="text-[12px]">
          在此填写业务库连接参数，密码经服务端加密存入 <strong>凭据保险库</strong>（AES-256-GCM），
          <strong>不落平台配置库、不回显</strong>。查询接口恒返回掩码。
          {mode === 'edit' && ' 编辑时密码留空 = 保留已存密码，不会清空。'}
        </AlertDescription>
      </Alert>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label className="text-[13px]">数据库类型</Label>
          <Select
            value={draft.dbType}
            disabled={disabled}
            onValueChange={(value) => onDraftChange({ dbType: value })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DB_TYPE_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-[13px]">主机 host</Label>
          <Input
            value={draft.dbHost}
            disabled={disabled}
            onChange={(e) => onDraftChange({ dbHost: e.target.value })}
            placeholder="10.254.16.217"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-[13px]">端口 port</Label>
          <Input
            value={draft.dbPort}
            disabled={disabled}
            onChange={(e) => onDraftChange({ dbPort: e.target.value })}
            placeholder="9030"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-[13px]">数据库 database</Label>
          <Input
            value={draft.dbDatabase}
            disabled={disabled}
            onChange={(e) => onDraftChange({ dbDatabase: e.target.value })}
            placeholder="adhoc"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-[13px]">账号 user</Label>
          <Input
            value={draft.dbUser}
            disabled={disabled}
            autoComplete="off"
            onChange={(e) => onDraftChange({ dbUser: e.target.value })}
            placeholder="query"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-[13px]">密码 password</Label>
          <Input
            type="password"
            autoComplete="new-password"
            value={draft.dbPassword}
            disabled={disabled}
            onChange={(e) => onDraftChange({ dbPassword: e.target.value })}
            placeholder={mode === 'edit' ? '留空 = 保留已存密码' : '业务库密码'}
          />
        </div>
      </div>
      <details className="rounded border border-dashed p-2">
        <summary className="cursor-pointer text-[12px] text-muted-foreground">
          高级：WrenAI 连接参数（可选）
        </summary>
        <div className="mt-2 grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label className="text-[13px]">认证方式</Label>
            <Select
              value={draft.authType}
              disabled={disabled}
              onValueChange={(value) => onDraftChange({ authType: value })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {AUTH_TYPE_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-[13px]">凭证引用（secret_ref）</Label>
            <Input
              type="password"
              autoComplete="new-password"
              value={draft.secretRef}
              disabled={disabled}
              onChange={(e) => onDraftChange({ secretRef: e.target.value })}
              placeholder="留空 = 自动生成"
            />
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label className="text-[13px]">WrenAI project_id</Label>
            <Input
              value={draft.projectId}
              disabled={disabled}
              onChange={(e) => onDraftChange({ projectId: e.target.value })}
              placeholder="可选；留空则由 WrenAI 侧解析"
            />
          </div>
        </div>
      </details>
    </div>
  );
}

export default ConnectionFormFields;
