import { DATA_REVISION, deepFreeze, evidence, dimensionsInMeters, validateVariant, validatePackingProfile, resolveDimensions, projectProductSpec } from './physical-data.js';
import { compileInteriorProfile } from './interior-profile.js';
import { attachmentCompatibility, validateAttachmentProfile } from './attachment-rules.js';
import { createDemoAttachmentProfile } from './backpack-attachments.js';

// Archived pre-C2.1-R2 box: explicit regression fixture, never active production geometry.
export const LEGACY_BOX_SPACE = deepFreeze({ id:'legacy-demo-box', shape:'box', unit:'m', dataLevel:'demo',
  sizeM:{x:.22,y:.36,z:.14},centerM:{x:0,y:0,z:0},source:'历史规则盒，仅用于旧算法回归夹具' });
// XYZ surface probes exposed side recesses that X/Z projection alone bridged.
// Exclude the unreliable bottom band (Z rays and 1um-neighbourhood miss the body at y=-.17).
// Refine local side sections, preserving origin and all gear sizes; this is NOT a complete chamber.
const contour = deepFreeze({ type:'convex-height-profile', centerX:-.005, chamferM:.02,
  sections:[{y:-.16,halfWidth:.065,back:-.035,front:.095},
    {y:-.12,halfWidth:.07,back:-.035,front:.105},
    {y:.04,halfWidth:.065,back:-.025,front:.105},
    {y:.12,halfWidth:.055,back:-.015,front:.08}] });
const contourData = compileInteriorProfile(contour);

// Sole production source of physical dimensions. All existing demo numbers are unchanged.
const identity = () => ({ brand: null, model: null, selectedModelYear: null, officialModelYear: null,
  yearEvidenceOrigin: null, editionCode: null, version: null, size: null, market: null, capacityClassL: null });
function demoVariant(id, type, dimensions, state, source) {
  const demoSource = id + '-reference';
  const packed = evidence(id, 'm', dimensionsInMeters(dimensions), 'demo', [demoSource]);
  return { schemaVersion: 2, variantId: id, equipmentTypeId: type, recordKind: 'demo', identity: identity(),
    specifications: { externalDimensions: ['assembled', 'exterior'].includes(state) ? packed : evidence(id, 'm'),
      packedDimensions: state === 'exterior' ? evidence(id, 'm') : packed,
      weightKg: evidence(id, 'kg'), nominalCapacityL: evidence(id, 'L') },
    sources: [{ sourceId: demoSource, type: 'project-demo', url: null, checkedAt: null, scopeVariantId: id, notes: source }] };
}
const rows = [
  ['water-bottle', '水壶', '饮水', 'bottle', 'cylinder', 'y', [0.08, 0.22, 0.08], 0x668d83, 'assembled'],
  ['sleeping-bag', '睡袋（压缩收纳）', '睡眠', 'sleeping-bag', 'cylinder', 'x', [0.26, 0.16, 0.16], 0x768657, 'compressed'],
  ['sleeping-pad', '蛋巢垫（折叠收纳）', '睡眠', 'sleeping-pad', 'box', 'x', [0.52, 0.13, 0.14], 0x9b8864, 'folded'],
  ['raincoat', '雨衣（收纳）', '防护', 'raincoat', 'box', 'y', [0.16, 0.06, 0.12], 0xc4a45f, 'packed'],
  ['headlamp', '头灯', '照明', 'headlamp', 'box', 'y', [0.07, 0.045, 0.05], 0x566e73, 'assembled'],
  ['cookware', '锅具（收纳）', '炊具', 'cookware', 'cylinder', 'y', [0.15, 0.1, 0.15], 0x87938f, 'packed'],
  ['first-aid-kit', '急救包', '应急', 'first-aid-kit', 'box', 'y', [0.16, 0.1, 0.06], 0xa66554, 'packed'],
  ['tent', '帐篷（收纳）', '庇护', 'tent', 'cylinder', 'x', [0.45, 0.17, 0.17], 0x637d5c, 'packed'],
];
// New workbench-only fixtures, not branded product specifications or planner items.
const externalRows=[
  ['tripod','三脚架（收拢·演示）','摄影','tripod','cylinder','y',[.09,.52,.09],0x687372,'folded'],
  ['trekking-poles','登山杖（收拢·演示）','行走','trekking-poles','cylinder','y',[.06,.55,.06],0x778885,'folded'],
];
const mountOption=(interfaceTypes,shapes,packingStates,requires,rotationRad=[0,0,0])=>({interfaceTypes,shapes,packingStates,requires,rotationRad});
const mounting={
  'water-bottle':{options:[mountOption(['side-pocket'],['cylinder'],['assembled'],['base-support','neck-retention'])]},
  'sleeping-pad':{options:[mountOption(['paired-straps','supported-side'],['box'],['folded'],['paired-retention'])]},
  tent:{options:[mountOption(['paired-straps'],['cylinder'],['packed'],['paired-retention']),mountOption(['supported-side'],['cylinder'],['packed'],['paired-retention','base-support'])]},
  tripod:{options:[mountOption(['supported-side'],['cylinder'],['folded'],['paired-retention','base-support'],[0,0,-Math.PI/2])]},
  'trekking-poles':{options:[mountOption(['supported-side'],['cylinder'],['folded'],['paired-retention','base-support','tip-retention'],[0,0,-Math.PI/2]),mountOption(['tool-retainer'],['cylinder'],['folded'],['paired-retention','tip-retention'])]},
};
const variants = {}, profiles = {}, visuals = {}, mappings = {}, catalog = [], externalCatalog=[];
for (const [id, name, category, visualType, shape, axis, dimensions, color, state] of [...rows,...externalRows]) {
  const variantId = `demo-${id}-v1`, profileId = variantId + '-packing', visualAssetId = variantId + '-visual';
  const source = '项目开发自定收纳参考尺寸，非实测、非官方参数';
  variants[variantId] = demoVariant(variantId, id, dimensions, state, source);
  profiles[profileId] = { profileId, variantId, dataRevision: DATA_REVISION, packingState: state,
    referenceFrame: 'equipment-local-meters', dimensionsRef: 'packedDimensions',
    collision: { shape: 'obb', proxyShape: shape, axis, dimensionsRef: 'packedDimensions' },
    volumeEstimate: { shape, dimensionsRef: 'packedDimensions', method: 'analytic-proxy-estimate' },
    mounting:mounting[id]??{options:[]} };
  visuals[visualAssetId] = { assetId: visualAssetId, modelUrl: null, visualType, color, rawBounds: null,
    sourceUnit: 'm', sourceAxis: 'XYZ', declaredPackingState: state, physicalDimensionsRef: 'packedDimensions',
    representsVariantId: null, geometryValidationStatus: 'procedural-demo', licenseStatus: 'procedural',
    source: '项目程序生成，Three.js 内置几何体，非 Lux3D 模型' };
  mappings[id] = { variantId, profileId, visualAssetId }; (externalRows.some(r=>r[0]===id)?externalCatalog:catalog).push({ id, name, category });
}
const bagId = 'demo-backpack-v1', bagProfileId = bagId + '-packing';
variants[bagId] = demoVariant(bagId, 'backpack', [0.31458421028825045, 0.5, 0.3113136876969687], 'exterior',
  '开发参考外观高度，非品牌参数或实测；包含肩带的外包尺寸不等于内仓');
