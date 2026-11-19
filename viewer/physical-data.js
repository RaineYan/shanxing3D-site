// Pure physical-data contract. Conversion happens at data ingestion, never in rendering.
export const DATA_REVISION = 'physical-v2-demo-1';
export const axes = ['x', 'y', 'z'];
export const positive = value => Number.isFinite(value) && value > 0;
export function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze); Object.freeze(value);
  }
  return value;
}
export function dimensionsInMeters(values, unit = 'm', order = axes) {
  const factor = { m: 1, cm: 0.01, mm: 0.001 }[unit];
  const names = { x: 'x', y: 'y', z: 'z', width: 'x', height: 'y', depth: 'z' };
  if (!factor || !Array.isArray(values) || values.length !== 3 || !values.every(positive) ||
      !Array.isArray(order) || order.length !== 3 || new Set(order.map(key => names[key])).size !== 3 || order.some(key => !names[key])) throw new Error('invalid-dimension-unit-or-axes');
  return Object.fromEntries(order.map((key, i) => [names[key], values[i] * factor]));
}
export function weightInKg(value, unit) {
  if (!positive(value) || !['kg', 'g'].includes(unit)) throw new Error('invalid-weight-unit');
  return value * (unit === 'g' ? 0.001 : 1);
}
export function evidence(variantId, unit, value = null, dataStatus = 'missing', sourceIds = [], verifiedAt = null, raw = null) {
  return { value, unit, dataStatus, raw, sourceIds, verifiedAt, scopeVariantId: variantId };
}
export function validateVariant(variant) {
  if (!variant?.variantId || !variant.equipmentTypeId || !variant.identity || !variant.specifications || !Array.isArray(variant.sources)) throw new Error('invalid-product-variant');
  for (const key of ['brand', 'model', 'selectedModelYear', 'officialModelYear', 'editionCode', 'version', 'size', 'market', 'capacityClassL']) {
    if (!(key in variant.identity)) throw new Error('missing-identity-field:' + key);
  }
  for (const [key, unit] of Object.entries({ externalDimensions: 'm', packedDimensions: 'm', weightKg: 'kg', nominalCapacityL: 'L' })) {
    const field = variant.specifications[key];
    if (!field || field.unit !== unit || field.scopeVariantId !== variant.variantId || !['verified', 'demo', 'missing'].includes(field.dataStatus) || !Array.isArray(field.sourceIds)) throw new Error('invalid-field:' + key);
    if (field.dataStatus === 'missing') { if (field.value !== null) throw new Error('missing-value-must-be-null'); continue; }
    if (unit === 'm' ? !field.value || !axes.every(axis => positive(field.value[axis])) : !positive(field.value)) throw new Error('invalid-physical-value:' + key);
    const sources = field.sourceIds.map(id => variant.sources.find(source => source.sourceId === id && source.scopeVariantId === variant.variantId));
    if (!sources.length || sources.some(source => !source)) throw new Error('missing-scoped-evidence:' + key);
    if (field.dataStatus === 'verified') {
      const date = field.verifiedAt;
      if (![variant.identity.brand, variant.identity.model].every(value => typeof value === 'string' && value.trim()) ||
          !/^\d{4}-\d{2}-\d{2}$/.test(date ?? '') || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) throw new Error('invalid-verification');
      for (const source of sources) {
        let url; try { url = new URL(source.url); } catch { throw new Error('invalid-official-source'); }
        if (!['official-site', 'official-document'].includes(source.type) || url.protocol !== 'https:' || url.username || url.password) throw new Error('invalid-official-source');
      }
    }
  }
  return variant;
}
export function resolveDimensions(variant, profile) {
  validateVariant(variant);
  if (profile.variantId !== variant.variantId) throw new Error('profile-variant-mismatch');
  const field = variant.specifications[profile.dimensionsRef];
  if (!field || field.unit !== 'm' || field.dataStatus === 'missing') throw new Error('missing-packing-dimensions');
  return field.value;
}
export function validatePackingProfile(variant, profile, visual) {
  resolveDimensions(variant, profile);
  if (profile.collision && (profile.collision.dimensionsRef !== profile.dimensionsRef ||
      profile.volumeEstimate?.dimensionsRef !== profile.dimensionsRef ||
      !['box', 'cylinder'].includes(profile.collision.proxyShape) ||
      profile.volumeEstimate.shape !== profile.collision.proxyShape || !axes.includes(profile.collision.axis))) throw new Error('inconsistent-physical-references');
  if (visual && (visual.physicalDimensionsRef !== profile.dimensionsRef ||
      visual.declaredPackingState !== profile.packingState)) throw new Error('inconsistent-visual-reference');
  return profile;
}
// Flat legacy projection is read-only. Each parameter retains its own verification.
export function projectProductSpec(variant) {
  validateVariant(variant);
  const { identity, specifications: fields } = variant;
  const verified = key => fields[key].dataStatus === 'verified' ? fields[key] : null;
  const main = verified('weightKg') ?? verified('packedDimensions');
  const source = main && variant.sources.find(row => row.sourceId === main.sourceIds[0]);
  return deepFreeze({ brand: identity.brand, model: identity.model, version: identity.version, size: identity.size,
    variantId: variant.variantId, weightKg: verified('weightKg')?.value ?? null,
    packedDimensions: verified('packedDimensions')?.value ?? null, sourceUrl: source?.url ?? null,
    sourceType: source?.type ?? null, verifiedAt: main?.verifiedAt ?? null,
    dataStatus: main ? 'verified' : 'missing', fields: structuredClone(fields) });
}
export function instanceBinding(asset, instanceId) {
  if (typeof instanceId !== 'string' || !instanceId.trim() || !asset.variantId || !asset.profileId) throw new Error('invalid-instance-binding');
  return { instanceId, equipmentId: asset.id, equipmentTypeId: asset.equipmentTypeId,
    variantId: asset.variantId, profileId: asset.profileId, visualAssetId: asset.visualAssetId, dataRevision: asset.dataRevision };
}
