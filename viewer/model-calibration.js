import { Box3, Group, Vector3 } from '../vendor/three/three.module.js';

const axes = ['x', 'y', 'z'];
export function worldDimensions(object) { object.updateWorldMatrix(true, true); return new Box3().setFromObject(object).getSize(new Vector3()); }

// Never mutate cached GLB scenes and never stretch axes independently to force a fit.
export function fitUniformModel(source, targetM, rotationRad = { x: 0, y: 0, z: 0 }) {
  const raw = worldDimensions(source);
  if (!axes.every(axis => Number.isFinite(raw[axis]) && raw[axis] > 0 && Number.isFinite(targetM?.[axis]) && targetM[axis] > 0 && Number.isFinite(rotationRad?.[axis]))) throw new Error('模型或目标尺寸无效。');
  const oriented = new Group(); oriented.add(source.clone(true));
  oriented.rotation.set(rotationRad.x, rotationRad.y, rotationRad.z, 'XYZ');
  const bounds = new Box3().setFromObject(oriented), size = bounds.getSize(new Vector3());
  const scale = Math.min(...axes.map(axis => targetM[axis] / size[axis]));
  const fitted = size.clone().multiplyScalar(scale);
  // Small mesh/measurement rounding is allowed, substantial shape differences are not.
  if (axes.some(axis => Math.abs(fitted[axis] - targetM[axis]) / targetM[axis] > 0.02)) throw new Error('GLB纵横比或轴向与目标收纳尺寸不匹配，使用收纳占位模型。');
  oriented.position.sub(bounds.getCenter(new Vector3()));
  const visual = new Group(); visual.add(oriented); visual.scale.setScalar(scale);
  return { visual, calibration: { rawSize: raw.toArray(), orientedSourceSize: size.toArray(),
    targetSizeM: axes.map(axis => targetM[axis]), uniformScale: scale, fitSizeM: fitted.toArray(), unit: 'm' } };
}

export function validatePackedModelDeclaration(asset) {
  if (!asset.variantId || asset.modelVariantId !== asset.variantId) throw new Error('GLB未绑定当前具体型号，使用收纳占位模型。');
  if (!asset.packingState || asset.modelPackingState !== asset.packingState) throw new Error('GLB收纳状态未核对或不匹配，使用收纳占位模型。');
}
export function calibratePackedGLB(source, asset) {
  validatePackedModelDeclaration(asset);
  let skinned = false;source.traverse(node=>{if(node.isSkinnedMesh)skinned=true;});
  if(skinned)throw new Error('骨骼模型尚未经过独立实例校验，使用收纳占位模型。');
  return fitUniformModel(source, asset.packedSizeM, asset.modelRotationRad ?? { x: 0, y: 0, z: 0 });
}
