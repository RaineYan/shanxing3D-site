// Manufacturer ranges are reference data, independent from demo chamber/GLB geometry.
export const BACKPACK_LOAD_REFERENCES=Object.freeze([
 Object.freeze({candidateId:'osprey-kestrel-38-s23-lxl-eu',identity:Object.freeze({brand:'Osprey',model:'Kestrel 38',editionCode:'S23',size:'L/XL',officialModelYear:null,market:'EU'}),
  minKg:9,maxKg:16,dataStatus:'verified',verifiedAt:'2026-10-28',basis:'manufacturer-unspecified',
  sourceUrl:'https://www.osprey.com/gb/media/user_manuals/OM_KestrelKyte_S23_ENG.pdf',sourceType:'manufacturer-manual',location:'PDF p4, KESTREL 38 L/XL, LOAD RANGE',raw:'20–35 lb / 9–16 kg'}),
 Object.freeze({candidateId:'deuter-futura-pro-40-3401526',identity:Object.freeze({brand:'Deuter 多特',model:'Futura Pro 40',productCode:'3401526',size:'Nightblue–Baltic / M / 3401526',officialModelYear:null,market:'国际官网'}),
  minKg:6,maxKg:10,dataStatus:'verified',verifiedAt:'2026-10-28',basis:'manufacturer-unspecified',
  sourceUrl:'https://www.deuter.com/us-en/futura-pro-40/4046051185491',sourceType:'manufacturer-product',location:'Further product information, Recommended load; product 3401526, nightblue-baltic',raw:'Recommended load 6–10 kg'}),
]);
export function validLoadReference(profile){
 if(!profile||profile.dataStatus!=='verified'||!Number.isFinite(profile.minKg)||profile.minKg<0||!Number.isFinite(profile.maxKg)||profile.maxKg<=profile.minKg)return false;
 if(!['manufacturer-product','manufacturer-manual'].includes(profile.sourceType)||profile.basis!=='manufacturer-unspecified')return false;
 try{const url=new URL(profile.sourceUrl);if(url.protocol!=='https:'||url.username||url.password)return false;}catch{return false;}
 const date=profile.verifiedAt;return typeof date==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(date)&&Number.isFinite(Date.parse(date))&&new Date(date).toISOString().slice(0,10)===date;
}
export function loadReferenceFor(candidate){
 const profile=BACKPACK_LOAD_REFERENCES.find(p=>p.candidateId===candidate?.candidateId);
 if(candidate?.equipmentId!=='backpack'||!validLoadReference(profile)||!Object.entries(profile.identity).every(([k,v])=>candidate.identity?.[k]===v))return null;
 return profile;
}
// UI preference only: never attach it to physical plan identity or overwrite other storage keys.
export const LOAD_PREFERENCE_KEY='shanxing3d.load-reference.v1';
export function readLoadPreference(getStorage,candidateIds){
 try{
  const raw=getStorage().getItem(LOAD_PREFERENCE_KEY);if(raw===null)return{candidateId:'',notice:''};
  if(raw.length>500)throw Error();const p=JSON.parse(raw);
  if(!p||p.schemaVersion!==1||typeof p.candidateId!=='string'||(p.candidateId!==''&&!candidateIds.includes(p.candidateId)))throw Error();
  return{candidateId:p.candidateId,notice:''};
 }catch{return{candidateId:'',notice:'未恢复上次负重参考，请重新选择；原装包方案不受影响。'};}
}
export function writeLoadPreference(getStorage,candidateId,candidateIds){
 if(typeof candidateId!=='string'||(candidateId!==''&&!candidateIds.includes(candidateId)))return false;
 try{getStorage().setItem(LOAD_PREFERENCE_KEY,JSON.stringify({schemaVersion:1,candidateId}));return true;}catch{return false;}
}
// Numerator is verified, confirmed gear (internal + external), never unknown=0.
// Manufacturer inclusion of pack self-weight is not explicit in checked source text.
export function weightProgress(weights,profile){
 const kg=weights.knownEquipmentKg,known=Number.isFinite(kg)&&kg>=0,unknownCount=weights.unknownCount;
 const partial=unknownCount>0;
 if(!validLoadReference(profile))return{status:'unknown-range',kg:known?kg:null,percent:null,fillPercent:0,minPercent:null,partial,message:'暂无该背包的已核验负重范围，请选择参考型号。'};
 if(!known)return{status:'unknown-weight',kg:null,percent:null,fillPercent:0,minPercent:profile.minKg/profile.maxKg*100,partial:true,message:'已放置装备重量尚未核验，暂无法计算进度。'};
 const percent=kg/profile.maxKg*100,status=kg>profile.maxKg+1e-9?'over':kg+1e-9>=profile.minKg?'in-range':'below-range';
 const message=status==='over'?'已核验装备已超过参考上限':partial?'已知重量仅为下限，尚不能判断是否处于参考范围':status==='in-range'?'已核验装备处于标称范围；完整负重仍需补齐':'已核验装备低于范围起点，无需为达到起点增加负重';
 return{status,kg,percent,fillPercent:Math.min(100,percent),minPercent:profile.minKg/profile.maxKg*100,partial,message:message+(partial?`（另有 ${unknownCount} 件重量未知）。`:'。')};
}
