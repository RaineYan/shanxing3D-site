import * as THREE from '../vendor/three/three.module.js';

// Match the conservative polygon used by the cylinder narrow phase.
export function proxyGeometry(shape, axis = 'y') {
  const radius=0.5/Math.cos(Math.PI/16);
  const geometry = shape === 'cylinder' ? new THREE.CylinderGeometry(radius, radius, 1, 16) : new THREE.BoxGeometry(1, 1, 1);
  if(shape==='cylinder')geometry.rotateY(Math.PI/16);
  if (shape === 'cylinder' && axis === 'x') geometry.rotateZ(Math.PI / 2);
  if (shape === 'cylinder' && axis === 'z') geometry.rotateX(Math.PI / 2);
  return geometry;
}

// Low-poly rounded cube; analytic normals stay smooth across the six original faces.
function roundedBox() {
  const geometry=new THREE.BoxGeometry(1,1,1,4,4,4),positions=geometry.attributes.position,normals=geometry.attributes.normal;
  const v=new THREE.Vector3(),inner=new THREE.Vector3(),normal=new THREE.Vector3(),r=.14;
  for(let i=0;i<positions.count;i++){
    v.fromBufferAttribute(positions,i);inner.copy(v).clampScalar(-.5+r,.5-r);normal.subVectors(v,inner).normalize();v.copy(inner).addScaledVector(normal,r);
    positions.setXYZ(i,v.x,v.y,v.z);normals.setXYZ(i,normal.x,normal.y,normal.z);
  }
  return geometry;
}
function lathe(points,axis='y'){
  const geometry=new THREE.LatheGeometry(points.map(p=>new THREE.Vector2(...p)),16);
  if(axis==='x')geometry.rotateZ(Math.PI/2);if(axis==='z')geometry.rotateX(Math.PI/2);return geometry;
}
function visualCylinder(axis){
  const geometry=new THREE.CylinderGeometry(.5,.5,1,16);
  if(axis==='x')geometry.rotateZ(Math.PI/2);if(axis==='z')geometry.rotateX(Math.PI/2);return geometry;
}
export function createTemporaryVisual(asset) {
  const group = new THREE.Group();
  const base = new THREE.MeshLambertMaterial({ color: asset.color });
  const detail = new THREE.MeshLambertMaterial({ color: 0xe1dfc4 });
  const dark = new THREE.MeshLambertMaterial({ color: 0x30423c });
  const geometries=new Map();
  const geometry=(shape,axis)=>{
    const key=shape+axis;if(!geometries.has(key))geometries.set(key,
      shape==='rounded'?roundedBox():shape==='cylinder'?visualCylinder(axis):shape==='bottle-body'?lathe([[0,-.5],[.43,-.5],[.5,-.43],[.5,.23],[.43,.31],[.27,.36],[.27,.43],[0,.43]]):
      shape==='soft-cylinder'?lathe([[0,-.5],[.38,-.48],[.5,-.36],[.5,.36],[.38,.48],[0,.5]],axis):
      shape==='cup'?lathe([[0,-.5],[.5,-.5],[.5,.5],[.43,.5],[.43,-.42],[0,-.42]]):
      shape==='bundle-band'?lathe([[.46,-.5],[.5,-.5],[.5,.5],[.46,.5],[.46,-.5]]):
      shape==='lens-frame'?lathe([[.38,-.5],[.5,-.5],[.5,.5],[.38,.5],[.38,-.5]],axis):proxyGeometry(shape,axis));
    return geometries.get(key);
  };
  function part(shape, axis, scale, position, material = base) {
    const mesh = new THREE.Mesh(geometry(shape,axis), material);
    mesh.scale.set(...scale); mesh.position.set(...position); group.add(mesh);
    return mesh;
  }
  const seam=()=>part('box','y',[.82,.025,.02],[0,.32,.49],dark);
  const pouch=()=>{part('rounded','y',[1,1,.96],[0,0,-.02]);seam();part('box','y',[.035,.12,.04],[.29,.27,.48],detail);};
  switch (asset.visualType) {
    case 'tripod':
      for(let i=0;i<3;i++){const a=i*Math.PI*2/3,x=Math.cos(a)*.28,z=Math.sin(a)*.28;
        part('cylinder','y',[.22,.9,.22],[x,-.05,z]);
        for(const y of [-.36,-.05,.24])part('cylinder','y',[.28,.035,.28],[x,y,z],dark);
      }
      part('cylinder','y',[1,.1,1],[0,.45,0],detail);
      part('cylinder','y',[.32,.1,.32],[0,.35,0],dark);break;
    case 'trekking-poles':
      for(const x of [-.25,.25]){
        part('cylinder','y',[.18,.78,.18],[x,-.08,0]);
        part('cylinder','y',[.16,.03,.16],[x,-.485,0],dark);
        part('cylinder','y',[.5,.19,.5],[x,.405,0],detail);
        for(const y of [-.22,.05])part('cylinder','y',[.25,.025,.25],[x,y,0],dark);
      }
      // Generic demonstration retention cuffs, contained by the existing packed envelope.
      for(const y of [.35,.46])part('bundle-band','y',[1,.025,1],[0,y,0],dark).userData.visualRole='demo-retention-cuff';
      break;
    case 'bottle':
      part('bottle-body','y',[1,1,1],[0,0,0]);
      part('cylinder','y',[.60,.07,.60],[0,.465,0],dark);
      for(const y of [.45,.48])part('cylinder','y',[.606,.008,.606],[0,y,0],detail).userData.visualRole='cap-grip-ring';
      part('cylinder','y',[.62,.016,.62],[0,.435,0],detail);
      part('cylinder','y',[.98,.028,.98],[0,-.40,0],detail);break;
    case 'sleeping-pad':
      for(let i=0;i<6;i++)part('rounded','y',[1,.15,1],[0,-.425+i*.17,0],i%2?base:detail).userData.visualRole='accordion-layer';
      for(const x of [-.3,.3])part('box','y',[.03,1,.98],[x,0,0],dark);
      for(const x of [-.4,-.13,.13,.4])for(const z of [-.28,0,.28])part('cylinder','y',[.12,.025,.17],[x,.4875,z]);
      break;
    case 'sleeping-bag': case 'tent':
      part('soft-cylinder','x',[1,.98,.98],[0,0,0]);
      for(const x of [-.3,.3])part('cylinder','x',[.055,1,1],[x,0,0],dark);
      part('box','y',[.60,.02,.08],[0,.485,0],detail);
      part('cylinder','x',[.018,.28,.28],[.498-.008,0,0],detail);
      part('box','y',[.002,.12,.30],[.499,0,0],dark).userData.visualRole='packed-label';
      break;
    case 'headlamp':
      part('rounded','y',[1,.8,.64],[0,-.1,-.18]);
      part('rounded','y',[.5,.2,.4],[0,.4,-.18],dark);
      // Open annular bezel: no coplanar cap behind the front lens.
      part('lens-frame','z',[.55,.65,.36],[-.14,-.06,.32],dark);
      part('cylinder','z',[.4,.48,.025],[-.14,-.06,.4875],detail);
      part('cylinder','z',[.18,.22,.10],[.32,-.06,.19],detail);break;
    case 'cookware':
      part('cylinder','y',[1,.88,1],[0,-.06,0]);
      part('cylinder','y',[1,.06,1],[0,.41,0],detail);
      part('rounded','y',[.22,.06,.22],[0,.47,0],dark);
      for(const x of [-.23,.23])part('box','y',[.025,.025,.48],[x,.45,0],dark);break;
    case 'first-aid-kit':
      part('rounded','y',[1,1,.92],[0,0,-.04]);part('box','y',[.82,.025,.025],[0,.34,.43],dark);
      part('box','y',[.035,.12,.04],[.30,.29,.46],detail).userData.visualRole='zipper-pull';
      part('box','y',[.16,.46,.08],[0,-.05,.46],detail);
      for(const x of [-.155,.155])part('box','y',[.15,.16,.08],[x,-.05,.46],detail);break;
    default:
      if(asset.id==='mug'){
        part('cup','y',[.75,1,1],[-.125,0,0]);
        for(const y of [-.23,.23])part('rounded','y',[.3,.08,.14],[.35,y,0],dark);
        part('rounded','y',[.08,.54,.14],[.46,0,0],dark);part('box','y',[.08,.1,.1],[.46,0,0],detail);
      }else if(asset.id==='power-bank'){
        part('rounded','y',[1,1,.96],[0,0,-.02]);part('box','y',[.28,.05,.05],[-.2,.30,.475],dark);
        for(let i=0;i<4;i++)part('box','y',[.04,.03,.05],[.06+i*.07,.30,.475],detail);
      }else if(asset.id==='solar-panel'){
        part('rounded','y',[1,1,.96],[0,0,-.02]);
        for(const x of [-.27,0,.27])for(const y of [-.22,.22])part('box','y',[.23,.39,.04],[x,y,.48],dark);
        part('box','y',[.82,.02,.04],[0,0,.48],detail);
      }else if(asset.id==='towel'){
        for(let i=0;i<3;i++)part('rounded','y',[1,.30,.96],[0,-.35+i*.35,-.02]);
        part('box','y',[.12,1,.98],[0,0,0],detail);seam();
      }else{
        pouch();
        for(const x of [-.3,.3])part('box','y',[.035,.9,.025],[x,0,.48],dark);
      }
  }
  const size = asset.packedSizeM ?? { x: 0.1, y: 0.1, z: 0.1 };
  group.scale.set(size.x, size.y, size.z);
  group.name = 'temporary-visual';
  // All material instances are owned by this visual; discard any unused palette entry.
  const used=new Set();group.traverse(n=>{if(n.material)used.add(n.material);});for(const material of [base,detail,dark])if(!used.has(material))material.dispose();
  group.userData.visualStyle='packed-detail-v2';group.userData.representation='procedural-generic-not-manufacturer-mesh';
  return group;
}

export function createCollisionProxy(asset) {
  if (!asset.packedSizeM) return null; // Unknown dimensions cannot produce a valid physical proxy.
  const proxy = new THREE.Mesh(proxyGeometry(asset.collisionShape, asset.collisionAxis),
    new THREE.MeshBasicMaterial({ color: 0x314e30, wireframe: true, depthTest: false }));
  const { x, y, z } = asset.packedSizeM;
  proxy.scale.set(x, y, z);
  proxy.visible = false;
  proxy.renderOrder = 12;
  proxy.name = 'collision-proxy';
  proxy.userData = { shape: asset.collisionShape, axis: asset.collisionAxis, unit: 'm', dataLevel: asset.dataLevel };
  return proxy;
}
