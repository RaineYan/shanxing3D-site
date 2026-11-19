import { Box3, Matrix4, Vector3, Quaternion, Euler } from '../vendor/three/three.module.js';

import { BACKPACK_PROFILE } from './physical-config.js';
import { attachmentCompatibility, installationRotation, installationPosition, validateAttachmentProfile } from './attachment-rules.js';
import { officialWeightKg } from './product-specs.js';
import { transformOBB, intersectsOBB } from './packing-obb.js';

// Coordinates in the backpack's centered METER frame, not the source GLB's units.
// These are demonstrative fixed regions, not inferred real buckles or load ratings.
export const EXTERNAL_ANCHORS = BACKPACK_PROFILE.attachments;

export const attachmentProfileOf=record=>record?.attachmentProfile??record?.attachmentFrame?.userData.attachmentProfile??BACKPACK_PROFILE;
export const anchorById = (id,profile=BACKPACK_PROFILE) => profile.attachments.find(anchor => anchor.id === id);
export function compatibleAnchors(asset,profile=BACKPACK_PROFILE) {
  validateAttachmentProfile(profile);
  return profile.attachments.map(anchor=>({anchor,...attachmentCompatibility(asset,anchor,{weightKg:officialWeightKg(asset?.productSpec)})}));
}
export function anchorPose(id,asset=null,profile=BACKPACK_PROFILE) {
  validateAttachmentProfile(profile);
  const anchor = anchorById(id,profile);
  if (!anchor) throw new Error('invalid-anchor');
  const vector = values => ({ x: values[0], y: values[1], z: values[2] });
  const match=asset&&attachmentCompatibility(asset,anchor,{weightKg:officialWeightKg(asset.productSpec)});
  if(match&&!match.allowed)throw Error(match.reason);
  const rotation=match?installationRotation(anchor,match.option):new Euler(...anchor.rotationRad);
  return { positionM: vector(match?installationPosition(asset,anchor,match.option,profile.backpackCollision):anchor.positionM), rotationRad: {x:rotation.x,y:rotation.y,z:rotation.z}, placementType: 'external', anchorId: id };
}
export function placementType(record, snapshot = null) { return (snapshot ? snapshot.placementType : record.placementType) ?? 'internal'; }
export function assessAttachment(record,snapshot=null){
  const profile=attachmentProfileOf(record);validateAttachmentProfile(profile);
  const anchor=anchorById(snapshot?snapshot.anchorId:record.anchorId,profile);
  return{anchor,...attachmentCompatibility(record.asset,anchor,{weightKg:officialWeightKg(record.asset?.productSpec)})};
}
// Confirmed snapshots reserve resources even while their live draft edits another mount.
export function attachmentConflicts(record,records,snapshot=null){
  const profile=attachmentProfileOf(record),id=snapshot?snapshot.anchorId:record.anchorId,anchor=anchorById(id,profile);
  const result={instanceIds:[],errorCodes:[],used:0,capacity:anchor?.capacity??0};if(!anchor)return result;
  for(const other of records){
    if(other.instanceId===record.instanceId||!other.committed||placementType(other,other.committed)!=='external'||other.attachmentFrame!==record.attachmentFrame)continue;
    const occupied=anchorById(other.committed.anchorId,attachmentProfileOf(other));if(!occupied)continue;
    if(occupied.id===anchor.id){result.used++;if(result.used>=anchor.capacity){result.instanceIds.push(other.instanceId);result.errorCodes.push('anchor-capacity');}}
    else if(anchor.resourceIds.some(id=>occupied.resourceIds.includes(id))){result.instanceIds.push(other.instanceId);result.errorCodes.push('attachment-resource-conflict');}
  }
  result.errorCodes=[...new Set(result.errorCodes)];return result;
}

