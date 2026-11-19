import { Box3, Group, Vector3 } from '../vendor/three/three.module.js';

export const LUX_FIRST_AID_PREVIEW = Object.freeze({
  id: 'lux-lifesystems-trek-first-aid-preview',
  name: 'LifeSystems Trek 急救包 · Lux3D 外观预览',
  modelUrl: 'assets/lux3d/2026-11-16/lifesystems-trek-lux3d-g1-41671-original.glb',
  previewOnly: true,
  previewKind: 'lifesystems-trek-first-aid',
  referenceLongestSideM: 0.14,
});

// This is an isolated appearance preview. It never enters the packing model loader.
export function prepareLuxFirstAidPreview(model) {
  model.updateWorldMatrix(true, true);
  const bounds = new Box3().setFromObject(model);
  const raw = bounds.getSize(new Vector3());
  if (!raw.toArray().every(value => Number.isFinite(value) && value > 0)) {
    throw new Error('急救包模型没有有效包围盒');
  }

  const group = new Group();
  const offset = new Group();
  offset.add(model);
  offset.position.sub(bounds.getCenter(new Vector3()));
  group.add(offset);
  group.scale.setScalar(LUX_FIRST_AID_PREVIEW.referenceLongestSideM / Math.max(raw.x, raw.y, raw.z));
  group.name = LUX_FIRST_AID_PREVIEW.id;
  const worldSize = raw.clone().multiplyScalar(group.scale.x).toArray();
  group.userData = {
    geometryRole: 'lux3d-appearance-preview',
    unit: 'm',
    rawSize: raw.toArray(),
    worldSize,
    calibration: 'uniform longest-side appearance reference only; not packing-calibrated',
  };

  let disposed = false;
  return {
    group,
    worldSize,
    asset: { ...LUX_FIRST_AID_PREVIEW, modelStatus: 'ready' },
    collisionProxy: null,
    dispose() {
      if (disposed) return;
      disposed = true;
      group.removeFromParent();
      const geometries = new Set(), materials = new Set(), textures = new Set();
      group.traverse(node => {
        if (node.geometry) geometries.add(node.geometry);
        for (const material of node.material ? (Array.isArray(node.material) ? node.material : [node.material]) : []) {
          materials.add(material);
          for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
        }
      });
      textures.forEach(texture => texture.dispose());
      materials.forEach(material => material.dispose());
      geometries.forEach(geometry => geometry.dispose());
    },
  };
}

export async function loadLuxFirstAidPreview(loader) {
  const gltf = await loader.loadAsync(LUX_FIRST_AID_PREVIEW.modelUrl);
  return prepareLuxFirstAidPreview(gltf.scene);
}
