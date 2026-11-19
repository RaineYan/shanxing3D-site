import * as T from '../vendor/three/three.module.js';

// Cosmetic only: never modifies an instance root, physical dimensions or snapshots.
// Driven exclusively by the existing workbench update, with no timers/render loop.
export function createPackingEffects(scene,{reduced=false,now=()=>performance.now()}={}){
 const entries=new Map(),ghosts=new Set();let selection=null,outline=null,disposed=false;
 function attach(record){if(entries.has(record))return entries.get(record);const originals=new Map(),clones=new Map();
  record.visual.traverse(n=>{if(!n.isMesh)return;originals.set(n,n.material);const clone=m=>{if(!clones.has(m))clones.set(m,m.clone());return clones.get(m);};n.material=Array.isArray(n.material)?n.material.map(clone):clone(n.material);});
  const entry={record,originals,clones,base:new Map([...clones.values()].map(m=>[m,{opacity:m.opacity,transparent:m.transparent,depthWrite:m.depthWrite,emissive:m.emissive?.clone()}])),fade:null,pulse:null};entries.set(record,entry);return entry;
 }
 function shade(entry,t=now()) {const fade=entry.fade!==null?Math.min(1,Math.max(0,(t-entry.fade)/180)):1;
  const pulse=entry.pulse!==null?Math.max(0,1-(t-entry.pulse)/350):0;
  for(const [m,base]of entry.base){m.opacity=base.opacity*fade;m.transparent=base.transparent||fade<1;m.depthWrite=fade<1?false:base.depthWrite;
   if(m.emissive&&base.emissive)m.emissive.copy(base.emissive).lerp(new T.Color(selection?.record===entry.record?selection.color:0x3e9e68),pulse*.35+(selection?.record===entry.record ? .12 : 0));}
  if(fade>=1)entry.fade=null;if(pulse<=0)entry.pulse=null;
 }
 function dropOutline(){if(!outline)return;outline.root.removeFromParent();outline.geometries.forEach(g=>g.dispose());outline.material.dispose();outline=null;}
 function select(record,valid=true){const color=valid?0x54896b:0xb84d42;
  if(selection?.record===record){if(selection.color!==color){selection.color=color;outline?.material.color.set(color);if(record)shade(attach(record));}return;}
  const previous=selection?.record;dropOutline();selection=record?{record,color}:null;if(previous&&entries.has(previous))shade(entries.get(previous));if(!record)return;
  shade(attach(record));const root=new T.Group(),geometries=new Map(),lines=[];
  root.name='packing-selection-outline';const material=new T.LineBasicMaterial({color,transparent:true,opacity:.65,depthWrite:false});
  record.visual.traverse(mesh=>{if(!mesh.isMesh)return;const triangles=(mesh.geometry.index?.count??mesh.geometry.attributes.position.count)/3;if(triangles>2000)return;
   if(!geometries.has(mesh.geometry))geometries.set(mesh.geometry,new T.EdgesGeometry(mesh.geometry,35));
   const line=new T.LineSegments(geometries.get(mesh.geometry),material);line.matrixAutoUpdate=false;root.add(line);lines.push({mesh,line});});
  scene.add(root);outline={root,geometries,material,lines};updateOutline();
 }
 function updateOutline(){if(!outline)return false;scene.updateWorldMatrix(true,false);const inverse=scene.matrixWorld.clone().invert();let changed=false;
  for(const {mesh,line}of outline.lines){mesh.updateWorldMatrix(true,false);const matrix=inverse.clone().multiply(mesh.matrixWorld);if(!matrix.equals(line.matrix)){line.matrix.copy(matrix);line.matrixWorldNeedsUpdate=true;changed=true;}line.visible=mesh.visible&&selection.record.visual.visible;}return changed;
 }
 function endGhost(ghost){ghost.root.removeFromParent();ghost.geometries.forEach(g=>g.dispose());ghost.materials.forEach(m=>m.dispose());if(ghost.restore)ghost.record.visual.visible=ghost.visible;ghosts.delete(ghost);}
 function settle(record){for(const ghost of [...ghosts])if(!record||ghost.record===record)endGhost(ghost);
  for(const entry of entries.values())if(!record||entry.record===record){entry.fade=null;entry.pulse=null;shade(entry);}}
 function ghost(record,from,restore){if(reduced||disposed)return;settle(record);const root=new T.Group(),copy=record.visual.clone(true),geometries=new Map(),materials=new Map();
  copy.name='feedback-visual';copy.traverse(n=>{n.userData={};if(n.geometry){if(!geometries.has(n.geometry))geometries.set(n.geometry,n.geometry.clone());n.geometry=geometries.get(n.geometry);}if(n.material){const clone=m=>{if(!materials.has(m))materials.set(m,m.clone());return materials.get(m);};n.material=Array.isArray(n.material)?n.material.map(clone):clone(n.material);}});root.add(copy);root.name='packing-feedback';scene.add(root);
  const frame=record.group.parent??scene;frame.updateWorldMatrix(true,false);
  const state={record,root,geometries,materials,frame,fromLocal:frame.matrixWorld.clone().invert().multiply(from),restore,visible:record.visual.visible,start:now(),base:new Map([...materials.values()].map(m=>[m,m.opacity]))};ghosts.add(state);if(restore)record.visual.visible=false;tick(now());
 }
 function capture(record){record.group.updateWorldMatrix(true,false);return record.group.matrixWorld.clone();}
 function tick(t=now()){if(disposed)return false;let dirty=false;for(const e of entries.values())if(e.fade!==null||e.pulse!==null){shade(e,t);dirty=true;}
  scene.updateWorldMatrix(true,false);const inverse=scene.matrixWorld.clone().invert();
  for(const g of [...ghosts]){const p=Math.min(1,Math.max(0,(t-g.start)/(g.restore?240:160)));if(p>=1){endGhost(g);dirty=true;continue;}
   g.frame.updateWorldMatrix(true,false);
   const start=inverse.clone().multiply(g.frame.matrixWorld).multiply(g.fromLocal),end=g.restore?inverse.clone().multiply(capture(g.record)):start;
   const a=new T.Vector3(),b=new T.Quaternion(),c=new T.Vector3(),x=new T.Vector3(),y=new T.Quaternion(),z=new T.Vector3();start.decompose(a,b,c);end.decompose(x,y,z);const ease=p*p*(3-2*p);
   g.root.position.copy(a).lerp(x,ease);g.root.quaternion.copy(b).slerp(y,ease);g.root.scale.copy(c).lerp(z,ease);
   for(const [m,opacity]of g.base){m.opacity=opacity*(g.restore?1:1-p);m.transparent=true;m.depthWrite=false;}dirty=true;
  }
  return updateOutline()||dirty;
 }
 function forget(record){settle(record);if(selection?.record===record)select(null);const e=entries.get(record);if(!e)return;for(const [node,material]of e.originals)node.material=material;e.clones.forEach(m=>m.dispose());entries.delete(record);}
 return{attach,select,settle,capture,tick,
  appear(record){const e=attach(record);if(!reduced){e.fade=now();shade(e);}},
  confirm(record){const e=attach(record);if(!reduced)e.pulse=now();},
  returnTo(record,from){ghost(record,from,true);},
  remove(record){ghost(record,capture(record),false);},
  forget(record){ // Removal ghosts own their resources and survive instance disposal.
   for(const g of ghosts)if(g.record===record&&!g.restore)g.record=null;
   forget(record);
  },
  setReduced(value){reduced=!!value;if(reduced)settle();},
  dispose(){if(disposed)return;settle();select(null);for(const r of [...entries.keys()])forget(r);disposed=true;},
  get activeCount(){return ghosts.size+[...entries.values()].filter(e=>e.fade!==null||e.pulse!==null).length;}
 };
}
