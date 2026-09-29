/**
 * connectionEditUtils.test.ts — 连接「编辑 / 停用 / 启用」纯函数层单测（T07）。
 *
 * <p>这里钉住的都是**静默出错**的点（出错时 UI 一切正常、不报错，但数据被悄悄改错）：
 * <ol>
 *   <li><b>{@link buildUpdateRequest} 的"只传改过的字段"</b>：多传一个字段 = 用"当前值"覆盖
 *       "当前值"，看似无害；但后端 **update** DTO 与 **create** DTO 的默认值口径不同
 *       （create 带 `authType="none"`/`timeoutSeconds=60`/`language="zh-CN"`/`enabled=true`）
 *       ⇒ 照抄 create 全量体就会"改个名顺便把超时重置成 60"。**不报错**。</li>
 *   <li><b>`secret_ref` 留空 ⇒ 必须"不传该字段"</b>：传 `''` / `null` / `******`
 *       分别对应"可能清空凭证"与"把占位符当凭证写库"。三种都静默且不可逆。</li>
 *   <li><b>{@link describeConnectionConfirm} 的「启用」文案铁律</b>：见下方 `describe`
 *       分组的 `★` 用例 —— 用户已拍板放开多条 `enabled=true` 并存（§14.5），
 *       **不得**再写"将自动停用其它连接"（后端根本没有这个副作用）。</li>
 *   <li><b>{@link describeConnectionUpdateError} 必须读 `data`</b>：只读 `message` 会丢掉
 *       40900 的冲突名 ⇒ 用户看到"失败"却不知改哪个名。</li>
 * </ol>
 * 纯函数、零运行时依赖（node 环境即可，无需 jsdom / QueryClient）。
 */
import { describe, expect, it } from 'vitest';
import type { Connection } from '../../types/modeling';
import {
  buildConnectorOptions,
  buildCreateRequest,
  buildEnabledUpdate,
  buildUpdateRequest,
  connectionToDraft,
  CONNECTOR_OPTIONS,
  describeConnectionConfirm,
  describeConnectionUpdateError,
  EMPTY_DRAFT,
  normalizeTimeout,
  SECRET_PLACEHOLDER,
  type ConnectionDraft,
  type PendingConfirm,
} from './connectionEditUtils';

/** 造一条既有连接（只填被测字段；其余走类型默认）。 */
function connection(partial: Partial<Connection> = {}): Connection {
  return {
    id: 7,
    name: '销售库',
    base_url: 'http://10.0.0.5:3000',
    auth_type: 'basic',
    secret_ref: SECRET_PLACEHOLDER,
    project_id: 'sales',
    default_connector: 'postgres',
    timeout_seconds: 60,
    language: 'zh-CN',
    enabled: true,
    ...partial,
  };
}

/** 造一份与 {@link connection} **完全一致**的草稿（= 用户什么都没改）。 */
function untouchedDraft(original: Connection): ConnectionDraft {
  return connectionToDraft(original);
}

describe('connectionToDraft（编辑态预填）', () => {
  it('★ secretRef 恒为空串（凭证不回显；避免把 ****** 当新凭证提交）', () => {
    const draft = connectionToDraft(connection({ secret_ref: SECRET_PLACEHOLDER }));
    expect(draft.secretRef).toBe('');
  });

  it('其余字段用现值预填（让"未改动"在 UI 上可见）', () => {
    const draft = connectionToDraft(connection());
    expect(draft.name).toBe('销售库');
    expect(draft.baseUrl).toBe('http://10.0.0.5:3000');
    expect(draft.defaultConnector).toBe('postgres');
    expect(draft.timeoutSeconds).toBe(60);
    expect(draft.language).toBe('zh-CN');
    expect(draft.authType).toBe('basic');
    expect(draft.projectId).toBe('sales');
  });

  it('null 字段回退到与后端 create DTO 同源的默认值（不是空字符串）', () => {
    const draft = connectionToDraft(
      connection({
        base_url: null,
        project_id: null,
        default_connector: null,
        timeout_seconds: undefined,
        language: undefined,
        auth_type: undefined,
      }),
    );
    expect(draft.baseUrl).toBe('');
    expect(draft.projectId).toBe('');
    expect(draft.defaultConnector).toBe('postgres');
    expect(draft.timeoutSeconds).toBe(60);
    expect(draft.language).toBe('zh-CN');
    expect(draft.authType).toBe('none');
  });
});

