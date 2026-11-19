import { evidence, validateVariant, validatePackingProfile, projectProductSpec, deepFreeze } from './physical-data.js';
import {typeById} from './equipment-taxonomy.js';

export const OFFICIAL_REVISION = 'official-pilot-2026-10-25-v1';
const pilots = new Set(['water-bottle', 'sleeping-pad', 'first-aid-kit', 'sleeping-bag', 'raincoat', 'cookware', 'headlamp', 'tent', 'tripod', 'trekking-poles']);
const supported=c=>pilots.has(c.equipmentId)||(!!typeById(c.equipmentId)&&c.runtimeMapping?.kind==='packed-box');
const visualTypes=['bottle','sleeping-pad','sleeping-bag','raincoat','headlamp','cookware','first-aid-kit','tent','tripod','trekking-poles'];
const validDate=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
export function parameterEvidence(field,collection){
 if(!field||!['verified','reference'].includes(field.dataStatus))return{usable:false,status:field?.dataStatus??'missing',reason:'暂无可核验数据'};
 const positive=value=>typeof value==='number'?Number.isFinite(value)&&value>0:
  !!value&&typeof value==='object'&&Object.keys(value).length>0&&Object.values(value).every(positive);
 if(!positive(field.value))return{usable:false,status:'invalid',reason:'参数值无效'};
 if(!Array.isArray(field.sourceIds)||!field.sourceIds.length)return{usable:false,status:'invalid',reason:'缺少参数来源'};
 const official=field.dataStatus==='verified';
 if(official&&!validDate(field.verifiedAt??collection.collectedAt))return{usable:false,status:'invalid',reason:'参数核验日期无效'};
 for(const id of field.sourceIds){const source=collection.sources?.[id];let url;try{url=new URL(source?.url);}catch{return{usable:false,status:'invalid',reason:'来源链接无效'};}
  if(url.protocol!=='https:'||url.username||url.password||!validDate(source.checkedAt)||
   (official&&!['manufacturer-product','manufacturer-manual'].includes(source.type)))return{usable:false,status:'invalid',reason:'来源尚未具备核验条件'};
 }
 return{usable:true,status:field.dataStatus,reason:null};
}
// One gate for library buttons, workbench options and actual loading. A list flag is only intent.
function officialFacts(candidate,collection){
 const fail=(code,reason)=>{const e=new Error(reason);e.code=code;throw e;};
 if(!candidate||!supported(candidate)||!collection.enabledCandidateIds?.includes(candidate.candidateId))fail('not-enabled','收纳参数或版本尚未具备接入条件');
 if(![candidate.identity?.brand,candidate.identity?.model,candidate.identity?.size].every(v=>typeof v==='string'&&v.trim()))fail('invalid-identity','品牌、型号或版本资料不完整');
 const mapping=candidate.runtimeMapping??{},dimensionKey=mapping.dimensionField??(candidate.equipmentId==='sleeping-pad'?'packedDimensionsM':'externalDimensionsM');
 if(!['packedDimensionsM','externalDimensionsM'].includes(dimensionKey))fail('invalid-dimension-field','未配置有效的收纳尺寸字段');
 const dimension=candidate.fields?.[dimensionKey],weight=candidate.fields?.weightKg;
 if(dimension?.dataStatus!=='verified'||weight?.dataStatus!=='verified')fail('unverified-fields','尺寸或重量尚未核验');
 const v=dimension.value,keys=mapping.axisKeys??(candidate.equipmentId==='water-bottle'?['diameter','height','diameter']:['a','b','c']);
 if(!Array.isArray(keys)||keys.length!==3||keys.some(k=>typeof k!=='string'||!Object.hasOwn(v??{},k)))fail('invalid-dimension-axes','缺少完整尺寸或型号尺寸轴向配置无效');
 const size=Object.fromEntries(['x','y','z'].map((axis,i)=>[axis,v[keys[i]]]));
 if(!Object.values(size).every(n=>Number.isFinite(n)&&n>0))fail('invalid-dimensions','尺寸必须是完整的米制正数');
 if(!Number.isFinite(weight.value)||weight.value<=0)fail('invalid-weight','重量必须是已核验的公斤正数，未知不能填0');
 for(const field of [dimension,weight]){
  const check=parameterEvidence(field,collection);if(!check.usable)fail('invalid-official-source',check.reason);
 }
 if(mapping.collisionShape&&(!['box','cylinder'].includes(mapping.collisionShape)||!['x','y','z'].includes(mapping.collisionAxis)))fail('invalid-proxy','碰撞代理配置无效');
 if(mapping.visualType&&!visualTypes.includes(mapping.visualType))fail('invalid-visual','视觉模型配置无效');
 if(mapping.packingState&&!['packed','folded','compressed','assembled'].includes(mapping.packingState))fail('invalid-packing-state','收纳形态配置无效');
 return{dimensionKey,dimension,w:weight,size};
}
export function productReadiness(candidate,collection){
 try{officialFacts(candidate,collection);return{available:true,code:null,reason:null};}
 catch(error){return{available:false,code:error.code??'invalid-product',reason:error.code?error.message:'型号参数格式无效'};}
}
export function officialOptions(collection, equipmentId) {
  return collection.candidates.filter(c => c.equipmentId === equipmentId).map(c => ({
    id:c.candidateId,name:`${c.identity.brand??'品牌未注明'} ${c.identity.model} · ${c.identity.size}`,
    ...productReadiness(c,collection),candidate:c,
  }));
}
// Official facts remain separate from the engineering proxy. No default dimensions.
export function officialAsset(base, candidate, collection) {
  if (!candidate || candidate.equipmentId !== base.id) throw Error('装备类别与型号不匹配');
  let facts;try{facts=officialFacts(candidate,collection);}catch(error){throw Error(`${error.code}: ${error.message}`);}
  const id=candidate.candidateId,{dimensionKey,dimension,w,size}=facts;
  const sources=[...new Set([...dimension.sourceIds,...w.sourceIds])].map(sourceId=>{
    const s=collection.sources[sourceId];if(!s)throw Error('缺少官方来源');
    return{sourceId,type:s.type==='manufacturer-manual'?'official-document':s.type==='manufacturer-product'?'official-site':'retailer-reference',url:s.url,
      checkedAt:s.checkedAt,scopeVariantId:id,section:s.location};
  });
  const field=(unit,value,status,sourceIds,raw,verifiedAt)=>evidence(id,unit,value,status,sourceIds,status==='verified'?(verifiedAt??collection.collectedAt):null,raw);
  const proxyStatus=dimensionKey==='packedDimensionsM'?'verified':'demo';
  const proxyNote=candidate.runtimeMapping?.note??(base.id==='sleeping-pad'?'官方折叠三边映射到局部XYZ；几何图示非厂家模型':
    base.id==='water-bottle'?'依据官方空瓶直径/高度构造圆柱包络，盖绳突出未核验；收纳代理为工程近似':
    '依据官方原装闭包外尺寸构造长方体包络；收纳轴向为工程近似');
  const variant={schemaVersion:2,variantId:id,equipmentTypeId:base.id,recordKind:'product',identity:{
    brand:candidate.identity.brand,model:candidate.identity.model,selectedModelYear:null,officialModelYear:candidate.identity.officialModelYear,
    editionCode:candidate.identity.editionCode??null,version:candidate.identity.version??null,size:candidate.identity.size,
    market:candidate.identity.market,capacityClassL:null,productCode:candidate.identity.productCode??null},
    specifications:{externalDimensions:dimensionKey==='externalDimensionsM'?field('m',size,'verified',dimension.sourceIds,dimension.raw,dimension.verifiedAt):field('m',null,'missing',[]),
      packedDimensions:field('m',size,proxyStatus,dimension.sourceIds,{officialField:dimensionKey,officialRaw:dimension.raw,engineeringMapping:proxyNote},dimension.verifiedAt),
      weightKg:field('kg',w.value,'verified',w.sourceIds,{officialRaw:w.raw,basis:w.basis??null},w.verifiedAt),nominalCapacityL:field('L',null,'missing',[])},sources};
  validateVariant(variant);
  const profile={...structuredClone(base.packingProfile),profileId:id+'-packing',variantId:id,dataRevision:OFFICIAL_REVISION};
  const visual={...structuredClone(base.visualAsset),assetId:id+'-visual',modelUrl:null,representsVariantId:null,
    source:'程序几何示意，非厂家模型、非Lux3D输出',geometryValidationStatus:'procedural-reference-approximation'};
  validatePackingProfile(variant,profile,visual);
  const mapping=candidate.runtimeMapping??{};
  if(mapping.collisionShape){
    if(!['box','cylinder'].includes(mapping.collisionShape)||!['x','y','z'].includes(mapping.collisionAxis))throw Error('型号碰撞形状配置无效');
    profile.collision.proxyShape=mapping.collisionShape;profile.collision.axis=mapping.collisionAxis;
    profile.volumeEstimate.shape=mapping.collisionShape;
  }
  if(mapping.packingState)profile.packingState=mapping.packingState;
  visual.declaredPackingState=profile.packingState;
  if(mapping.visualType){
    if(!['bottle','sleeping-pad','sleeping-bag','raincoat','headlamp','cookware','first-aid-kit','tent','tripod','trekking-poles'].includes(mapping.visualType))throw Error('型号视觉配置无效');
    visual.visualType=mapping.visualType;
  }
  // A new packed form does not inherit another form's reviewed demo mount eligibility.
  if(profile.packingState!==base.packingState||profile.collision.proxyShape!==base.collisionShape)profile.mounting={options:[]};
  validatePackingProfile(variant,profile,visual);
  return deepFreeze({...base,name:`${variant.identity.brand} ${variant.identity.model}（${variant.identity.size}）`,
    variantId:id,profileId:profile.profileId,visualAssetId:visual.assetId,dataRevision:OFFICIAL_REVISION,
    productVariant:variant,packingProfile:profile,visualAsset:visual,packedSizeM:size,
    modelUrl:null,modelVariantId:visual.representsVariantId,modelPackingState:profile.packingState,
    modelRotationRad:visual.rotationRad??{x:0,y:0,z:0},collisionShape:profile.collision.proxyShape,collisionAxis:profile.collision.axis,
    visualType:visual.visualType,packingState:profile.packingState,mounting:profile.mounting,
    externalAnchorIds:profile.mounting.options.length?base.externalAnchorIds:[],
    productSpec:projectProductSpec(variant),dataLevel:proxyStatus==='verified'?'verified':'estimated',
    source:proxyNote,modelSource:visual.source,weightSource:w.basis??'官方原装产品标称重量，不计水/食物',proxyNote});
}
export async function loadOfficialCollection(fetcher=fetch) {
  const response=await fetcher(new URL('../docs/OFFICIAL_PRODUCT_CANDIDATES.json',import.meta.url));
  if(!response.ok)throw Error('官方资料库暂时不可用');
  const c=await response.json();if(c?.schemaVersion!==1||!Array.isArray(c.candidates)||!c.sources||typeof c.sources!=='object'||Array.isArray(c.sources)||
    !Array.isArray(c.enabledCandidateIds)||c.enabledCandidateIds.some(id=>typeof id!=='string')||new Set(c.enabledCandidateIds).size!==c.enabledCandidateIds.length)throw Error('官方资料格式无效');
  const ids=new Set();for(const row of c.candidates){
    if(!row||typeof row.candidateId!=='string'||!row.candidateId||ids.has(row.candidateId)||!typeById(row.equipmentId)||
      !row.identity||typeof row.identity.model!=='string'||typeof row.identity.size!=='string'||!row.fields||!row.fields.weightKg||!row.fields.packedDimensionsM||!row.fields.externalDimensionsM||!Array.isArray(row.blockers))throw Error('型号身份或资料结构无效');
    ids.add(row.candidateId);
  }
  if(c.enabledCandidateIds.some(id=>!ids.has(id)))throw Error('启用名单包含未知型号');
  return c;
}
// New measured categories use the existing box loader, controls, collisions and metrics.
// No demo dimensions are invented for missing products; only explicitly enabled facts enter.
export function catalogRuntimeAssets(collection,existingAssets){
  const known=new Set(existingAssets.map(a=>a.id)),assets=[];
  for(const c of collection.candidates){
    if(known.has(c.equipmentId)||!productReadiness(c,collection).available||c.runtimeMapping?.kind!=='packed-box')continue;
    const type=typeById(c.equipmentId);if(!type)throw Error('unknown-catalog-runtime-category');
    const base={id:c.equipmentId,equipmentTypeId:c.equipmentId,name:type.name,category:type.group,
      collisionShape:'box',collisionAxis:'y',packingState:'packed',mounting:{options:[]},externalAnchorIds:[],color:0x7d9270,
      visualType:'raincoat',modelUrl:null,licenseStatus:'procedural',
      packingProfile:{packingState:'packed',dimensionsRef:'packedDimensions',referenceFrame:'equipment-local-meters',
        collision:{shape:'obb',proxyShape:'box',axis:'y',dimensionsRef:'packedDimensions'},
        volumeEstimate:{shape:'box',dimensionsRef:'packedDimensions',method:'analytic-proxy-estimate'},mounting:{options:[]}},
      visualAsset:{physicalDimensionsRef:'packedDimensions',declaredPackingState:'packed',visualType:'raincoat',color:0x7d9270,sourceUnit:'m',licenseStatus:'procedural'}};
    assets.push(deepFreeze({...officialAsset(base,c,collection),catalogOnly:true}));known.add(c.equipmentId);
  }
  return assets;
}
