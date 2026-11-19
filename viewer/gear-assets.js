// Independent 3D assets; no planner/prepared state is stored here. Units: meters.
import { validateProductSpec } from './product-specs.js';
import { EQUIPMENT_CATALOG, EXTERNAL_EQUIPMENT_CATALOG, resolveGearAsset } from './physical-config.js';
export const GEAR_ASSETS = Object.freeze(EQUIPMENT_CATALOG.map(row => resolveGearAsset(row.id)));
export const WORKBENCH_ASSETS=Object.freeze([...GEAR_ASSETS,...EXTERNAL_EQUIPMENT_CATALOG.map(row=>resolveGearAsset(row.id))]);
export const VISUAL_TYPES = Object.freeze(['bottle', 'sleeping-bag', 'sleeping-pad', 'raincoat', 'headlamp', 'cookware', 'first-aid-kit', 'tent','tripod','trekking-poles']);

export function validateGearAsset(asset) {
  if (!asset || typeof asset.id !== 'string' || !asset.id.trim() ||
      typeof asset.name !== 'string' || !asset.name.trim()) throw new Error('装备需要稳定 ID 和名称。');
  if (!VISUAL_TYPES.includes(asset.visualType)) throw new Error('未知临时装备视觉类型。');
  if (asset.packingState !== undefined && !['assembled', 'packed', 'compressed', 'folded'].includes(asset.packingState)) throw new Error('未知装备收纳状态。');
  if (!['box', 'cylinder'].includes(asset.collisionShape) || !['x', 'y', 'z'].includes(asset.collisionAxis)) throw new Error('未知碰撞代理形状或轴向。');
  if (typeof asset.category !== 'string' || !asset.category.trim() || typeof asset.source !== 'string' || !asset.source.trim()) throw new Error('需要装备分类和数据来源。');
  if (asset.modelUrl !== null && (typeof asset.modelUrl !== 'string' || !asset.modelUrl.trim())) {
    throw new Error('模型路径需要非空字符串，未知时为 null。');
  }
  if (!['demo', 'estimated', 'measured', 'verified'].includes(asset.dataLevel)) throw new Error('需要注明尺寸数据级别。');
  if (asset.packedSizeM !== undefined &&
      (!asset.packedSizeM || !['x', 'y', 'z'].every(axis => Number.isFinite(asset.packedSizeM[axis]) && asset.packedSizeM[axis] > 0))) {
    throw new Error('收纳尺寸必须为米制有限正数，未知时不填。');
  }
  if (asset.weightKg !== undefined && (!Number.isFinite(asset.weightKg) || asset.weightKg <= 0)) {
    throw new Error('重量必须为公斤正数，未知时不填。');
  }
  if (asset.modelUrl && asset.licenseStatus !== 'approved') throw new Error('GLB 接入前需确认使用许可。');
  if (asset.productSpec) validateProductSpec(asset.productSpec);
  return asset;
}
