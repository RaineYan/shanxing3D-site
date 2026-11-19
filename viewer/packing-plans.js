export const PLAN_KEY='shanxing3d.packing-plan.v1';
export const assetFingerprint=a=>JSON.stringify([a.variantId,a.packedSizeM,a.collisionShape,a.collisionAxis,a.productSpec?.weightKg??null,a.productSpec?.dataStatus??'missing']);
export function validatePlan(plan,context){
 if(!plan||plan.schemaVersion!==1||plan.unit!=='m'||plan.rotationUnit!=='rad'||plan.frameId!=='backpack-local-meters'||
   plan.backpackVariantId!==context.backpackVariantId||plan.interiorModelId!==context.interiorModelId)throw Error('方案版本或背包空间不匹配');
 if(typeof plan.name!=='string'||!plan.name.trim()||plan.name.length>80||!Array.isArray(plan.instances)||plan.instances.length>100)throw Error('方案内容无效');
 const ids=new Set();for(const r of plan.instances){
  if(!/^gear-[1-9]\d{0,6}$/.test(r.instanceId)||ids.has(r.instanceId)||!context.equipmentIds.includes(r.equipmentId)||typeof r.variantId!=='string'||!r.variantId||typeof r.dataRevision!=='string'||typeof r.parameterFingerprint!=='string'||r.parameterFingerprint.length>2000)throw Error('装备身份或实例ID无效');
  ids.add(r.instanceId);const p=r.committed;
  if(r.userAdjusted!==undefined||r.placementOwner!==undefined){
   if(typeof r.userAdjusted!=='boolean'||!['manual','auto'].includes(r.placementOwner)||r.userAdjusted&&r.placementOwner!=='manual')throw Error('方案手动保护或摆放来源无效');
  }
  if(!p||p.frameId!=='backpack-local-meters'||!['internal','external'].includes(p.placementType)||
    !['positionM','rotationRad'].every(k=>p[k]&&['x','y','z'].every(a=>Number.isFinite(p[k][a])&&Math.abs(p[k][a])<=100))||
    !p.scale||!['x','y','z'].every(a=>p.scale[a]===1)||
    (p.placementType==='external'?!context.anchorIds.includes(p.anchorId):p.anchorId!==null))throw Error('方案姿态或外挂位置无效');
 }
 return plan;
}
export function makePlan(name,records,context){
 const instances=records.filter(r=>r.committedTransform).map(r=>({instanceId:r.instanceId,equipmentId:r.equipmentId,variantId:r.variantId,
   dataRevision:r.dataRevision,parameterFingerprint:r.parameterFingerprint,
   userAdjusted:r.userAdjusted===undefined?true:r.userAdjusted,placementOwner:r.placementOwner??'manual',
   committed:structuredClone(r.committedTransform)}));
 return validatePlan({schemaVersion:1,name:name.trim(),createdAt:new Date().toISOString(),unit:'m',rotationUnit:'rad',
  frameId:'backpack-local-meters',backpackVariantId:context.backpackVariantId,interiorModelId:context.interiorModelId,instances},context);
}
export function writePlan(storage,plan,context){validatePlan(plan,context);storage.setItem(PLAN_KEY,JSON.stringify(plan));}
export function readPlan(storage,context){const raw=storage.getItem(PLAN_KEY);if(raw===null)throw Error('还没有保存方案');if(raw.length>200000)throw Error('方案文件过大');return validatePlan(JSON.parse(raw),context);}