describe('buildUpdateRequest（局部更新载荷）', () => {
  it('★ 无改动 → 空对象（调用方据此不发请求）', () => {
    const original = connection();
    expect(buildUpdateRequest(untouchedDraft(original), original)).toEqual({});
  });

  it('★ 局部更新不污染：只改 name ⇒ 只带 name 一个键', () => {
    const original = connection();
    const draft = { ...untouchedDraft(original), name: '销售库-生产' };
    const payload = buildUpdateRequest(draft, original);
    expect(payload).toEqual({ name: '销售库-生产' });
    // 逐字确认其余字段**一个都没带**（带了就会被后端当成"提交值"覆盖）
    for (const key of [
      'base_url',
      'auth_type',
      'secret_ref',
      'project_id',
      'default_connector',
      'timeout_seconds',
      'language',
      'enabled',
    ]) {
      expect(Object.prototype.hasOwnProperty.call(payload, key), key).toBe(false);
    }
  });

  it('★ secret_ref 留空 ⇒ 完全不传该字段（不传 "" / 不传 null / 不传 ******）', () => {
    const original = connection();
    const blank = buildUpdateRequest({ ...untouchedDraft(original), secretRef: '' }, original);
    expect(Object.prototype.hasOwnProperty.call(blank, 'secret_ref')).toBe(false);

    const whitespace = buildUpdateRequest(
      { ...untouchedDraft(original), secretRef: '   ' },
      original,
    );
    expect(Object.prototype.hasOwnProperty.call(whitespace, 'secret_ref')).toBe(false);

    const placeholder = buildUpdateRequest(
      { ...untouchedDraft(original), secretRef: SECRET_PLACEHOLDER },
      original,
    );
    expect(Object.prototype.hasOwnProperty.call(placeholder, 'secret_ref')).toBe(false);
  });

  it('secret_ref 非空非占位 ⇒ 提交（用户确实要换凭证），且 trim 后提交', () => {
    const original = connection();
    const payload = buildUpdateRequest(
      { ...untouchedDraft(original), secretRef: '  vault://sales-db  ' },
      original,
    );
    expect(payload).toEqual({ secret_ref: 'vault://sales-db' });
  });

  it('改名 trim 后比较：同名（含前后空格）⇒ 不提交', () => {
    const original = connection();
    expect(buildUpdateRequest({ ...untouchedDraft(original), name: '  销售库 ' }, original)).toEqual(
      {},
    );
  });

  it('空名 ⇒ 不提交 name（由 UI 拦截为必填，不会被后端当成"改名成空"）', () => {
    const original = connection();
    expect(buildUpdateRequest({ ...untouchedDraft(original), name: '   ' }, original)).toEqual({});
  });

  it('留空 = 保留原值：清空 base_url / project_id / default_connector / language ⇒ 都不提交', () => {
    const original = connection();
    const cleared = buildUpdateRequest(
      {
        ...untouchedDraft(original),
        baseUrl: '',
        projectId: '',
        defaultConnector: '',
        language: '',
      },
      original,
    );
    expect(cleared).toEqual({});
  });

  it('timeout：改动则提交；非法值（0 / 负数）归一到 60，与原值相同 ⇒ 不提交', () => {
    const original = connection({ timeout_seconds: 90 });
    expect(buildUpdateRequest({ ...untouchedDraft(original), timeoutSeconds: 120 }, original)).toEqual({
      timeout_seconds: 120,
    });
    // 用户清空数字输入 → Number('') = 0 → 归一为 60；但原值是 90 ⇒ 会提交 60（这是"改动"）
    expect(buildUpdateRequest({ ...untouchedDraft(original), timeoutSeconds: 0 }, original)).toEqual({
      timeout_seconds: 60,
    });
    // 原值就是 60 时，非法输入归一后与原值相同 ⇒ 不提交（不会误写）
    const sixty = connection({ timeout_seconds: 60 });
    expect(buildUpdateRequest({ ...untouchedDraft(sixty), timeoutSeconds: 0 }, sixty)).toEqual({});
  });

  it('★ enabled / mdl_writeback_enabled 永不出现（启停是独立操作；写回开关归 PUT /config）', () => {
    const original = connection({ enabled: true });
    const payload = buildUpdateRequest(
      { ...untouchedDraft(original), name: 'X', baseUrl: 'http://a:1' },
      original,
    );
    expect(Object.prototype.hasOwnProperty.call(payload, 'enabled')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(payload, 'mdl_writeback_enabled')).toBe(false);
  });

  it('多字段同时改动 ⇒ 全部带上（且不带未改的）', () => {
    const original = connection();
    const payload = buildUpdateRequest(
      {
        ...untouchedDraft(original),
        name: 'B',
        baseUrl: ' http://b:3000 ',
        defaultConnector: 'mysql',
        timeoutSeconds: 30,
        language: 'en-US',
        authType: 'token',
        secretRef: 'vault://b',
      },
      original,
    );
    expect(payload).toEqual({
      name: 'B',
      base_url: 'http://b:3000',
      default_connector: 'mysql',
      timeout_seconds: 30,
      language: 'en-US',
      auth_type: 'token',
      secret_ref: 'vault://b',
    });
  });

  it('原值 null + 草稿留空 ⇒ 不提交（不会把 null 写成空串）', () => {
    const original = connection({ base_url: null });
    expect(buildUpdateRequest({ ...untouchedDraft(original), baseUrl: '' }, original)).toEqual({});
  });
});