// OBB comes from the same configured proxy/world transform used by the collision pipeline.
export function checkExternalPlacement(record, obb, snapshot = null, epsilonM = 0.00001) {
  const assessment=assessAttachment(record,snapshot),anchor=assessment.anchor,frame = record.attachmentFrame;
  if(!assessment.allowed)return assessment.reason;
  if (!anchor || !frame ||
      (!snapshot && record.group.parent !== frame)) return 'invalid-anchor';
  frame.updateWorldMatrix(true, false);
  if (!frame.matrixWorld.elements.every(Number.isFinite) || !Number.isFinite(frame.matrixWorld.determinant()) || frame.matrixWorld.determinant() === 0) return 'invalid-anchor';
  const inverse = frame.matrixWorld.clone().invert();
  const position = snapshot ? new Vector3().copy(snapshot.positionM) : record.group.position;
  const rotation = snapshot ? new Euler(snapshot.rotationRad.x, snapshot.rotationRad.y, snapshot.rotationRad.z, 'XYZ') : record.group.rotation;
  const actual = new Matrix4().compose(position, new Quaternion().setFromEuler(rotation), (snapshot?.scale ? new Vector3().copy(snapshot.scale) : record.group.scale));
  const expectedPosition=installationPosition(record.asset,anchor,assessment.option,attachmentProfileOf(record).backpackCollision);
  const expected = new Matrix4().compose(new Vector3(...expectedPosition),
    new Quaternion().setFromEuler(installationRotation(anchor,assessment.option)), record.group.scale);
  // A fixed attachment cannot be dragged off its point or freely rotated and confirmed.
  if (actual.elements.some((value, index) => Math.abs(value - expected.elements[index]) > 1e-8)) return 'detached-anchor';
  const half = new Vector3(...anchor.regionSizeM).multiplyScalar(0.5), center = new Vector3(...anchor.positionM);
  center.set(...expectedPosition);
  const region = new Box3(center.clone().sub(half), center.clone().add(half));
  const e = inverse.elements;
  const tolerance = [0, 1, 2].map(row => epsilonM * Math.hypot(e[row], e[row + 4], e[row + 8]));
  if(obb.corners.some(corner => {
    const local = corner.clone().applyMatrix4(inverse);
    return ['x', 'y', 'z'].some((axis, index) => !Number.isFinite(local[axis]) || local[axis] < region.min[axis] - tolerance[index] || local[axis] > region.max[axis] + tolerance[index]);
  }))return 'outside-anchor-region';
  return checkBackpackCollision(record,obb,snapshot,epsilonM);
}
// Conservative exterior-envelope test, independent of the internal placement volume.
// Only a thin configured contact slab is exempt, never the entire backpack.
export function checkBackpackCollision(record,obb,snapshot=null,epsilonM=.00001){
  const profile=attachmentProfileOf(record),body=profile.backpackCollision,frame=record.attachmentFrame;
  if(!body||!frame)return 'invalid-backpack-collision';
  frame.updateWorldMatrix(true,false);
  const matrix=frame.matrixWorld.clone().multiply(new Matrix4().makeTranslation(...body.centerM));
  const half={x:body.sizeM[0]/2,y:body.sizeM[1]/2,z:body.sizeM[2]/2};
  const exterior=transformOBB({centerM:{x:0,y:0,z:0},halfSizeM:half},matrix);
  if(!obb.aabb.intersectsBox(exterior.aabb)||!intersectsOBB(obb,exterior,epsilonM))return null;
  const a=anchorById(snapshot?snapshot.anchorId:record.anchorId,profile),c=a?.contact;
  if(!c)return 'backpack-collision';
  const inverse=frame.matrixWorld.clone().invert(),i=['x','y','z'].indexOf(c.axis),e=inverse.elements;
  const tolerance=epsilonM*Math.hypot(e[i],e[i+4],e[i+8]);
  return obb.corners.some(v=>{
    const p=v.clone().applyMatrix4(inverse);
    const depth=body.sizeM[i]/2-c.sign*(p[c.axis]-body.centerM[i]);
    return depth>c.maxInsetM+tolerance;
  })?'backpack-collision':null;
}
