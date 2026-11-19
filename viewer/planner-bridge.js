import{DURATIONS,planLabel}from'../gear-data.js';
import{selectedTripItems,AUTO_TRIP_TYPES}from'./trip-items.js';
function snapshot(raw){
 const s=typeof raw==='string'?JSON.parse(raw):raw;
 if(!s||s.version!==1||s.generated!==true||!DURATIONS[s.plan?.type]?.includes(s.plan?.hours)||!Array.isArray(s.prepared))throw Error('请先生成徒步清单，再开始装包');
 return s;
}
// Plan recommendations and actual preparation are intentionally separate.
export function plannedKit(raw,instances=[]){
 const s=snapshot(raw),items=selectedTripItems(s.plan,s.choices),existing=new Set(instances.map(r=>r.equipmentId));
 const automatic=r=>AUTO_TRIP_TYPES.includes(r.packingType);
 const equipmentIds=[...new Set(items.filter(automatic).map(r=>r.packingType))];
 return {label:planLabel(s.plan),equipmentIds,freshIds:equipmentIds.filter(id=>!existing.has(id)),
   existingIds:equipmentIds.filter(id=>existing.has(id)),
   checklistOnly:items.filter(r=>!automatic(r)).map(r=>({id:r.id,name:r.name})),
   preparedCount:items.filter(r=>s.prepared.includes(r.id)).length,totalCount:items.length};
}
export function preparedModels(raw){
 const s=snapshot(raw);
 const items=new Map(selectedTripItems(s.plan,s.choices).map(r=>[r.id,r]));
 return [...new Set(s.prepared.map(id=>items.get(id)?.packingType).filter(type=>AUTO_TRIP_TYPES.includes(type)))];
}
