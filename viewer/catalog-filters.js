import {EQUIPMENT_TYPES,typeById} from './equipment-taxonomy.js';
export const brandKey=brand=>brand?.trim().toLocaleLowerCase()||'__unbranded__';
export const catalogGroups=()=>[...new Map(EQUIPMENT_TYPES.map(t=>[t.groupId,{id:t.groupId,name:t.group}])).values()];
export function brandsFor(collection,{groupId='',typeId=''}={}){
 const brands=new Map();
 for(const c of collection.candidates){
  if((typeId&&c.equipmentId!==typeId)||(groupId&&typeById(c.equipmentId)?.groupId!==groupId))continue;
  const key=brandKey(c.identity.brand),entry=brands.get(key)??{id:key,name:c.identity.brand??'品牌未注明',count:0};
  entry.count++;brands.set(key,entry);
 }
 return [...brands.values()].sort((a,b)=>a.name.localeCompare(b.name,'zh-CN'));
}
