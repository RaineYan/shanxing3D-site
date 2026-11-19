import {PLAN_KEY,validatePlan}from'./packing-plans.js';
export const HISTORY_KEY='shanxing3d.packing-history.v1';
export const HISTORY_LIMIT=30;
const validDate=s=>typeof s==='string'&&Number.isFinite(Date.parse(s));
function entry(plan,id,savedAt){
 if(!plan||typeof plan.name!=='string'||!plan.name.trim()||plan.name.length>80||!Array.isArray(plan.instances)||plan.instances.length>100||!validDate(savedAt)||typeof id!=='string'||!id||id.length>100)throw Error('历史记录格式无效，原记录已保留');
 return{id,savedAt,plan};
}
function decode(raw){
 if(raw.length>4000000)throw Error('历史记录过大，未修改原数据');
 const d=JSON.parse(raw);if(d?.schemaVersion!==1||!Array.isArray(d.entries)||d.entries.length>HISTORY_LIMIT)throw Error('历史记录版本或内容无效');
 const ids=new Set();return d.entries.map(e=>{if(ids.has(e.id))throw Error('历史记录ID重复');ids.add(e.id);return entry(e.plan,e.id,e.savedAt);});
}
export function readHistory(storage){
 const raw=storage.getItem(HISTORY_KEY);if(raw!==null)return decode(raw);
 const legacy=storage.getItem(PLAN_KEY);if(legacy===null)return[];
 if(legacy.length>200000)throw Error('原方案过大');const plan=JSON.parse(legacy);
 return[entry(plan,'legacy-plan',validDate(plan.createdAt)?plan.createdAt:new Date(0).toISOString())];
}
export function savePlanHistory(storage,plan,context,{id=globalThis.crypto.randomUUID(),savedAt=new Date().toISOString()}={}){
 validatePlan(plan,context);const previous=storage.getItem(HISTORY_KEY),entries=readHistory(storage);
 if(entries.length>=HISTORY_LIMIT)throw Error(`历史已达${HISTORY_LIMIT}条，请先删除不需要的历史记录`);
 if(entries.some(e=>e.id===id))throw Error('保存编号重复，请重试');
 const next=[entry(structuredClone(plan),id,savedAt),...entries];
 const historyRaw=JSON.stringify({schemaVersion:1,entries:next}),latestRaw=JSON.stringify(plan);
 if(historyRaw.length>4000000||latestRaw.length>200000)throw Error('保存内容过大，请先精简装备或历史记录');
 // Archive first: a history quota failure cannot overwrite the previous latest plan.
 storage.setItem(HISTORY_KEY,historyRaw);
 try{storage.setItem(PLAN_KEY,latestRaw);}
 catch(error){
  try{if(previous===null)storage.removeItem(HISTORY_KEY);else storage.setItem(HISTORY_KEY,previous);}
  catch{throw Error('最新方案未更新；历史记录可能已保存，请检查历史列表后重试');}
  throw error;
 }
 return next;
}
export function historyPlan(storage,id,context){
 const record=readHistory(storage).find(e=>e.id===id);if(!record)throw Error('历史记录已不存在，请刷新列表');
 return validatePlan(structuredClone(record.plan),context);
}
export function removeHistory(storage,id){
 const entries=readHistory(storage);if(!entries.some(e=>e.id===id))throw Error('历史记录已不存在');
 storage.setItem(HISTORY_KEY,JSON.stringify({schemaVersion:1,entries:entries.filter(e=>e.id!==id)}));
}
