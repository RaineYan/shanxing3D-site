import { Box3, Group, Vector3 } from '../vendor/three/three.module.js';
import { fitUniformModel } from './model-calibration.js';

import { BACKPACK_VARIANT, ACTIVE_BACKPACK } from './physical-config.js';

// A reference for this generated, unidentified GLB, never an official product size.
const EXTERIOR_SIZE_M = BACKPACK_VARIANT.specifications.externalDimensions.value;
export const BACKPACK_REFERENCE = Object.freeze({ heightM: EXTERIOR_SIZE_M.y, dataStatus: 'demo', sizeM: EXTERIOR_SIZE_M,
  ...ACTIVE_BACKPACK, source: BACKPACK_VARIANT.sources[0].notes });

export function createMetricBackpack(model, reference = BACKPACK_REFERENCE) {
  const bounds = new Box3().setFromObject(model), raw = bounds.getSize(new Vector3());
  if (![raw.x, raw.y, raw.z, reference.heightM].every(value => Number.isFinite(value) && value > 0)) throw new Error('背包外观缺少有效尺寸。');
  const target = reference.sizeM ?? raw.clone().multiplyScalar(reference.heightM / raw.y);
  const { visual: appearance, calibration } = fitUniformModel(model, target);
  const scale = calibration.uniformScale;
  appearance.name = 'backpack-appearance';
  // Meter frame stays scale=1. Only the appearance child converts source units once.
  const frame = new Group(); frame.name = 'backpack-meter-frame'; frame.add(appearance);
  frame.userData = { variantId: reference.variantId, profileId: reference.profileId, dataRevision: reference.dataRevision,
    unit: 'm', dataStatus: reference.dataStatus, source: reference.source,
    rawSize: raw.toArray(), modelScaleToMeters: scale, exteriorSizeM: calibration.fitSizeM,
    targetExteriorSizeM: calibration.targetSizeM,
    originDefinition: 'visual-AABB-center; not a measured main-compartment origin',
    interiorAlignmentStatus: 'demo-region-not-mesh-validated' };
  return { frame, appearance };
}
