import * as THREE from '../vendor/three/three.module.js';
import { validateGearAsset } from './gear-assets.js';
import { createTemporaryVisual, createCollisionProxy } from './gear-geometry.js';
import { calibratePackedGLB, validatePackedModelDeclaration } from './model-calibration.js';

// One loader/cache for all gear. Cached visuals share resources; do not edit materials.
export function createGearLoader(loader) {
  const cache = new Map();
  function loadScene(url) {
    if (!cache.has(url)) {
      const pending = loader.loadAsync(url).then(gltf => gltf.scene).catch(error => {
        cache.delete(url); // A failed request must be retryable.
        throw error;
      });
      cache.set(url, pending);
    }
    return cache.get(url);
  }
  return async function loadGear(input, onStatus = () => {}) {
    const asset = { ...validateGearAsset(input), modelStatus: 'loading' };
    onStatus({ ...asset });
    let visual, loadError, calibration;
    if (asset.modelUrl) {
      try {
        validatePackedModelDeclaration(asset);
        ({ visual, calibration } = calibratePackedGLB(await loadScene(asset.modelUrl), asset));
        asset.modelStatus = 'ready';
      } catch (error) {
        loadError = String(error.message || error);
        visual = null;
      }
    }
    if (!visual) {
      visual = createTemporaryVisual(asset);
      asset.modelStatus = loadError ? 'fallback' : 'placeholder';
    }
    const group = new THREE.Group();
    group.name = asset.id;
    group.add(visual);
    const collisionProxy = createCollisionProxy(asset);
    if (collisionProxy) group.add(collisionProxy);
    group.userData = { variantId: asset.variantId, profileId: asset.profileId, dataRevision: asset.dataRevision, visualAssetId: asset.visualAssetId, assetId: asset.id, unit: 'm', dataLevel: asset.dataLevel,
      modelStatus: asset.modelStatus, packingState: asset.packingState,
      visualCalibration: asset.modelStatus === 'ready' ? 'configured-packed-reference' : 'procedural-packed-reference',
      sizeCalibration: calibration ?? null };
    let disposed = false;
    const result = { group, visual, collisionProxy, asset: { ...asset, ...(loadError ? { loadError } : {}) },
      dispose() {
        if (disposed) return;
        disposed = true;
        group.removeFromParent();
        const geometries = new Set(), materials = new Set();
        function collect(root) { root?.traverse(node => {
          if (node.geometry) geometries.add(node.geometry);
          for (const material of Array.isArray(node.material) ? node.material : [node.material]) if (material) materials.add(material);
        }); }
        // GLB visual resources belong to the shared cache, not this instance.
        if (asset.modelStatus !== 'ready') collect(visual);
        collect(collisionProxy);
        geometries.forEach(item => item.dispose()); materials.forEach(item => item.dispose());
      },
      setPose(positionM, rotationRad) {
        if (![positionM, rotationRad].every(vector => vector && ['x', 'y', 'z'].every(axis => Number.isFinite(vector[axis])))) {
          throw new Error('位置（米）和旋转（弧度）必须为有限数。');
        }
        // This root alone owns pose. Visual fitting/proxy shape never changes its scale.
        group.position.set(positionM.x, positionM.y, positionM.z);
        group.rotation.set(rotationRad.x, rotationRad.y, rotationRad.z, 'XYZ');
      } };
    onStatus(result.asset);
    return result;
  };
}
