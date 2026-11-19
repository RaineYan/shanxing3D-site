import { BACKPACK_VARIANT } from './physical-config.js';
import { projectProductSpec } from './physical-data.js';

// Curated configuration only. No fetching, user-entered weights or inferred GLB parameters.
export function unavailableProductSpec() {
  return Object.freeze({ brand: null, model: null, weightKg: null, packedDimensions: null,
    sourceUrl: null, sourceType: null, verifiedAt: null, dataStatus: 'missing' });
}
export const BACKPACK_PRODUCT_SPEC = projectProductSpec(BACKPACK_VARIANT); // The GLB has no verified product identity.
const positive = value => Number.isFinite(value) && value > 0;
export function validateProductSpec(spec) {
  if (!spec || !['verified', 'demo', 'missing'].includes(spec.dataStatus)) throw new Error('产品数据状态无效');
  if (spec.weightKg !== null && !positive(spec.weightKg)) throw new Error('官方重量未知时为 null，已知时必须是公斤正数');
  if (spec.packedDimensions !== null && (!spec.packedDimensions ||
      !['x', 'y', 'z'].every(axis => positive(spec.packedDimensions[axis])))) throw new Error('官方收纳尺寸需要米制正数');
  if (spec.dataStatus === 'verified') {
    const date = spec.verifiedAt;
    if (![spec.brand, spec.model].every(value => typeof value === 'string' && value.trim()) ||
        !['official-site', 'official-document'].includes(spec.sourceType) ||
        typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
        !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) throw new Error('已核验数据需要品牌、型号、官方来源类型和有效核验日期');
    let url;
    try { url = new URL(spec.sourceUrl); } catch { throw new Error('需要官方资料 URL'); }
    if (url.protocol !== 'https:' || url.username || url.password) throw new Error('官方资料需要无凭据的 HTTPS URL');
    if (spec.weightKg === null && spec.packedDimensions === null) throw new Error('已核验数据至少需要一项官方参数');
  }
  return spec;
}
export function officialWeightKg(spec) {
  try { validateProductSpec(spec); return spec.dataStatus === 'verified' ? spec.weightKg : null; }
  catch { return null; }
}
export function summarizeWeights(records, backpackSpec = BACKPACK_PRODUCT_SPEC) {
  const seen = new Set(), rows = new Map();
  let officialCount = 0, unknownCount = 0, officialSum = 0, pendingCount = 0;
  for (const record of records) {
    if (!record.instanceId || seen.has(record.instanceId)) throw new Error('重量统计需要唯一 instanceId');
    seen.add(record.instanceId);
    if (!record.committed) { pendingCount++; continue; }
    const asset = record.asset, kg = officialWeightKg(asset?.productSpec);
    if (kg !== null) { officialCount++; officialSum += kg; }
    else unknownCount++;
    const key = `${record.equipmentId}:${asset?.variantId??''}`;
    const row = rows.get(key) ?? { equipmentId: record.equipmentId, variantId:asset?.variantId??null, name: asset?.name ?? key, count: 0,
      officialUnitKg: kg };
    row.count++; rows.set(key, row);
  }
  const backpackKg = officialWeightKg(backpackSpec);
  const instanceCount = seen.size - pendingCount;
  const equipmentKg = officialCount ? officialSum : instanceCount ? null : 0;
  const knownCarryKg = officialCount || backpackKg !== null ? officialSum + (backpackKg ?? 0) : null;
  return { instanceCount, pendingCount, officialCount, unknownCount,
    knownEquipmentKg: equipmentKg, backpackKg, knownCarryKg,
    totalCarryKg: unknownCount === 0 && backpackKg !== null ? officialSum + backpackKg : null,
    rows: [...rows.values()] };
}
