/**
 * PublishPipelineBar.test.ts — 发布流水线状态机单测（T03d）。
 *
 * <p>为什么值得钉：四段流水线的**段状态映射**是纯展示逻辑，但错了会静默误导运维：
 * 「明明 build 失败却显示绿」、「版本落后却不提示待构建」、「漂移了还能点重建」
 * —— 三种都会让人做出错误处置。故把映射抽成纯函数 {@link resolvePipeline} 并在此穷举。
 *
 * <p>另外钉住**权限码**：本组件刻意不用 `iqd:modeling:publish`，因为后端把
 * 「发布 / 重建 / 对账 / MCP」分别绑在四个别的码上（V81/V84/V89）；码写错 =
 * 「按钮可点、点了 40300」。这些码一旦被误改，本用例会失败。
 */
import { describe, expect, it } from 'vitest';
// 用 types/modeling.ts 的**超集**类型（含 build_error / index_error；@/lib/api/iqd 的是窄版）
import type { IqdCatalogSyncStatus } from '../../types/modeling';
import { classifyStatus, mcpStageState, PIPELINE_PERMISSIONS, resolvePipeline } from './PublishPipelineBar';

/** 造一份 sync-status（只填被测字段）。 */
function status(partial: Partial<IqdCatalogSyncStatus>): IqdCatalogSyncStatus {
  return partial as IqdCatalogSyncStatus;
}

describe('classifyStatus（宽松词表归类）', () => {
  it('成功类词（大小写/空白容错）', () => {
    for (const word of ['success', 'SUCCEEDED', 'ok', 'completed', 'done', 'ready', ' synced ']) {
      expect(classifyStatus(word), word).toBe('ok');
    }
  });

  it('进行类词', () => {
    expect(classifyStatus('running')).toBe('active');
    expect(classifyStatus(' PENDING ')).toBe('active');
    expect(classifyStatus('indexing')).toBe('active');
  });

  it('失败类词', () => {
    expect(classifyStatus('failed')).toBe('failed');
    expect(classifyStatus('crashed')).toBe('failed');
    expect(classifyStatus('unhealthy')).toBe('failed');
  });

  it('空 / 未知 → idle（不误报成功）', () => {
    expect(classifyStatus(null)).toBe('idle');
    expect(classifyStatus(undefined)).toBe('idle');
    expect(classifyStatus('   ')).toBe('idle');
    expect(classifyStatus('whatever')).toBe('idle');
  });
});

describe('mcpStageState（MCP 的 running = 就绪，与 build/index 的 running 语义不同）', () => {
  it('★ running/ready/healthy → ok（**不是** active）', () => {
    expect(mcpStageState('running')).toBe('ok');
    expect(mcpStageState('READY')).toBe('ok');
    expect(mcpStageState('healthy')).toBe('ok');
  });

  it('starting/pending → active；stopped/crashed/unhealthy → failed；空/未知 → idle', () => {
    expect(mcpStageState('starting')).toBe('active');
    expect(mcpStageState('stopped')).toBe('failed');
    expect(mcpStageState('crashed')).toBe('failed');
    expect(mcpStageState('unhealthy')).toBe('failed');
    expect(mcpStageState('')).toBe('idle');
    expect(mcpStageState(null)).toBe('idle');
    expect(mcpStageState('weird')).toBe('idle');
  });

  it('回归守卫：mcpStageState("running") 与 classifyStatus("running") 必须不同', () => {
    expect(classifyStatus('running')).toBe('active'); // build/index 语境：进行中
    expect(mcpStageState('running')).toBe('ok'); // MCP 语境：就绪
  });
});