describe('buildEnabledUpdate（启停载荷）', () => {
  it('★ 只带 enabled 一个键（只改本行，不联动其它连接）', () => {
    expect(buildEnabledUpdate(true)).toEqual({ enabled: true });
    expect(buildEnabledUpdate(false)).toEqual({ enabled: false });
    expect(Object.keys(buildEnabledUpdate(true))).toHaveLength(1);
  });
});

describe('buildCreateRequest（新建载荷，行为与既有 ensureCreated 逐字一致）', () => {
  it('空文本归一为 null；enabled 恒 true', () => {
    const payload = buildCreateRequest(EMPTY_DRAFT);
    expect(payload).toEqual({
      name: '',
      base_url: null,
      default_connector: 'postgres',
      timeout_seconds: 60,
      language: 'zh-CN',
      auth_type: 'none',
      secret_ref: null,
      project_id: null,
      enabled: true,
      // 路线 A：业务库连接字段（默认 starrocks:9030；密码为空 ⇒ null）
      db_type: 'starrocks',
      db_host: null,
      db_port: 9030,
      db_database: null,
      db_user: null,
      db_password: null,
    });
  });

  it('有值则 trim 后提交', () => {
    const payload = buildCreateRequest({
      ...EMPTY_DRAFT,
      name: ' 销售库 ',
      baseUrl: ' http://x:1 ',
      secretRef: ' vault://x ',
      projectId: ' p ',
      timeoutSeconds: 0,
    });
    expect(payload.name).toBe('销售库');
    expect(payload.base_url).toBe('http://x:1');
    expect(payload.secret_ref).toBe('vault://x');
    expect(payload.project_id).toBe('p');
    expect(payload.timeout_seconds).toBe(60); // 非法值归一
  });
});

describe('normalizeTimeout / buildConnectorOptions', () => {
  it('非正 / 非有限 → 默认 60', () => {
    expect(normalizeTimeout(0)).toBe(60);
    expect(normalizeTimeout(-3)).toBe(60);
    expect(normalizeTimeout(Number.NaN)).toBe(60);
    expect(normalizeTimeout(45.9)).toBe(45);
  });

  it('connector 候选：已知值原样返回；未知值追加「（现有）」动态项（不让历史值静默丢失）', () => {
    expect(buildConnectorOptions('postgres')).toEqual(CONNECTOR_OPTIONS);
    expect(buildConnectorOptions('')).toEqual(CONNECTOR_OPTIONS);
    const unknown = buildConnectorOptions('snowflake');
    expect(unknown).toHaveLength(CONNECTOR_OPTIONS.length + 1);
    expect(unknown[unknown.length - 1]).toBe('snowflake');
  });
});

