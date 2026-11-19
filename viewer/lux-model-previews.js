import { Box3, Group, Vector3 } from '../vendor/three/three.module.js';

export const LUX_MODEL_PREVIEWS = Object.freeze([
  { id:'lux-legacy-backpack',name:'匿名演示背包 · Lux3D 外观',modelUrl:'assets/backpack.glb',kind:'backpack',longestSideM:0.79,sourceLabel:'Lux3D · 匿名模型预览',
    note:'最初导入的匿名背包外观。与默认 Kestrel 主背包分开预览；型号、真实尺寸与授权范围未核验。仅作外观预览，不参与装包计算。' },
  { id:'lux-compressed-sleeping-bag-70732',name:'压缩睡袋 · Lux3D 外观',modelUrl:'assets/lux3d/2026-11-16/original-compressed-sleeping-bag-70732.glb',kind:'sleeping-bag',longestSideM:0.42,sourceLabel:'Lux3D · 睡袋外观预览',
    note:'Lux3D 压缩睡袋外观。按 42 cm 最长边作画面显示，不代表已校准收纳尺寸；仅作外观预览，不参与装包计算。' },
  { id:'lux-nalgene-wide-mouth-80282',name:'Nalgene Wide Mouth · Lux3D 外观',modelUrl:'assets/lux3d/2026-11-19/nalgene-wide-mouth-80282-original.glb',kind:'water-bottle',longestSideM:0.21,sourceLabel:'Lux3D · 水壶外观预览',
    note:'队友新上传的 Nalgene Wide Mouth Lux3D 水壶模型。按 21 cm 最长边等比显示；模型与具体 SKU 的比例尚未校准，仅作外观预览，不参与装包计算。' },
  { id:'shanxing-backpack-assembly-demo',name:'山行背包装配 · 组件演示模型',modelUrl:'assets/generated/shanxing-procedural-backpack-assembly-demo.glb',kind:'backpack-assembly',longestSideM:0.79,sourceLabel:'程序生成 · 背包装配演示',
    note:'队友新上传的背包装配演示 GLB，由项目简化几何导出，包含 11 个可识别组件。按 79 cm 参考高度等比显示；外形、组件与尺寸均为演示数据，不代表实物扫描或 Lux3D 商品模型。仅作外观预览，不参与装包计算。' },
]);

export function prepareLuxModelPreview(model, definition) {
  model.updateWorldMatrix(true, true);
  const bounds = new Box3().setFromObject(model), raw = bounds.getSize(new Vector3());
  if (!raw.toArray().every(value => Number.isFinite(value) && value > 0)) throw Error('Lux3D 模型没有有效包围盒');
  const group = new Group(), offset = new Group();
  offset.add(model); offset.position.sub(bounds.getCenter(new Vector3())); group.add(offset);
  group.scale.setScalar(definition.longestSideM / Math.max(raw.x, raw.y, raw.z));
  group.name = definition.id;
  const worldSize = raw.clone().multiplyScalar(group.scale.x).toArray();
  group.userData = { geometryRole:'lux3d-appearance-preview',unit:'m',rawSize:raw.toArray(),worldSize,
    calibration:'visual framing only; not verified physical dimensions' };
  let disposed = false;
  return { group, worldSize, collisionProxy:null, asset:{...definition,previewOnly:true,modelStatus:'ready'},
    dispose() {
      if (disposed) return; disposed = true; group.removeFromParent();
      const geometries=new Set(),materials=new Set(),textures=new Set();
      group.traverse(node=>{if(node.geometry)geometries.add(node.geometry);for(const material of node.material?(Array.isArray(node.material)?node.material:[node.material]):[]){materials.add(material);for(const value of Object.values(material))if(value?.isTexture)textures.add(value);}});
      textures.forEach(texture=>texture.dispose()); materials.forEach(material=>material.dispose()); geometries.forEach(geometry=>geometry.dispose());
    } };
}

export async function loadLuxModelPreview(loader, definition) {
  const gltf=await loader.loadAsync(definition.modelUrl);
  return prepareLuxModelPreview(gltf.scene,definition);
}
