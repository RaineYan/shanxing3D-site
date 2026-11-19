// Schematic attachment relationships only: not straps, support geometry or physics.
import { BufferGeometry, Float32BufferAttribute, LineDashedMaterial, LineSegments, Vector3 } from '../vendor/three/three.module.js';
export function createMountGuide(record,profile){
 const frame=record.attachmentFrame,geometry=new BufferGeometry();geometry.setAttribute('position',new Float32BufferAttribute(new Float32Array(12),3));
 geometry.setAttribute('lineDistance',new Float32BufferAttribute(new Float32Array(4),1));
 const material=new LineDashedMaterial({color:0x9c8654,dashSize:.012,gapSize:.008,depthTest:false});
 const line=new LineSegments(geometry,material);line.name='attachment-guide-'+record.instanceId;line.visible=false;line.renderOrder=11;frame.add(line);let disposed=false;
 return{line,update(){
  const a=profile.attachments.find(a=>a.id===record.anchorId);line.visible=record.placementType==='external'&&a?.supportPointsM?.length===2;
  if(!line.visible)return;frame.updateWorldMatrix(true,false);record.group.updateWorldMatrix(true,false);
  const axis=record.asset.collisionAxis,size=record.asset.packedSizeM[axis],positions=geometry.attributes.position;
  const distances=geometry.attributes.lineDistance;
  a.supportPointsM.forEach((p,i)=>{const end=new Vector3();end[axis]=(i?1:-1)*size*.28;frame.worldToLocal(record.group.localToWorld(end));positions.setXYZ(i*2,...p);positions.setXYZ(i*2+1,end.x,end.y,end.z);distances.setX(i*2,0);distances.setX(i*2+1,end.distanceTo(new Vector3(...p)));});
  positions.needsUpdate=true;distances.needsUpdate=true;geometry.computeBoundingSphere();
 },dispose(){if(disposed)return;disposed=true;line.removeFromParent();geometry.dispose();material.dispose();}};
}
