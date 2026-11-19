// OBBs in ordinary transforms; affine boxes under parent shear. No GPU resources.
import { Box3, Vector3 } from '../vendor/three/three.module.js';

const localBoxes = new WeakMap();
export function localProxyOBB(record) {
  const size = record?.asset?.packedSizeM;
  if (!size || !['x', 'y', 'z'].every(axis => Number.isFinite(size[axis]) && size[axis] > 0)) throw new Error('missing-dimensions');
  const key = `${size.x},${size.y},${size.z}`;
  let entry = localBoxes.get(record);
  if (!entry || entry.key !== key) {
    const local = Object.freeze({ centerM: Object.freeze({ x: 0, y: 0, z: 0 }),
      halfSizeM: Object.freeze({ x: size.x / 2, y: size.y / 2, z: size.z / 2 }) });
    entry = { key, local }; localBoxes.set(record, entry);
  }
  return entry.local;
}
export function transformOBB(local, matrix) {
  const center = new Vector3(local.centerM.x, local.centerM.y, local.centerM.z).applyMatrix4(matrix);
  const e = matrix.elements, h = local.halfSizeM;
  // Configured dimensions already belong to the instance root. Never apply proxy.scale again.
  const halfAxes = [new Vector3(e[0], e[1], e[2]).multiplyScalar(h.x),
    new Vector3(e[4], e[5], e[6]).multiplyScalar(h.y), new Vector3(e[8], e[9], e[10]).multiplyScalar(h.z)];
  const corners = [];
  for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) {
    corners.push(center.clone().addScaledVector(halfAxes[0], x).addScaledVector(halfAxes[1], y).addScaledVector(halfAxes[2], z));
  }
  if (![center, ...halfAxes, ...corners].every(v => [v.x, v.y, v.z].every(Number.isFinite)) ||
      !halfAxes.every(v => Number.isFinite(v.length()) && v.length() > 0)) throw new Error('invalid-matrix');
  const aabb = new Box3().setFromPoints(corners);
  if (!['x', 'y', 'z'].every(axis => aabb.max[axis] > aabb.min[axis])) throw new Error('invalid-matrix');
  return { center, halfAxes, corners, aabb };
}

export function intersectsOBB(a, b, epsilonM) {
  const edgesA = a.halfAxes.map(v => v.clone().normalize());
  const edgesB = b.halfAxes.map(v => v.clone().normalize());
  const normals = edges => [new Vector3().crossVectors(edges[1], edges[2]),
    new Vector3().crossVectors(edges[2], edges[0]), new Vector3().crossVectors(edges[0], edges[1])];
  const faceA = normals(edgesA), faceB = normals(edgesB);
  if (![...faceA, ...faceB].every(v => v.lengthSq() > 1e-24)) throw new Error('invalid-matrix');
  const candidates = [...faceA, ...faceB];
  for (const edgeA of edgesA) for (const edgeB of edgesB) candidates.push(new Vector3().crossVectors(edgeA, edgeB));
  const delta = b.center.clone().sub(a.center);
  // Separating axis theorem: 6 face normals and 9 edge cross products.
  // It also handles nonsingular affine boxes, rather than silently discarding shear.
  for (const candidate of candidates) {
    if (candidate.lengthSq() <= 1e-24) continue; // Parallel edges contribute no separating axis.
    candidate.normalize();
    const radius = box => box.halfAxes.reduce((sum, edge) => sum + Math.abs(edge.dot(candidate)), 0);
    const penetration = radius(a) + radius(b) - Math.abs(delta.dot(candidate));
    if (!Number.isFinite(penetration)) throw new Error('invalid-matrix');
    if (penetration <= epsilonM) return false; // Face / edge / point contact is allowed.
  }
  return true;
}
