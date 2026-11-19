import * as T from '../vendor/three/three.module.js';

// Visual waypoints only. Actual pack openings and swept-path clearance are unverified.
export function loadingRoute(backpack,record,from,target){
 if(target.placementType==='external')return {kind:'external',points:[from.position.clone(),target.position.clone()]};
 if(from.wasCommitted)return {kind:'adjust',points:[from.position.clone(),target.position.clone()]};
 const parent=target.parent;parent?.updateWorldMatrix(true,false);
 backpack?.updateWorldMatrix(true,true);
 const box=backpack?new T.Box3().setFromObject(backpack):new T.Box3();
 if(!box.isEmpty()&&parent)box.applyMatrix4(parent.matrixWorld.clone().invert());
 const size=record.asset.packedSizeM;
 const clearance=(size?Math.max(size.x,size.y,size.z)/2:.05)+.06;
 const ceiling=Math.max(from.position.y,target.position.y,box.isEmpty()?target.position.y:box.max.y)+clearance;
 const points=[from.position.clone(),new T.Vector3(from.position.x,ceiling,from.position.z),new T.Vector3(target.position.x,ceiling,target.position.z),target.position.clone()];
 return {kind:'load',points,tangents:[new T.Vector3(),points[2].clone().sub(points[0]).multiplyScalar(.65/.6),points[3].clone().sub(points[1]).multiplyScalar(.65/.75),new T.Vector3()]};
}
const routeStarts=[0,.25,.6],routeSpans=[.25,.35,.4];
const ease=n=>n*n*n*(n*(n*6-15)+10);
export function sampleLoadingRoute(route,t,out=new T.Vector3()){
 t=Math.max(0,Math.min(1,t));
 if(t===0)return out.copy(route.points[0]);
 if(t===1)return out.copy(route.points.at(-1));
 if(route.kind!=='load'){
  const k=ease(t);out.copy(route.points[0]).lerp(route.points[1],k);out.y+=(route.kind==='external'?.04:.015)*Math.sin(Math.PI*k);return out;
 }
 const segment=t<.25?0:t<.6?1:2,h=routeSpans[segment],u=(t-routeStarts[segment])/h,u2=u*u,u3=u2*u,u4=u3*u,u5=u4*u;
 // Quintic Hermite: shared velocity and zero acceleration at joins (C2).
 const a=1-10*u3+15*u4-6*u5,b=10*u3-15*u4+6*u5,c=(u-6*u3+8*u4-3*u5)*h,d=(-4*u3+7*u4-3*u5)*h;
 return out.copy(route.points[segment]).multiplyScalar(a).addScaledVector(route.points[segment+1],b).addScaledVector(route.tangents[segment],c).addScaledVector(route.tangents[segment+1],d);
}

