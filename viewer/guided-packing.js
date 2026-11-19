// General hiking preferences from REI/deuter; geometry and back direction remain demo references.
import {Vector3,Euler,Matrix4} from '../vendor/three/three.module.js';
import {autoPack} from './auto-packing.js';
import {localPose,applyLocalPose} from './physical-transforms.js';
import {worldProxyAABB,evaluatePlacement} from './packing-collision.js';
import {officialWeightKg} from './product-specs.js';

export const PACKING_GUIDANCE_SOURCES=Object.freeze([
 'https://www.rei.com/learn/expert-advice/loading-backpack.html',
 'https://www.deuter.com/us-en/advice/how-to-pack-a-backpack',
]);
export function packingZone(asset){
 if(['sleeping-bag','sleeping-pad'].includes(asset.visualType))return 'bottom';
 if(['raincoat','first-aid-kit','headlamp'].includes(asset.visualType))return 'access';
 if(asset.visualType==='cookware'||(officialWeightKg(asset.productSpec)??0)>=1)return 'core';
 return 'balanced';
}
const volume=r=>r.asset.packedSizeM.x*r.asset.packedSizeM.y*r.asset.packedSizeM.z;
const angles=[[0,0,0],[0,0,Math.PI/2],[0,Math.PI/2,0],[Math.PI/2,0,0],[Math.PI/2,Math.PI/2,0],[Math.PI/2,0,Math.PI/2]];
function* buildPackingCandidates(record,space,all){
 space.geometry.computeBoundingBox();space.updateWorldMatrix(true,false);
 const box=space.geometry.boundingBox,zone=packingZone(record.asset),size=record.asset.packedSizeM;
 const occupied=all.filter(r=>r!==record&&r.committed&&r.committed.placementType!=='external').map(r=>{
  const b=worldProxyAABB(r,r.committed).clone();return b.applyMatrix4(space.matrixWorld.clone().invert());
 });
 record.attachmentFrame.updateWorldMatrix(true,false);
 const toFrame=record.attachmentFrame.matrixWorld.clone().invert().multiply(space.matrixWorld),scratch=new Vector3(),span=box.getSize(new Vector3());
 const result=[];let operations=0;
 for(const a of record.asset.visualType==='bottle'?angles.slice(0,1):angles){
  const e=new Matrix4().makeRotationFromEuler(new Euler(...a)).elements,d=[size.x,size.y,size.z];
  const ext=[0,1,2].map(i=>Math.abs(e[i])*d[0]+Math.abs(e[i+4])*d[1]+Math.abs(e[i+8])*d[2]);
  const mins=['x','y','z'].map((k,i)=>box.min[k]+ext[i]/2),maxs=['x','y','z'].map((k,i)=>box.max[k]-ext[i]/2);
  if(mins.some((v,i)=>v>maxs[i]+1e-6))continue;
  const targetY=zone==='bottom'?mins[1]:zone==='access'?maxs[1]:(box.min.y+box.max.y)/2;
  const values=['x','y','z'].map((axis,i)=>{
   const set=new Set([mins[i],maxs[i],Math.max(mins[i],Math.min(maxs[i],i===1?targetY:0))]);
   for(const b of occupied)for(const v of [b.min[axis]-ext[i]/2,b.max[axis]+ext[i]/2])if(v>=mins[i]-1e-6&&v<=maxs[i]+1e-6)set.add(v);
   for(let p=mins[i];p<=maxs[i];p+=.03)set.add(p);
   return [...set].slice(0,16).sort((p,q)=>p-q);
  });
  for(const x of values[0])for(const y of values[1])for(const z of values[2]){
   const ny=(y-box.min.y)/span.y,nz=(z-box.min.z)/span.z;
   const preference=zone==='bottom'?ny:zone==='access'?1-ny:zone==='core'?Math.abs(ny-.55)+nz*.5:Math.abs(ny-.5)*.3;
   // Boundary/face alignment reduces wasted gaps; preference is a soft constraint.
   const gap=Math.min(x-mins[0],maxs[0]-x)+Math.min(z-mins[2],maxs[2]-z);
   const p=scratch.set(x,y,z).applyMatrix4(toFrame);
   result.push({positionM:{x:p.x,y:p.y,z:p.z},rotationRad:{x:a[0],y:a[1],z:a[2]},scale:{x:1,y:1,z:1},placementType:'internal',anchorId:null,
    score:preference+gap*.4+Math.abs(x)*.15});
   if(++operations%128===0)yield;
  }
 }
 return result.sort((a,b)=>a.score-b.score);
}
export function packingCandidates(record,space,all){const steps=buildPackingCandidates(record,space,all);let step;do{step=steps.next();}while(!step.done);return step.value;}
export async function packingCandidatesAsync(record,space,all,{signal}={}){
 const steps=buildPackingCandidates(record,space,all);let deadline=performance.now()+4;
 while(true){if(signal?.aborted)throw Error('自动装包已取消');const step=steps.next();if(step.done)return step.value;
  if(performance.now()>=deadline){await new Promise(resolve=>setTimeout(resolve,0));deadline=performance.now()+4;}
 }
}

