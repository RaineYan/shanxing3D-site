import { Vector3, Matrix4, Euler } from '../vendor/three/three.module.js';
import { evaluatePlacement } from './packing-collision.js';
import { compatibleAnchors, anchorPose } from './external-placement.js';
import { localPose, applyLocalPose } from './physical-transforms.js';

const rotations=[[0,0,0],[0,0,Math.PI/2],[0,Math.PI/2,0],[Math.PI/2,0,0],[Math.PI/2,Math.PI/2,0],[Math.PI/2,0,Math.PI/2]];
const vector=v=>({x:v[0],y:v[1],z:v[2]});
// Bounded deterministic heuristic, not a complete solver or a physical load certificate.
export async function autoPack(records,space,{signal,onProgress=()=>{},stepM=.02,maxChecks=5000,instanceIds=null,candidates=null,order=null}={}){
 const all=[...records];
 if(instanceIds!==null&&(!Array.isArray(instanceIds)||instanceIds.some(id=>typeof id!=='string'||!all.some(r=>r.instanceId===id))))throw Error('所选装备实例无效');
 const selected=instanceIds===null?null:new Set(instanceIds),pending=all.filter(r=>!r.committed&&!r.userAdjusted&&(!selected||selected.has(r.instanceId)));
 if(pending.length>24)throw Error('一次最多自动摆放24件待放置装备');
 if(!Number.isFinite(stepM)||stepM<.01||!Number.isInteger(maxChecks)||maxChecks<1||maxChecks>10000)throw Error('搜索预算无效');
 for(const r of all.filter(r=>r.committed))if(!evaluatePlacement(r,all,space,undefined,r.committed).valid)throw Error('已有确认装备不合法，请先调整');
 const before=all.map(r=>({r,pose:localPose(r),committed:r.committed?structuredClone(r.committed):null,editing:r.editing}));
 const rollback=()=>{for(const b of before){applyLocalPose(b.r,b.pose,b.r.attachmentFrame);b.r.committed=b.committed;b.r.editing=b.editing;}};
 const result={placed:[],unplaced:[],checks:0,method:'bounded-grid-and-valid-mounts',completeSearch:false};
 space.geometry.computeBoundingBox();space.updateWorldMatrix(true,false);const box=space.geometry.boundingBox;
 const volume=r=>Object.values(r.asset.packedSizeM).reduce((a,b)=>a*b,1);
 pending.sort(order??((a,b)=>volume(b)-volume(a)));
 try{
  for(const r of pending){
   if(signal?.aborted)throw Error('自动装包已取消');
   let found=false,count=0,sliceStart=performance.now();
   const frame=r.attachmentFrame;frame.updateWorldMatrix(true,false);
   const attempt=p=>{applyLocalPose(r,p,frame);count++;result.checks++;return evaluatePlacement(r,all,space).valid;};
   if(candidates){
    for(const candidate of await candidates(r,space,all,{signal})){
     if(count>=maxChecks)break;
     if(count%64===0||performance.now()-sliceStart>=4){await new Promise(resolve=>setTimeout(resolve,0));sliceStart=performance.now();if(signal?.aborted)throw Error('自动装包已取消');}
     if(attempt(candidate)){found=true;break;}
    }
   }
   search:for(const angles of candidates?[]:rotations){
    const e=new Matrix4().makeRotationFromEuler(new Euler(...angles)).elements,s=Object.values(r.asset.packedSizeM),limit=box.getSize(new Vector3());
    const extent=[0,1,2].map(row=>Math.abs(e[row])*s[0]+Math.abs(e[row+4])*s[1]+Math.abs(e[row+8])*s[2]);
    if(extent.some((n,i)=>n>[limit.x,limit.y,limit.z][i]+1e-5))continue;
    for(let y=box.min.y+stepM/2;y<=box.max.y;y+=stepM)for(let x=box.min.x+stepM/2;x<=box.max.x;x+=stepM)for(let z=box.min.z+stepM/2;z<=box.max.z;z+=stepM){
     if(count>=maxChecks)break search;
     if(count%64===0||performance.now()-sliceStart>=4){await new Promise(resolve=>setTimeout(resolve,0));sliceStart=performance.now();if(signal?.aborted)throw Error('自动装包已取消');}
     const p=frame.worldToLocal(space.localToWorld(new Vector3(x,y,z)));
     if(attempt({positionM:{x:p.x,y:p.y,z:p.z},rotationRad:vector(angles),scale:{x:1,y:1,z:1},placementType:'internal',anchorId:null})){found=true;break search;}
    }
   }
   if(!found)for(const option of compatibleAnchors(r.asset,r.attachmentProfile).filter(o=>o.allowed)){
    if(attempt(anchorPose(option.anchor.id,r.asset,r.attachmentProfile))){found=true;break;}
   }
   if(found){r.committed=localPose(r);r.editing=false;result.placed.push(r.instanceId);}
   else{const original=before.find(b=>b.r===r);applyLocalPose(r,original.pose,frame);result.unplaced.push({instanceId:r.instanceId,name:r.asset.name,
    reason:'有限搜索未找到可行的内部位置或可用挂点；可能受保守演示区域、占位或挂点限制，不证明真实背包装不下。'});}
   onProgress({done:result.placed.length+result.unplaced.length,total:pending.length,checks:result.checks});
  }
  // Recheck all final confirmed poses through the same production collision gate.
  for(const r of all.filter(r=>r.committed))if(!evaluatePlacement(r,all,space,undefined,r.committed).valid)throw Error('最终布局复验失败，已恢复原场景');
  return{...result,undo:rollback};
 }catch(e){rollback();throw e;}
}