profiles[bagProfileId] = { profileId: bagProfileId, variantId: bagId, dataRevision: DATA_REVISION,
  referenceFrame: 'backpack-local-meters', dimensionsRef: 'externalDimensions',
  interior: { interiorModelId: bagId + '-interior-contour-v3', dataStatus: 'demo', modelingMethod: 'convex-height-profile-demo',
    scope: 'local-demonstration-region', representsCompleteInterior: false, uncertainty: 'unknown',
    nominalCapacityIsGeometry: false, limitations: '按当前匿名外观截面采样的保守近似；排除上部轮廓覆盖不可靠部分，非真实容量验证，未采样处误差未知',
    visualApproximation:{assetId:'legacy-demo-backpack-visual',method:'offline-XYZ-silhouette-probes-and-convex-section-fitting',
      verifiedAt:null,sampledAt:'2026-10-24',evidence:'docs/AUTOMATED_VERIFICATION.md',dataStatus:'demo'},
    regions: [{ id: 'demo-main', shape: 'convex-height-profile', profile:contour, unit: 'm', dataLevel: 'demo', dataStatus: 'demo',
      sizeM: contourData.sizeM, centerM: { x: 0, y: 0, z: 0 },
      source: '本地匿名外观截面采样后取保守分段凸轮廓，演示近似，非真实内壁或官方容量', sourceIds: [bagId + '-reference'], verifiedAt: null }] },
  ...createDemoAttachmentProfile(bagId,variants[bagId].specifications.externalDimensions.value) };
visuals['legacy-demo-backpack-visual'] = { assetId: 'legacy-demo-backpack-visual', modelUrl: './assets/backpack.glb',
  representsVariantId: null, rawBounds: { x: 0.6499999761581421, y: 1.0331096649169922, z: 0.643242359161377 },
  sourceUnit: 'unknown', sourceAxis: 'XYZ', declaredPackingState: 'exterior', physicalDimensionsRef: 'externalDimensions',
  calibrationPolicy: 'uniform-target-reference', source: '本地匿名 Lux3D 导出，非已核验品牌型号', geometryValidationStatus: 'demo-calibration' };