describe('resolvePipeline（四段状态机）', () => {
  it('无连接/未加载 → 四段全 idle，不报错不 busy', () => {
    const view = resolvePipeline(null, null);
    expect(view.stages.map((stage) => stage.state)).toEqual(['idle', 'idle', 'idle', 'idle']);
    expect(view.drift).toBe(false);
    expect(view.anyFailed).toBe(false);
    expect(view.busy).toBe(false);
  });

  it('★ 全绿：编辑已同步 + 构建成功 + 索引成功 + MCP running，且版本已追平', () => {
    const view = resolvePipeline(
      status({ edit_status: 'SYNCED', current_edit_revision: 3, built_edit_revision: 3, build_status: 'success', index_status: 'success' }),
      'running',
    );
    expect(view.stages.map((stage) => stage.state)).toEqual(['ok', 'ok', 'ok', 'ok']);
    expect(view.anyFailed).toBe(false);
    expect(view.busy).toBe(false);
  });

  it('★ 版本落后（built < current）→ build 段「待构建」(waiting)，不算 busy（否则禁用立即发布）', () => {
    const view = resolvePipeline(
      status({ edit_status: 'EDITED_UNSYNCED', current_edit_revision: 5, built_edit_revision: 3, build_status: 'success', index_status: 'success' }),
      'running',
    );
    const edit = view.stages.find((stage) => stage.key === 'edit');
    const build = view.stages.find((stage) => stage.key === 'build');
    expect(edit?.state).toBe('waiting');
    expect(build?.state).toBe('waiting');
    expect(build?.detail).toBe('待构建');
    expect(view.busy).toBe(false);
  });

  it('★ 构建失败 → 该段 failed + 带 build_error + 重试动作是 rebuild（幂等重试）', () => {
    const view = resolvePipeline(
      status({ edit_status: 'SYNCED', build_status: 'failed', build_error: 'SQL 解析失败: orders.ghost' }),
      'running',
    );
    const build = view.stages.find((stage) => stage.key === 'build');
    expect(build?.state).toBe('failed');
    expect(build?.error).toContain('orders.ghost');
    expect(build?.retry).toBe('rebuild');
    expect(view.anyFailed).toBe(true);
  });

  it('索引失败 → 段内重试 reindex；MCP 停机 → 段内重试 mcp_restart', () => {
    const indexView = resolvePipeline(status({ index_status: 'failed', index_error: 'embedding 服务不可用' }), 'running');
    expect(indexView.stages.find((s) => s.key === 'index')?.retry).toBe('reindex');
    expect(indexView.stages.find((s) => s.key === 'index')?.error).toContain('embedding');

    const mcpView = resolvePipeline(status({ edit_status: 'SYNCED', build_status: 'success', index_status: 'success' }), 'stopped');
    expect(mcpView.stages.find((s) => s.key === 'mcp')?.state).toBe('failed');
    expect(mcpView.stages.find((s) => s.key === 'mcp')?.retry).toBe('mcp_restart');
  });

  it('★ 漂移（fail-closed）：edit 段 blocked，drift=true，且不算 busy', () => {
    const view = resolvePipeline(status({ edit_status: 'STALE_DRIFT', stale_drift: true }), 'running');
    expect(view.drift).toBe(true);
    expect(view.stages.find((s) => s.key === 'edit')?.state).toBe('blocked');
    expect(view.anyFailed).toBe(false); // blocked 不等于 failed（它由 drift 横幅单独表达）
    expect(view.busy).toBe(false);
  });

  it('漂移的第二个信号：stale_drift=true 即使 edit_status 正常也算漂移', () => {
    expect(resolvePipeline(status({ edit_status: 'SYNCED', stale_drift: true }), 'running').drift).toBe(true);
    expect(resolvePipeline(status({ edit_status: 'SYNCED', stale_drift: false }), 'running').drift).toBe(false);
  });

  it('MCP starting → active（busy）；MCP 未知 → idle', () => {
    const starting = resolvePipeline(status({ edit_status: 'SYNCED', build_status: 'success', index_status: 'success' }), 'starting');
    expect(starting.stages.find((s) => s.key === 'mcp')?.state).toBe('active');
    expect(starting.busy).toBe(true);

    const unknown = resolvePipeline(status({ edit_status: 'SYNCED' }), null);
    expect(unknown.stages.find((s) => s.key === 'mcp')?.state).toBe('idle');
    expect(unknown.stages.find((s) => s.key === 'mcp')?.detail).toBe('未知');
  });

  it('SYNC_FAILED：编辑已落库 → 编辑段落 ok；失败由 MDL 构建段承担（避免「重试编辑落库」死循环）', () => {
    const view = resolvePipeline(
      status({ edit_status: 'SYNC_FAILED', build_status: 'failed', build_error: 'context build failed' }),
      'running',
    );
    const edit = view.stages.find((stage) => stage.key === 'edit');
    const build = view.stages.find((stage) => stage.key === 'build');
    expect(edit?.state).toBe('ok');
    expect(edit?.retry).toBeUndefined();
    expect(build?.state).toBe('failed');
    expect(build?.retry).toBe('rebuild');
  });

  it('段顺序固定：编辑 → 构建 → 索引 → MCP（UI 的箭头顺序依赖它）', () => {
    expect(resolvePipeline(null, null).stages.map((stage) => stage.key)).toEqual([
      'edit',
      'build',
      'index',
      'mcp',
    ]);
  });
});

describe('PIPELINE_PERMISSIONS（码必须与后端 sys_api 绑定一致）', () => {
  it('逐条钉住（改动即失败）：V81:60 / V81:64 / V84:58-60 / V89:105-110', () => {
    expect(PIPELINE_PERMISSIONS.publish).toBe('iqd:enhance:sync');
    expect(PIPELINE_PERMISSIONS.reconcile).toBe('iqd:catalog:edit');
    expect(PIPELINE_PERMISSIONS.selfHeal).toBe('iqd:selfheal:exec');
    expect(PIPELINE_PERMISSIONS.mcp).toBe('iqd:mcp:manage');
  });

  it('不得使用未被后端绑定的 iqd:modeling:publish 作动作码', () => {
    expect(Object.values(PIPELINE_PERMISSIONS)).not.toContain('iqd:modeling:publish');
  });
});
