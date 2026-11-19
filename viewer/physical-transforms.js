import { Vector3, Quaternion, Euler } from '../vendor/three/three.module.js';

const axes = ['x', 'y', 'z'];
const unitScale = scale => scale && axes.every(axis => Number.isFinite(scale[axis]) && Math.abs(scale[axis] - 1) < 1e-9);
// Source calibration belongs to the visual child. The physical root has no resizing mode.
export function protectPhysicalShape(record) {
  const children = [record.visual, record.collisionProxy].filter(Boolean).map(node => {
    node.updateMatrix();
    return { node, position: node.position.clone(), quaternion: node.quaternion.clone(), scale: node.scale.clone(),
      geometry: node.geometry, matrix: node.matrix.clone() };
  });
  record.assertPhysicalTransform = snapshot => {
    if (!unitScale(snapshot?.scale ?? record.group.scale)) throw new Error('invalid-physical-scale');
    for (const state of children) {
      state.node.updateMatrix();
      if (state.node.parent !== record.group || state.node.geometry !== state.geometry ||
          state.node.matrix.elements.some((value, i) => !Number.isFinite(value) || Math.abs(value - state.matrix.elements[i]) > 1e-9)) throw new Error('invalid-proxy-transform');
    }
  };
  record.restorePhysicalShape = () => {
    record.group.scale.set(1, 1, 1);
    for (const state of children) {
      if (state.node.parent !== record.group) record.group.add(state.node);
      state.node.position.copy(state.position); state.node.quaternion.copy(state.quaternion); state.node.scale.copy(state.scale);
      state.node.updateMatrix();
    }
  };
  return record;
}
export function frameId() { return 'backpack-local-meters'; }
export function localPose(record) {
  const plain = value => ({ x: value.x, y: value.y, z: value.z });
  return { positionM: plain(record.group.position), rotationRad: plain(record.group.rotation), scale: plain(record.group.scale),
    frameId: frameId(), placementType: record.placementType ?? 'internal', anchorId: record.anchorId ?? null };
}
export function applyLocalPose(record, next, frame) {
  record.restorePhysicalShape?.();
  if (record.group.parent !== frame) frame.add(record.group);
  record.placementType = next.placementType ?? 'internal';
  record.anchorId = record.placementType === 'external' ? next.anchorId : null;
  record.setPose(next.positionM, next.rotationRad);
  if (next.scale) record.group.scale.copy(next.scale);
}
// Precise input remains WORLD meters/degrees; only the instance's local pose is stored.
export function setWorldPose(record, positionM, rotationRad) {
  const parent = record.group.parent;
  parent?.updateWorldMatrix(true, false);
  if (!parent || parent.matrixWorld.equals(parent.matrixWorld.clone().identity())) {
    record.setPose(positionM, rotationRad); return;
  }
  const localPosition = parent.worldToLocal(new Vector3().copy(positionM));
  const parentRotation = parent.getWorldQuaternion(new Quaternion());
  const rotation = new Quaternion().setFromEuler(new Euler(rotationRad.x, rotationRad.y, rotationRad.z, 'XYZ'));
  const localRotation = new Euler().setFromQuaternion(parentRotation.invert().multiply(rotation), 'XYZ');
  record.setPose(localPosition, localRotation);
}
