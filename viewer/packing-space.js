import * as THREE from '../vendor/three/three.module.js';

import { BACKPACK_PROFILE, ACTIVE_BACKPACK } from './physical-config.js';
import { compileInteriorProfile } from './interior-profile.js';

// Display-validation data only. Never infer measured capacity from these values.
export const DEMO_BACKPACK_SPACE = BACKPACK_PROFILE.interior.regions[0];

export function createPackingSpace(space = DEMO_BACKPACK_SPACE) {
  const { x, y, z } = space.sizeM ?? {};
  if (space.unit !== 'm' || ![x, y, z].every(value => Number.isFinite(value) && value > 0)) {
    throw new Error('模拟空间需要以米为单位的有效正尺寸。');
  }
  const group = new THREE.Group();
  group.name = 'packing-space';
  group.userData = { ...ACTIVE_BACKPACK, spaceId: space.id, unit: 'm', dataLevel: space.dataLevel };
  // One centered physical origin, shared by the backpack and its local equipment.
  let geometry;
  if (space.profile) {
    const compiled=compileInteriorProfile(space.profile);
    geometry=new THREE.BufferGeometry();
    geometry.setAttribute('position',new THREE.Float32BufferAttribute(compiled.vertices.flat(),3));
    geometry.setIndex(compiled.triangles.flat());geometry.computeVertexNormals();
  } else geometry = new THREE.BoxGeometry(x, y, z);
  const material = new THREE.MeshBasicMaterial({
    color: 0x9dc782, transparent: true, opacity: 0.14,
    side: THREE.DoubleSide, depthTest: false, depthWrite: false,
  });
  const fill = new THREE.Mesh(geometry, material);
  if (space.profile) fill.userData.interiorProfile=space.profile;
  fill.renderOrder = 10;
  let edgeGeometry = new THREE.EdgesGeometry(geometry);
  const edgeMaterial = new THREE.LineBasicMaterial({
    color: 0xd4b26c, transparent: true, opacity: 0.95,
    depthTest: false, depthWrite: false,
  });
  const edges = new THREE.LineSegments(edgeGeometry, edgeMaterial);
  edges.position.copy(fill.position);
  edges.renderOrder = 11;
  group.add(fill, edges);
  // Authored contour coordinates already belong to the backpack frame; never recenter them.
  if (space.centerM) group.position.add(new THREE.Vector3().copy(space.centerM));
  group.visible = false;

  return {
    group,
    boundsObject: fill,
    setDefinition(next){
      const d=next.profile?compileInteriorProfile(next.profile):null,s=next.sizeM;
      if(next.unit!=='m'||!['x','y','z'].every(a=>Number.isFinite(s?.[a])&&s[a]>0))throw Error('模拟空间尺寸无效');
      if(d&&!['x','y','z'].every(a=>Math.abs(d.sizeM[a]-s[a])<1e-8))throw Error('模拟空间尺寸与轮廓不一致');
      const replacement=d?new THREE.BufferGeometry():new THREE.BoxGeometry(s.x,s.y,s.z);
      if(d){replacement.setAttribute('position',new THREE.Float32BufferAttribute(d.vertices.flat(),3));replacement.setIndex(d.triangles.flat());replacement.computeVertexNormals();}
      const wire=new THREE.EdgesGeometry(replacement);geometry.dispose();edgeGeometry.dispose();
      geometry=replacement;edgeGeometry=wire;fill.geometry=geometry;edges.geometry=wire;
      delete fill.userData.interiorProfile;if(next.profile)fill.userData.interiorProfile=next.profile;
      group.position.set(next.centerM?.x??0,next.centerM?.y??0,next.centerM?.z??0);group.userData.spaceId=next.id;
    },
    setVisible(visible) { group.visible = Boolean(visible); },
    dispose() {
      group.removeFromParent();
      geometry.dispose(); material.dispose();
      edgeGeometry.dispose(); edgeMaterial.dispose();
    },
  };
}
