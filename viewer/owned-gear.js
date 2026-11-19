// Ownership is a local catalog preference, never a trip readiness or packed instance.
export const OWNED_GEAR_KEY='shanxing3d.owned-gear.v1';
export function readOwnedGear(getStorage,validIds){
 try{
  const raw=getStorage().getItem(OWNED_GEAR_KEY);if(raw===null)return{ids:[],notice:''};
  if(raw.length>100000)throw Error();const data=JSON.parse(raw);
  if(data?.schemaVersion!==1||!Array.isArray(data.ids)||data.ids.length>2000||data.ids.some(id=>typeof id!=='string'))throw Error();
  const ids=[...new Set(data.ids)].filter(id=>validIds.includes(id));
  return{ids,notice:ids.length!==data.ids.length?'部分旧型号已不在当前资料库中，未显示；原存档未被改写。':''};
 }catch{return{ids:[],notice:'未能恢复我的装备，本次仍可标记；原装包方案与清单不受影响。'};}
}
export function saveOwnedGear(getStorage,ids,validIds){
 if(!Array.isArray(ids)||ids.some(id=>!validIds.includes(id)))return false;
 try{getStorage().setItem(OWNED_GEAR_KEY,JSON.stringify({schemaVersion:1,ids:[...new Set(ids)]}));return true;}catch{return false;}
}
