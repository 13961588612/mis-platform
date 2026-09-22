/**
 * iqd-layout.ts — 建模台画布布局读写（MR-S4 / system-design §4.4 d 点）。
 *
 * <p>布局独立存 `iqd_model_layout`（连接级 JSONB）：**视图数据与模型数据分离**
 * （Q6 裁决：不动 `iqd_catalog_item`，x/y 不入 catalog）。自动布局可随时覆盖重建。
 *
 * <p>权限码：`GET` → `iqd:modeling:view`；`PUT` / `auto-layout` → `iqd:modeling:edit`
 * （A-11：拖拽坐标即写库，归 `edit` 而非 `publish`）。
 *
 * <p><b>T01 全为 stub</b>：函数体 `Promise.reject(new Error('T03 实现'))`
 * （布局持久化与自动布局在 T03 = M2 建模全量落地）。
 */
import type { IqdModelLayoutDTO, LayoutAlgorithm, LayoutDirection } from '../types/modeling';

/** 自动布局入参（`POST /api/v1/iqd/modeling/layout/{connectionId}/auto-layout`）。 */
export interface AutoLayoutRequest {
  algorithm: LayoutAlgorithm;
  direction: LayoutDirection;
}

/** 未实现文案（统一 `T0X 实现` 格式）。 */
const NOT_IMPLEMENTED_T03 = 'T03 实现';

/**
 * 取连接级布局；服务端无记录时返回空布局
 * （`{nodes:[],edges:[],viewport:{x:0,y:0,zoom:1},auto_layout_version:0}`）。
 * `GET /api/v1/iqd/modeling/layout/{connectionId}`。
 */
export function getModelLayout(_connectionId: number): Promise<IqdModelLayoutDTO> {
  return Promise.reject(new Error(NOT_IMPLEMENTED_T03));
}

/**
 * 保存连接级布局（`base_version` 乐观并发；体积上限 1MB）。
 * `PUT /api/v1/iqd/modeling/layout/{connectionId}`。
 */
export function saveModelLayout(
  _connectionId: number,
  _layout: IqdModelLayoutDTO,
  _baseVersion: number,
): Promise<IqdModelLayoutDTO> {
  return Promise.reject(new Error(NOT_IMPLEMENTED_T03));
}

/**
 * 一键自动布局（dagre；A-02 默认前端跑，服务端端点作「整库重排」备选）。
 * `POST /api/v1/iqd/modeling/layout/{connectionId}/auto-layout`。
 */
export function autoLayout(
  _connectionId: number,
  _body: AutoLayoutRequest,
): Promise<IqdModelLayoutDTO> {
  return Promise.reject(new Error(NOT_IMPLEMENTED_T03));
}
