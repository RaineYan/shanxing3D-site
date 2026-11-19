// Use the same vendored module URL as the browser import map; also testable in Node.
import { Matrix4, Vector3, Quaternion, Euler } from '../vendor/three/three.module.js';
import { localProxyOBB, transformOBB, intersectsOBB } from './packing-obb.js';
import { checkExternalPlacement, placementType, attachmentConflicts, assessAttachment } from './external-placement.js';
import { profileContainsCorners } from './interior-profile.js';
import { intersectsConfigured } from './packing-convex.js';

export const CONTACT_EPSILON_M = 0.00001; // 0.01 mm: touching is allowed, not counted as overlap.
const axes = ['x', 'y', 'z'];
function finiteBox(box) {
  return axes.every(axis => Number.isFinite(box.min[axis]) && Number.isFinite(box.max[axis]) && box.max[axis] > box.min[axis]);
}
function invertible(matrix) {
  return matrix.elements.every(Number.isFinite) && Number.isFinite(matrix.determinant()) && matrix.determinant() !== 0;
}
function localBounds(object) {
  if (!object?.geometry) throw new Error('missing-proxy');
  if (!object.geometry.boundingBox) object.geometry.computeBoundingBox();
  const box = object.geometry.boundingBox;
  if (!box || !finiteBox(box)) throw new Error('invalid-proxy');
  object.updateWorldMatrix(true, false);
  if (!invertible(object.matrixWorld)) throw new Error('invalid-matrix');
  return box;
}
function proxyMatrix(record, placement) {
  if (!record?.collisionProxy) throw new Error('missing-proxy');
  record.collisionProxy.updateWorldMatrix(true, false);
  const root = record.group;
  root.updateWorldMatrix(true, false);
  if (!placement && !invertible(root.matrixWorld)) throw new Error('invalid-matrix');
  if (!placement) return root.matrixWorld.clone();
  if (![placement.positionM, placement.rotationRad].every(vector => vector && axes.every(axis => Number.isFinite(vector[axis])))) throw new Error('invalid-pose');
  // Evaluate a confirmed root pose without moving its live draft or scaling dimensions twice.
  const rotation = placement.rotationRad, position = placement.positionM;
  const matrix = new Matrix4().compose(new Vector3(position.x, position.y, position.z),
    new Quaternion().setFromEuler(new Euler(rotation.x, rotation.y, rotation.z, 'XYZ')), placement.scale ? new Vector3().copy(placement.scale) : root.scale);
  // A committed reservation may use another frame while the live draft switches mode.
  const parent = placementType(record, placement) === 'external' ? record.attachmentFrame : record.internalParent ?? root.parent;
  if (parent) { parent.updateWorldMatrix(true, false); matrix.premultiply(parent.matrixWorld); }
  return matrix;
}
export function worldProxyOBB(record, placement = null) {
  record.assertPhysicalTransform?.(placement);
  return transformOBB(localProxyOBB(record), proxyMatrix(record, placement));
}
export function worldProxyAABB(record, placement = null) {
  const box = worldProxyOBB(record, placement).aabb;
  if (!finiteBox(box)) throw new Error('invalid-proxy');
  return box;
}
function plainBox(box) {
  return { min: { x: box.min.x, y: box.min.y, z: box.min.z }, max: { x: box.max.x, y: box.max.y, z: box.max.z } };
}
// Live draft appearance is advisory only: it never becomes confirmed occupancy.
export function findDraftOverlaps(current, records, epsilonM = CONTACT_EPSILON_M) {
  const overlaps = [];
  try {
    const box = worldProxyOBB(current);
    for (const other of records) {
      if (other.instanceId === current.instanceId || (other.committed && !other.editing)) continue;
      const draft = worldProxyOBB(other);
      if (box.aabb.intersectsBox(draft.aabb) && intersectsOBB(box, draft, epsilonM) && intersectsConfigured(current.asset,box,other.asset,draft,epsilonM)) overlaps.push(other.instanceId);
    }
  } catch { /* The authoritative placement check reports invalid proxies separately. */ }
  return overlaps;
}
export function evaluatePlacement(current, records, spaceObject, epsilonM = CONTACT_EPSILON_M, placement = null) {
  const result = { valid: false, outOfBounds: false, overlapInstanceIds: [], errorCodes: [], aabbM: null,
    algorithm: 'AABB+OBB-SAT', shapeNarrowPhase: 'circumscribed-cylinder-16-SAT', obbM: null, narrowPhaseChecks: 0 };
  try {
    if (!current?.instanceId || !Number.isFinite(epsilonM) || epsilonM < 0) throw new Error('invalid-input');
    const others=Array.isArray(records)?records:[...records]; // Map iterators must survive both resource and OBB passes.
    const obb = worldProxyOBB(current, placement); // Optional snapshot: inspect confirmed occupancy without moving a draft.
    const bounds = obb.aabb;
    if (!finiteBox(bounds)) throw new Error('invalid-proxy');
    result.aabbM = plainBox(bounds);
    const plainVector = v => ({ x: v.x, y: v.y, z: v.z });
    result.obbM = { centerM: plainVector(obb.center), halfAxesM: obb.halfAxes.map(plainVector) };
    if (placementType(current, placement) === 'external') {
      const assessment=assessAttachment(current,placement);
      result.attachment={anchorId:assessment.anchor?.id??null,backpackVariantId:assessment.anchor?.variantId??null,interfaceType:assessment.anchor?.type??null,dataStatus:assessment.dataStatus,loadStatus:assessment.loadStatus,warning:assessment.warning??null,backpackCollisionStatus:current.attachmentProfile?.backpackCollision?.dataStatus??'demo'};
      const error = checkExternalPlacement(current, obb, placement, epsilonM);
      if (error) result.errorCodes.push(error);
      const conflicts=attachmentConflicts(current,others,placement);result.attachmentConflicts=conflicts;
      result.errorCodes.push(...conflicts.errorCodes);
    } else if (placementType(current, placement) !== 'internal') throw new Error('invalid-placement-type');
    else {
      const space = localBounds(spaceObject);
      const inverse = new Matrix4().copy(spaceObject.matrixWorld).invert();
      if (!inverse.elements.every(Number.isFinite)) throw new Error('invalid-matrix');
      // All eight world OBB corners must be inside the actual space-local box, never just its center.
      const localCorners = obb.corners.map(corner => corner.clone().applyMatrix4(inverse));
      if (!localCorners.every(v => axes.every(axis => Number.isFinite(v[axis])))) throw new Error('invalid-matrix');
      const e = inverse.elements;
      const localTolerance = [0, 1, 2].map(row => epsilonM * Math.hypot(e[row], e[row + 4], e[row + 8]));
      result.outOfBounds = spaceObject.userData.interiorProfile
        ? !profileContainsCorners(spaceObject.userData.interiorProfile,localCorners,localTolerance)
        : localCorners.some(corner => axes.some((axis, index) => corner[axis] < space.min[axis] - localTolerance[index] || corner[axis] > space.max[axis] + localTolerance[index]));
      if (result.outOfBounds) result.errorCodes.push('out-of-bounds');
    }
    for (const other of others) {
      if (other.instanceId === current.instanceId || !other.committed) continue;
      const occupied = worldProxyOBB(other, other.committed);
      if (!bounds.intersectsBox(occupied.aabb)) continue;
      result.narrowPhaseChecks++;
      if (intersectsOBB(obb, occupied, epsilonM) && intersectsConfigured(current.asset,obb,other.asset,occupied,epsilonM)) {
        result.overlapInstanceIds.push(other.instanceId);
      }
    }
    if (result.overlapInstanceIds.length) result.errorCodes.push('overlap');
    result.valid = result.errorCodes.length === 0;
  } catch (error) {
    result.errorCodes.push(error.message || 'invalid-input');
  }
  return result;
}
