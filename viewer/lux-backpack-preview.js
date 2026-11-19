import {Box3,Group,Vector3}from'../vendor/three/three.module.js';
import {BACKPACK_SIZE_REFERENCE}from'./reference-backpack.js';
export const LUX_BACKPACK_PREVIEW={id:'lux-kestrel38-s23-58475',name:'Osprey Kestrel 38 S23 黑色 · Lux3D新模型',
 modelUrl:'assets/lux3d/2026-11-08/kestrel38-s23-black-asset58475-original.glb',
 resultUrl:'https://lux3d.aholo3d.cn/workspace/image-to-3d?assetId=58475',
 sourceUrl:'https://www.trekitt.co.uk/rucksacks/outdoor-rucksacks/osprey-mens-kestrel-38-black__49424',
 previewOnly:true,modelStatus:'ready',heightReferenceM:BACKPACK_SIZE_REFERENCE.sizeM.y,defaultAppearance:true};
// A height reference is not three-axis calibration. This visual never enters packing.
export function prepareLuxBackpackPreview(model){
 model.updateWorldMatrix(true,true);const box=new Box3().setFromObject(model),raw=box.getSize(new Vector3());
 if(!raw.toArray().every(n=>Number.isFinite(n)&&n>0))throw Error('新模型没有有效包围盒');
 const group=new Group(),offset=new Group();offset.add(model);offset.position.sub(box.getCenter(new Vector3()));group.add(offset);
 group.scale.setScalar(LUX_BACKPACK_PREVIEW.heightReferenceM/raw.y);group.name=LUX_BACKPACK_PREVIEW.id;
 const size=raw.clone().multiplyScalar(group.scale.x).toArray();
 group.userData={geometryRole:'lux3d-appearance-preview',assetId:58475,unit:'m',rawSize:raw.toArray(),worldSize:size,calibration:'height-only; not verified physical dimensions'};
 let disposed=false;return{group,asset:{...LUX_BACKPACK_PREVIEW},collisionProxy:null,worldSize:size,
 dispose(){if(disposed)return;disposed=true;group.removeFromParent();const geometries=new Set(),materials=new Set(),textures=new Set();group.traverse(n=>{if(n.geometry)geometries.add(n.geometry);for(const m of n.material?(Array.isArray(n.material)?n.material:[n.material]):[]){materials.add(m);for(const v of Object.values(m))if(v?.isTexture)textures.add(v);}});textures.forEach(t=>t.dispose());materials.forEach(m=>m.dispose());geometries.forEach(g=>g.dispose());}};
}
export async function loadLuxBackpackPreview(loader){const gltf=await loader.loadAsync(LUX_BACKPACK_PREVIEW.modelUrl);return prepareLuxBackpackPreview(gltf.scene);}
// Only the object tree is cloned. Mesh buffers/textures belong to the shared cache;
// closing a workbench must never dispose another view's resources.
export function cloneLuxBackpackForWorkbench(preview){
 if(preview?.group?.userData?.assetId!==58475)throw Error('Lux3D背包缓存无效');
 const appearance=preview.group.clone(true);appearance.name='reference-backpack-appearance';appearance.visible=false;
 appearance.userData={...appearance.userData,geometryRole:'lux3d-workbench-appearance'};
 return{appearance,worldSize:[...preview.worldSize],isLux3D:true};
}
