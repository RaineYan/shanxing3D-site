import * as T from '../vendor/three/three.module.js';
import {PRODUCT_VARIANTS,BACKPACK_PROFILE}from'./physical-config.js';
import {createDemoAttachmentProfile}from'./backpack-attachments.js';
import {deepFreeze}from'./physical-data.js';
import {compileInteriorProfile}from'./interior-profile.js';

// Only the external dimensions are official. This is not a manufacturer mesh/interior.
const product=PRODUCT_VARIANTS['osprey-kestrel-38-2023-s23-lxl-eu'];
export const BACKPACK_SIZE_REFERENCE=deepFreeze({id:'kestrel38-s23-lxl-exterior-size-reference-v1',
 name:'Osprey Kestrel 38 · S23 · L/XL 外部尺寸参考',sizeM:product.specifications.externalDimensions.value,
 sourceUrl:'https://www.osprey.com/eu/osprey-kestrel-38-s23',
 manualUrl:'https://www.osprey.com/gb/media/user_manuals/OM_KestrelKyte_S23_ENG.pdf',
 verifiedAt:'2026-11-07',dataStatus:'verified',geometryStatus:'procedural-illustration',
 scope:'external-dimensions-only; not a verified product mesh or interior'});
const id=BACKPACK_SIZE_REFERENCE.id,size=BACKPACK_SIZE_REFERENCE.sizeM;
// The visual main shell and its demo chamber share these construction dimensions.
export const REFERENCE_MAIN_BODY=deepFreeze({sizeM:{x:size.x*.88,y:size.y*.92,z:size.z*.78},roundingM:.012});
const body=REFERENCE_MAIN_BODY.sizeM,sideInset=.012,endInset=.025,taper=.013;
const hw=body.x/2-sideInset,depth=body.z/2-sideInset,hy=body.y/2-endInset;
export const REFERENCE_INTERIOR_CONTOUR=deepFreeze({type:'convex-height-profile',centerX:0,chamferM:.012,
 sections:[{y:-hy,halfWidth:hw-taper,back:-depth+taper,front:depth-taper},
 {y:-hy+.06,halfWidth:hw,back:-depth,front:depth},
 {y:hy-.06,halfWidth:hw,back:-depth,front:depth},
 {y:hy,halfWidth:hw-taper,back:-depth+taper,front:depth-taper}]});
const interiorData=compileInteriorProfile(REFERENCE_INTERIOR_CONTOUR);
export const REFERENCE_INTERIOR_VOLUME_L=interiorData.volumeM3*1000;
const mounts=createDemoAttachmentProfile(id,size);
for(const anchor of mounts.attachments)if(['top','bottom'].includes(anchor.id)){
 const sign=anchor.id==='top'?1:-1;anchor.positionM[1]=sign*(size.y/2+.06);
 anchor.supportPointsM.forEach(p=>{p[1]=sign*(size.y/2-.03);});
}
export const LEGACY_REFERENCE_BACKPACK_PROFILE=deepFreeze({...BACKPACK_PROFILE,...mounts,
 externalSizeReference:BACKPACK_SIZE_REFERENCE,
 variantId:id,profileId:id+'-demo-packing',dataRevision:'official-exterior-reference-1',
 interior:{...BACKPACK_PROFILE.interior,
  limitations:'保留原4.507333333L局部演示轮廓，不代表Kestrel真实内仓；外部尺寸不能推出内部形状或容量'}});
export const REFERENCE_BACKPACK_PROFILE=deepFreeze({...LEGACY_REFERENCE_BACKPACK_PROFILE,dataRevision:'official-exterior-demo-chamber-2',workbenchAppearance:'lux3d-58475',
 interior:{...BACKPACK_PROFILE.interior,interiorModelId:id+'-main-body-demo-v2',dataStatus:'demo',representsCompleteInterior:false,
  modelingMethod:'inset-procedural-main-body-convex-profile',
  limitations:'依据程序示意主包体留边构建的主仓近似，含上下收窄，不含外袋；非实测Kestrel内仓，不能推定真实容量或装载能力',
  regions:[{...BACKPACK_PROFILE.interior.regions[0],id:id+'-main-body-demo-v2',sizeM:interiorData.sizeM,centerM:{x:0,y:0,z:0},
   profile:REFERENCE_INTERIOR_CONTOUR,source:'程序示意主包体：侧面/前后各留12mm，上下各留25mm，端部额外收窄13mm；演示几何依据，不是官方内壁数据'}]}});

function roundedBox(x,y,z,r){
 const g=new T.BoxGeometry(x,y,z,6,14,6),p=g.attributes.position,v=new T.Vector3(),q=new T.Vector3(),half=new T.Vector3(x/2-r,y/2-r,z/2-r);
 for(let i=0;i<p.count;i++){v.fromBufferAttribute(p,i);q.copy(v).clamp(half.clone().negate(),half);v.sub(q).normalize().multiplyScalar(r).add(q);p.setXYZ(i,v.x,v.y,v.z);}
 g.computeVertexNormals();g.computeBoundingBox();return g;
}
export function createReferenceBackpack(){
 const group=new T.Group();group.name='reference-backpack-appearance';
 group.userData={geometryRole:'official-size-illustration',referenceId:id,unit:'m',targetSizeM:{...size}};
 const {x,y,z}=size,materials=[0x536b58,0x344b40,0x75836a,0x243a32].map(color=>new T.MeshLambertMaterial({color}));
 function part(name,dimensions,position,color=0,r=.012){const mesh=new T.Mesh(roundedBox(...dimensions,Math.min(r,...dimensions.map(n=>n/3))),materials[color]);mesh.name=name;mesh.position.set(...position);group.add(mesh);}
 part('main-body',Object.values(REFERENCE_MAIN_BODY.sizeM),[0,0,0],0,REFERENCE_MAIN_BODY.roundingM);
 part('top-lid',[x*.94,y*.14,z*.82],[0,y*.43,0],1);
 part('reinforced-base',[x*.88,y*.10,z*.78],[0,-y*.45,0],1);
 for(const sign of [-1,1]){
  part('side-pocket',[x*.12,y*.38,z*.70],[sign*x*.44,-y*.19,0],2);
  part('folded-shoulder-strap',[x*.13,y*.54,z*.10],[sign*x*.22,y*.035,-z*.43],3);
  part('compression-band',[x*.92,y*.018,z*.83],[0,sign*y*.21,0],3,.002);
 }
 part('front-pocket',[x*.64,y*.43,z*.12],[0,-y*.08,z*.44],2);
 part('back-panel',[x*.58,y*.55,z*.10],[0,0,-z*.45],3);
 let disposed=false;return {appearance:group,dispose(){if(disposed)return;disposed=true;group.removeFromParent();group.traverse(n=>n.geometry?.dispose());materials.forEach(m=>m.dispose());}};
}
