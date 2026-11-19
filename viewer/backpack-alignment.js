import { Box3, Box3Helper, Group, AxesHelper, Mesh, SphereGeometry, MeshBasicMaterial, Matrix4, Vector3, EdgesGeometry, LineSegments, LineBasicMaterial } from '../vendor/three/three.module.js';
import { compileInteriorProfile } from './interior-profile.js';

// Measure in the physical frame, never inverse-transform an already inflated world AABB.
export function boundsInFrame(object, frame) {
  frame.updateWorldMatrix(true, false); object.updateWorldMatrix(true, true);
  const inverse = frame.matrixWorld.clone().invert(), box = new Box3();
  object.traverse(node => {
    if (!node.geometry) return;
    if (!node.geometry.boundingBox) node.geometry.computeBoundingBox();
    box.union(node.geometry.boundingBox.clone().applyMatrix4(new Matrix4().multiplyMatrices(inverse, node.matrixWorld)));
  });
  return box;
}
export function alignmentReport(appearance, frame, space) {
  const outer = boundsInFrame(appearance, frame), inner = boundsInFrame(space.boundsObject, frame);
  const plain = box => ({ minM: box.min.toArray(), maxM: box.max.toArray(), centerM: box.getCenter(new Vector3()).toArray(), sizeM: box.getSize(new Vector3()).toArray() });
  return { unit: 'm', coordinateFrame: 'backpack-local-meters',
    originDefinition: 'visual-AABB-center; not a measured main-compartment origin',
    samePhysicalParent: appearance.parent === frame && space.group.parent === frame,
    appearance: plain(outer), effectiveRegion: plain(inner), exteriorAABBContainsRegion: outer.containsBox(inner),
    meshInteriorContainment: space.boundsObject.userData.interiorProfile
      ? 'unverified real interior; conservative contour is validated against sampled visual silhouettes'
      : 'unverified; historical box does not establish mesh-interior containment',
    interiorProfile: space.boundsObject.userData.interiorProfile ?? null,
    approximateVolumeL: space.boundsObject.userData.interiorProfile ? compileInteriorProfile(space.boundsObject.userData.interiorProfile).volumeM3*1000 : null,
    appearanceToFrame: new Matrix4().multiplyMatrices(frame.matrixWorld.clone().invert(), appearance.matrixWorld).toArray(),
    regionToFrame: new Matrix4().multiplyMatrices(frame.matrixWorld.clone().invert(), space.boundsObject.matrixWorld).toArray(),
    frameToWorld: frame.matrixWorld.toArray() };
}
export function createAlignmentTools(appearance, frame, space) {
  const debug = new Group(); debug.name = 'backpack-alignment-debug'; debug.visible = false;
  const outline = () => new LineSegments(new EdgesGeometry(space.boundsObject.geometry),new LineBasicMaterial({color:0x278fbd}));
  const exterior = new Box3Helper(new Box3(), 0xc3a143), region = outline();
  const axes = new AxesHelper(.18), center = new Mesh(new SphereGeometry(.005, 8, 6), new MeshBasicMaterial({ color: 0xe05a56, depthTest: false }));
  debug.add(exterior, region, axes, center); frame.add(debug);
  const demo = outline(); demo.name = 'demo-region-outline'; demo.visible = false; frame.add(demo);
  for (const node of [exterior, region, axes, demo]) {
    node.material.depthTest = false; node.material.depthWrite = false; node.renderOrder = 14;
    node.raycast = () => {}; // Helpers never intercept equipment picking.
  }
  center.renderOrder = 15; center.raycast = () => {};
  return {
    setDebugVisible(value) { debug.visible = Boolean(value); },
    setDemoVisible(value) { demo.visible = Boolean(value); },
    update() {
      if (!debug.visible && !demo.visible) return null;
      const report = alignmentReport(appearance, frame, space);
      exterior.box.setFromArray([...report.appearance.minM, ...report.appearance.maxM]);
      // Box3.setFromArray expects point triples, so min and max define the box exactly.
      for(const node of [region,demo]) { node.matrixAutoUpdate=false;node.matrix.fromArray(report.regionToFrame); }
      center.position.fromArray(report.effectiveRegion.centerM);
      return report;
    },
    dispose() {
      debug.removeFromParent(); demo.removeFromParent();
      for (const node of [exterior, region, axes, center, demo]) { node.geometry.dispose(); node.material.dispose(); }
    },
  };
}