// Pure presentation after a validated layout. Driven by the existing render loop.
// Instance roots, committed poses, collisions, undo and statistics are never animated.
export function createAutoPlayback({backpack,now=()=>performance.now(),onState=()=>{},onPlaced=()=>{},reduced=false,durationMs=950,fadeBackpack=true}={}){
 if(!Number.isFinite(durationMs)||durationMs<=0)throw Error('invalid-playback-duration');
 let previews=[],cache=[],state='idle',elapsed=0,last=0,lastEmit=-Infinity,lastPhase='',shell=null,prepared=false;
 const shellPool=new Map();
 function clone(record,from){const root=new T.Group(),visual=record.visual.clone(true),materials=new Map();
  const preview={record,root,materials,from,visible:record.visual.visible,disposed:false};
  // Share immutable geometry/GPU buffers; only materials are owned by the preview.
  try{root.name='packing-auto-preview';visual.traverse(n=>{n.userData={};if(n.material){const copy=m=>{if(!materials.has(m))materials.set(m,m.clone());return materials.get(m);};n.material=Array.isArray(n.material)?n.material.map(copy):copy(n.material);}});
  root.add(visual);record.group.parent.add(root);root.position.copy(from.position);root.quaternion.copy(from.quaternion);root.scale.copy(from.scale);
  record.visual.visible=false;return preview;}catch(e){release(preview);throw e;}
 }
 function pose(record){record.group.updateMatrix();return{position:record.group.position.clone(),quaternion:record.group.quaternion.clone(),scale:record.group.scale.clone(),parent:record.group.parent,placementType:record.placementType??'internal',wasCommitted:!!record.committed};}
 function release(p){if(p.disposed)return;p.disposed=true;p.record.visual.visible=p.visible;p.root.removeFromParent();p.materials.forEach(m=>m.dispose());}
 function restoreShell(){if(!shell)return;for(const [mesh,material]of shell.originals)mesh.material=material;shell=null;}
 function transparentShell(){if(!fadeBackpack||!backpack||shell)return;shell={originals:new Map()};backpack.traverse(n=>{if(!n.isMesh)return;shell.originals.set(n,n.material);const copy=m=>{if(!shellPool.has(m)){const c=m.clone();c.opacity=Math.min(m.opacity,.18);c.transparent=true;c.depthWrite=false;shellPool.set(m,c);}return shellPool.get(m);};n.material=Array.isArray(n.material)?n.material.map(copy):copy(n.material);});}
 function clear(){previews.forEach(release);previews=[];restoreShell();}
 function validCache(){return cache.length>0&&cache.every(c=>{const r=c.record;if(!r.group.parent||!r.committed||r.group.parent!==c.target.parent)return false;
  return r.group.position.equals(c.target.position)&&1-Math.abs(r.group.quaternion.dot(c.target.quaternion))<1e-10&&r.group.scale.equals(c.target.scale);});}
 function snapshot(){const total=cache.length,done=Math.min(total,Math.floor(elapsed/durationMs)),current=cache[Math.min(done,total-1)],fraction=elapsed/durationMs-done;
  const kind=current?.route.kind,phase=kind==='load'?(fraction<.25?'抬起装备':fraction<.6?'移至包口上方':'放入背包'):kind==='external'?'移向固定挂点':kind==='adjust'?'调整系统布局':'';
  return{state,total,done:state==='completed'?total:done,
  progress:total?Math.min(1,elapsed/(total*durationMs)):0,currentName:current?.record.asset.name??'',phase,motionKind:kind??null,canReplay:validCache(),reduced};}
 function emit(){lastEmit=now();const s=snapshot();lastPhase=s.phase;onState(s);}
 function invalidate(){clear();shellPool.forEach(m=>m.dispose());shellPool.clear();cache=[];prepared=false;state='idle';elapsed=0;emit();}
 function finish(){clear();elapsed=cache.length*durationMs;state=cache.length?'completed':'idle';emit();}
 function stage(records){invalidate();state='calculating';try{for(const record of records)previews.push(clone(record,pose(record)));}catch(e){invalidate();throw e;}emit();}
 function prepare(ids){cache=[...new Set(ids)].map(id=>previews.find(p=>p.record.instanceId===id)).filter(Boolean).map(p=>({record:p.record,from:p.from,target:pose(p.record)}))
  .filter(c=>!c.from.wasCommitted||!c.from.position.equals(c.target.position)||1-Math.abs(c.from.quaternion.dot(c.target.quaternion))>=1e-10||!c.from.scale.equals(c.target.scale))
  .map(c=>({...c,route:loadingRoute(backpack,c.record,c.from,c.target)}));
  for(const p of previews)if(!cache.some(c=>c.record===p.record))release(p);previews=cache.map(c=>previews.find(p=>p.record===c.record));
  prepared=true;if(cache.length&&!reduced)transparentShell();emit();return cache.length>0&&!reduced;
 }
 function play(ids){if(prepared&&cache.length&&!validCache()){invalidate();return false;}if(!prepared)prepare(ids);prepared=false;
  elapsed=0;last=now();if(!cache.length||reduced){finish();return;}state='playing';transparentShell();emit();
 }
 function replay(){if(!validCache()){invalidate();return false;}clear();try{for(const c of cache)previews.push(clone(c.record,c.from));}catch(e){invalidate();throw e;}
  elapsed=0;last=now();if(reduced)finish();else{state='playing';transparentShell();emit();}return true;
 }
 function tick(t=now()){if(state!=='playing')return false;const delta=Math.max(0,t-last);elapsed+=delta>250?50:delta;last=t;
  for(let i=0;i<previews.length;i++){const p=previews[i];if(p.disposed)continue;const progress=Math.max(0,Math.min(1,elapsed/durationMs-i));if(progress>=1){release(p);onPlaced(p.record);continue;}if(progress===0)continue;
   const target=cache[i].target,k=ease(progress);sampleLoadingRoute(cache[i].route,progress,p.root.position);
   p.root.userData.loadingKind=cache[i].route.kind;
   p.root.quaternion.copy(p.from.quaternion).slerp(target.quaternion,k);p.root.scale.copy(target.scale);
  }
  if(elapsed>=cache.length*durationMs)finish();else{
   const done=Math.floor(elapsed/durationMs),fraction=elapsed/durationMs-done,kind=cache[done]?.route.kind;
   const phase=kind==='load'?(fraction<.25?'抬起装备':fraction<.6?'移至包口上方':'放入背包'):kind==='external'?'移向固定挂点':kind==='adjust'?'调整系统布局':'';
   if(t-lastEmit>=50||phase!==lastPhase)emit();
  }return true;
 }
 return{stage,prepare,play,replay,tick,invalidate,
  pause(){if(state!=='playing')return;tick();if(state==='playing'){state='paused';emit();}},
  resume(){if(state!=='paused')return;state='playing';last=now();emit();},
  skip(){if(state==='playing'||state==='paused')finish();},
  setReduced(value){reduced=!!value;if(reduced&&(state==='playing'||state==='paused'))finish();else emit();},
  dispose:invalidate,get status(){return snapshot();}};
}