describe('describeConnectionUpdateError（读 data 不读 message）', () => {
  it('★ 40900 读 data.name 给出冲突名', () => {
    const text = describeConnectionUpdateError(40900, { name: 'default' }, '名称冲突');
    expect(text).toContain('40900');
    expect(text).toContain('default');
  });

  it('40900 缺 data.name 也不崩（回退通用文案）', () => {
    expect(describeConnectionUpdateError(40900, null, '冲突')).toContain('40900');
  });

  it('42200 / 40300 / 50300 各有可诊断文案', () => {
    expect(describeConnectionUpdateError(42200, null, '连接不存在')).toContain('42200');
    expect(describeConnectionUpdateError(40300, null, 'forbidden')).toContain('iqd:modeling:edit');
    expect(describeConnectionUpdateError(50300, null, '未实现')).toContain('建设中');
  });

  it('未知码 / 无码：带码前缀或原样 message', () => {
    expect(describeConnectionUpdateError(50000, null, 'boom')).toBe('[50000] boom');
    expect(describeConnectionUpdateError(null, null, 'boom')).toBe('boom');
  });
});

describe('describeConnectionConfirm（二次确认文案）', () => {
  it('★★ 「启用」文案铁律：必须写「纳入问数」+「不影响其它连接」', () => {
    const copy = describeConnectionConfirm({
      kind: 'toggle',
      connection: connection({ enabled: false }),
      nextEnabled: true,
    });
    expect(copy.description).toContain('纳入问数');
    expect(copy.description).toContain('不影响其它连接');
    expect(copy.confirmLabel).toBe('确认启用');
  });

  it('★★ 「启用」文案铁律：**绝对不得**出现"自动停用其它连接"等连带停用表述', () => {
    const copy = describeConnectionConfirm({
      kind: 'toggle',
      connection: connection({ enabled: false }),
      nextEnabled: true,
    });
    // 该副作用在后端不存在（§14.5 已摘除"一期仅一条 enabled=true"约定；updateConnection
    // 只写目标行、无跨行联动、无悲观锁）。写了 = 编造副作用 = 用户不敢启用第二条连接。
    expect(copy.description).not.toMatch(/自动停用/);
    expect(copy.description).not.toMatch(/连带停用/);
    expect(copy.description).not.toMatch(/同步停用/);
    expect(copy.description).not.toMatch(/停用其它/);
    expect(copy.description).not.toMatch(/停用其他/);
  });

  it('「停用」也是破坏性 + 明示"不改变其它连接"', () => {
    const copy = describeConnectionConfirm({
      kind: 'toggle',
      connection: connection({ enabled: true }),
      nextEnabled: false,
    });
    expect(copy.title).toContain('停用');
    expect(copy.confirmLabel).toBe('确认停用');
    expect(copy.destructive).toBe(true);
    expect(copy.description).toContain('不改变其它连接');
    expect(copy.description).not.toMatch(/停用其它|停用其他/);
  });

  it('「编辑」确认：破坏性 + 点明只影响本连接 / 凭证留空保留原值', () => {
    const copy = describeConnectionConfirm({ kind: 'edit', connection: connection({ name: '销售库' }) });
    expect(copy.confirmLabel).toBe('确认保存');
    expect(copy.destructive).toBe(true);
    expect(copy.description).toContain('销售库');
    expect(copy.description).toContain('只影响本连接');
    expect(copy.description).toContain('保留原值');
  });

  it('回归：MCP 三类确认文案与既有行为逐字一致（start 非破坏性，stop/restart 破坏性）', () => {
    const start: PendingConfirm = { kind: 'mcp', action: 'start', id: 1 };
    const stop: PendingConfirm = { kind: 'mcp', action: 'stop', id: 1 };
    const restart: PendingConfirm = { kind: 'mcp', action: 'restart', id: 1 };

    expect(describeConnectionConfirm(start)).toEqual({
      title: '确认启动 MCP 进程？',
      description: '将拉起本连接的 WrenAI MCP 进程（就绪需数秒）。',
      confirmLabel: '确认启动',
      destructive: false,
    });
    expect(describeConnectionConfirm(stop)).toEqual({
      title: '确认停止 MCP 进程？',
      description: '停止会中断该连接上正在进行的问数/MCP 会话（project 目录默认保留）。',
      confirmLabel: '确认停止',
      destructive: true,
    });
    expect(describeConnectionConfirm(restart)).toEqual({
      title: '确认重启 MCP 进程？',
      description: '重启会中断该连接上正在进行的问数/MCP 会话（project 目录默认保留）。',
      confirmLabel: '确认重启',
      destructive: true,
    });
  });
});
