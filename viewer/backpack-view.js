// Own only the translucent copies; shared GLB materials are never modified.
export function createBackpackView(backpack) {
  const originals = new Map(), copies = new Map();
  function restore() {
    for (const [mesh, material] of originals) mesh.material = material;
    originals.clear();
  }
  return {
    set(mode) {
      if (!['exterior', 'transparent', 'inside'].includes(mode)) throw Error('Unknown backpack view');
      restore();
      backpack.visible = mode !== 'inside';
      if (mode !== 'transparent') return;
      const copy = material => {
        if (!copies.has(material)) {
          const result = material.clone();
          result.transparent = true;
          result.opacity = Math.min(material.opacity, .12);
          result.depthWrite = false;
          copies.set(material, result);
        }
        return copies.get(material);
      };
      backpack.traverse(mesh => {
        if (!mesh.isMesh || !mesh.material) return;
        originals.set(mesh, mesh.material);
        mesh.material = Array.isArray(mesh.material) ? mesh.material.map(copy) : copy(mesh.material);
      });
    },
    dispose() {
      restore();
      for (const material of copies.values()) material.dispose();
      copies.clear();
      backpack.visible = true;
    },
  };
}