// Previously reviewed official facts only. Not selectable: no usable interior or matching visual.
const ospreyId = 'osprey-kestrel-38-2023-s23-lxl-eu', officialSource = 'osprey-eu-kestrel38-s23-spec-lxl';
const verified = (unit, value, raw) => evidence(ospreyId, unit, value, 'verified', [officialSource], '2026-10-23', raw);
variants[ospreyId] = { schemaVersion: 2, variantId: ospreyId, equipmentTypeId: 'backpack', recordKind: 'product',
  identity: { ...identity(), brand: 'Osprey', model: 'Kestrel 38', selectedModelYear: 2023,
    yearEvidenceOrigin: 'user-designated', editionCode: 'S23', version: 'S23', size: 'L/XL', market: 'EU', capacityClassL: 38 },
  specifications: { externalDimensions: verified('m', dimensionsInMeters([79, 34, 28], 'cm', ['height', 'width', 'depth']),
    { values: [79, 34, 28], unit: 'cm', axisOrder: ['height', 'width', 'depth'] }),
    packedDimensions: evidence(ospreyId, 'm'), weightKg: verified('kg', 1.93, { value: 1.93, unit: 'kg' }),
    nominalCapacityL: verified('L', 38, { value: 38, unit: 'L' }) },
  sources: [{ sourceId: officialSource, type: 'official-site', url: 'https://www.osprey.com/eu/osprey-kestrel-38-s23',
    section: 'Specifications / L/XL', checkedAt: '2026-10-23', scopeVariantId: ospreyId }],
  packingProfileId: null, visualAssetId: null, selectionStatus: 'reference-only' };

Object.values(variants).forEach(validateVariant);
export const PRODUCT_VARIANTS = deepFreeze(variants);
export const PACKING_PROFILES = deepFreeze(profiles);
export const VISUAL_ASSETS = deepFreeze(visuals);
export const LEGACY_ID_TO_VARIANT = deepFreeze(mappings);
export const ACTIVE_BACKPACK = deepFreeze({ variantId: bagId, profileId: bagProfileId,
  visualAssetId: 'legacy-demo-backpack-visual', dataRevision: DATA_REVISION });
export const BACKPACK_PROFILE = PACKING_PROFILES[ACTIVE_BACKPACK.profileId];
validateAttachmentProfile(BACKPACK_PROFILE);
export const BACKPACK_VARIANT = PRODUCT_VARIANTS[bagId];
export const EQUIPMENT_CATALOG = deepFreeze(catalog);
export const EXTERNAL_EQUIPMENT_CATALOG=deepFreeze(externalCatalog);
// Compatibility view: zero duplicate maintained size constants in consumers.
export function resolveGearAsset(id) {
  const binding = LEGACY_ID_TO_VARIANT[id];
  if (!binding) throw new Error('unknown-equipment-id');
  const variant = PRODUCT_VARIANTS[binding.variantId], profile = PACKING_PROFILES[binding.profileId];
  const visual = VISUAL_ASSETS[binding.visualAssetId], size = resolveDimensions(variant, profile);
  validatePackingProfile(variant, profile, visual);
  const compatibilityAsset={packedSizeM:size,collisionShape:profile.collision.proxyShape,packingState:profile.packingState,mounting:profile.mounting};
  return deepFreeze({ ...[...EQUIPMENT_CATALOG,...EXTERNAL_EQUIPMENT_CATALOG].find(row => row.id === id), ...binding, equipmentTypeId: id, dataRevision: DATA_REVISION,
    productVariant: variant, packingProfile: profile, visualAsset: visual,
    packedSizeM: size, collisionShape: profile.collision.proxyShape, collisionAxis: profile.collision.axis,
    packingState: profile.packingState,mounting:profile.mounting,
    externalAnchorIds:BACKPACK_PROFILE.attachments.filter(a=>attachmentCompatibility(compatibilityAsset,a).allowed).map(a=>a.id),
    modelUrl: visual.modelUrl, visualType: visual.visualType, color: visual.color, licenseStatus: visual.licenseStatus,
    modelVariantId: visual.representsVariantId, modelPackingState: visual.declaredPackingState,
    modelRotationRad: visual.rotationRad ?? { x:0, y:0, z:0 },
    modelStatus: 'idle', dataLevel: variant.specifications.packedDimensions.dataStatus,
    source: variant.sources[0].notes, modelSource: visual.source, weightSource: '未知，未测量',
    productSpec: projectProductSpec(variant) });
}
