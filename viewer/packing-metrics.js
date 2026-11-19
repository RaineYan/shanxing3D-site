import { Vector3 } from '../vendor/three/three.module.js';
import { evaluatePlacement, worldProxyOBB, CONTACT_EPSILON_M } from './packing-collision.js';
import { placementType } from './external-placement.js';
import { compileInteriorProfile } from './interior-profile.js';

// Only confirmed, valid configured proxies occupy space. Never use visual GLB volume.
export function summarizeSpace(records, spaceObject) {
  const all = [...records], confirmed = all.filter(record => record.committed);
  const placed = confirmed.filter(record => placementType(record, record.committed) === 'internal');
  const result = { valid: false, pendingCount: all.length - confirmed.length, placedCount: placed.length,
    externalCount: confirmed.filter(record => placementType(record, record.committed) === 'external').length,
    spaceLiters: null, occupiedLiters: null, collisionBoxLiters: null,
    volumeBasis: 'configured-shape-estimate', ratio: null, invalidInstanceIds: [], error: null };
  try {
    // A single chamber is supported today. Never sum overlapping regional volumes.
    if (Array.isArray(spaceObject)) throw new Error('多区域空间尚未去重，暂无数据');
    if (!spaceObject?.geometry) throw new Error('缺少内部空间代理');
    spaceObject.geometry.computeBoundingBox(); spaceObject.updateWorldMatrix(true, false);
    const size = spaceObject.geometry.boundingBox.getSize(new Vector3());
    const profile=spaceObject.userData.interiorProfile;
    const spaceVolume = (profile ? compileInteriorProfile(profile).volumeM3 : size.x * size.y * size.z) * Math.abs(spaceObject.matrixWorld.determinant());
    result.interiorMethod=profile?'convex-height-profile-exact-section-integral':'box';
    if (!Number.isFinite(spaceVolume) || spaceVolume <= 0) throw new Error('内部空间尺寸或变换无效');
    result.spaceLiters = spaceVolume * 1000;
    let volume = 0, collisionVolume = 0;
    for (const record of placed) {
      const check = evaluatePlacement(record, confirmed, spaceObject, CONTACT_EPSILON_M, record.committed);
      if (!check.valid) { result.invalidInstanceIds.push(record.instanceId); continue; }
      const [a, b, c] = worldProxyOBB(record, record.committed).halfAxes;
      // Box: x*y*z; elliptical cylinder: pi*x*y*z/4, for any configured axis.
      // The half-axis determinant adds actual root/parent scaling exactly once, never AABB inflation.
      const factor = { box: 1, cylinder: Math.PI / 4 }[record.asset.collisionShape];
      if (!factor) throw new Error('碰撞代理形状未知，暂无数据');
      const boxVolume = Math.abs(a.dot(b.clone().cross(c))) * 8;
      collisionVolume += boxVolume;
      volume += boxVolume * factor;
    }
    if (result.invalidInstanceIds.length) throw new Error('已确认占位存在重叠、越界或缺少参数，无法估算');
    if (!Number.isFinite(volume) || volume > spaceVolume + 1e-10) throw new Error('代理体积超出内部空间，无法估算');
    result.occupiedLiters = volume * 1000; result.collisionBoxLiters = collisionVolume * 1000;
    result.ratio = volume / spaceVolume; result.valid = true;
  } catch (error) { result.error = error.message; }
  return result;
}