export async function guidedAutoPack(records,space,{instanceIds=null,signal,onProgress=()=>{}}={}){
 const all=[...records],selected=instanceIds===null?null:new Set(instanceIds);
 if(instanceIds!==null&&(!Array.isArray(instanceIds)||instanceIds.some(id=>!all.some(r=>r.instanceId===id))))throw Error('所选装备实例无效');
 const movable=all.filter(r=>(!selected||selected.has(r.instanceId))&&!r.userAdjusted&&(!r.committed||r.placementOwner==='auto'));
 const before=all.map(r=>({r,pose:localPose(r),committed:structuredClone(r.committed),editing:r.editing,owner:r.placementOwner}));
 const restore=rows=>{for(const b of rows){applyLocalPose(b.r,b.pose,b.r.attachmentFrame);b.r.committed=structuredClone(b.committed);b.r.editing=b.editing;b.r.placementOwner=b.owner;}};
 const baselineValid=all.filter(r=>r.committed).every(r=>evaluatePlacement(r,all,space,undefined,r.committed).valid);
 let best=baselineValid?{total:movable.filter(r=>r.committed).reduce((s,r)=>s+volume(r),0),
  internal:movable.filter(r=>r.committed&&r.placementType!=='external').reduce((s,r)=>s+volume(r),0),rows:before,
  result:{placed:movable.filter(r=>r.committed).map(r=>r.instanceId),unplaced:movable.filter(r=>!r.committed).map(r=>({instanceId:r.instanceId,name:r.asset.name,reason:'有限搜索尚未找到可用位置，保留原姿态。'})),checks:0}}:null;
 const orders=[(a,b)=>volume(b)-volume(a),(a,b)=>volume(a)-volume(b),(a,b)=>packingZone(a.asset).localeCompare(packingZone(b.asset))||volume(b)-volume(a)];
 try{
  for(let pass=0;pass<orders.length;pass++){
   if(signal?.aborted)throw Error('自动装包已取消');restore(before);
   for(const r of movable)r.committed=null;
   const candidate=await autoPack(all,space,{instanceIds:movable.map(r=>r.instanceId),signal,candidates:packingCandidatesAsync,order:orders[pass],maxChecks:5000,
    onProgress:p=>onProgress({...p,pass:pass+1,passes:orders.length})});
   const internal=movable.filter(r=>r.committed&&r.placementType!=='external').reduce((s,r)=>s+volume(r),0);
   const total=movable.filter(r=>r.committed).reduce((s,r)=>s+volume(r),0);
   // Prefer more selected equipment by proxy volume, then keep more of it internal.
   if(!best||total>best.total+1e-10||Math.abs(total-best.total)<1e-10&&internal>best.internal+1e-10){
    best={total,internal,result:candidate,rows:all.map(r=>({r,pose:localPose(r),committed:structuredClone(r.committed),editing:r.editing,owner:r.placementOwner}))};
   }
  }
  restore(best.rows);for(const r of movable)if(r.committed)r.placementOwner='auto';
  return {...best.result,undo:()=>restore(before),lockedCount:all.length-movable.length,method:'three-order-guided-gap-search',completeSearch:false};
 }catch(e){restore(before);throw e;}
}
