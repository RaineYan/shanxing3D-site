import {parameterEvidence}from'./official-products.js';
const labels={packedDimensionsM:'收纳尺寸（米）',externalDimensionsM:'外部/展开尺寸（米）',internalDimensionsM:'内部尺寸（米，不用于外包络）',foldedLengthM:'折叠长度（米，仅一维）',externalLengthM:'物体长度（米，非完整收纳包络）',packedSizeTwoAxesM:'收纳两项尺寸（米，未确定完整包络）',compressedVolumeL:'压缩体积（升，不反推尺寸）',nominalCapacityL:'标称容量（升，不等于模拟内仓）',bodyDimensionsM:'本体尺寸（米，未含全部附件）',sizeTwoAxesM:'平面两边（米，不是完整收纳包络）',bodySizeTwoAxesM:'机身两项尺寸（米，未含附件）',indexedTotalSizeIn:'索引尺寸（英寸，未作为米制几何）',bladeLengthM:'刀刃长度（米，不是折叠长度）',openDiameterM:'展开直径（米，不用于收纳）',cordDiameterM:'绳径（米，不是卷收尺寸）',weightPerMeterKg:'每米参考重量（千克/米，不是实例总重）',netContentWeightKg:'净含量（千克，不含包装，不计入装备重量）',listedPairWeightKg:'双只本体重量（千克，未含收纳附件）',listedProductWeightKg:'另列本体重量（千克，非完整收纳计重）',accessoryWeightKg:'另列附件重量（千克，未自动加入）',cableLengthM:'线材展开长度（米，不是卷收包络）'};
Object.assign(labels,{perShoeWeightKg:'单只鞋重量（千克，不能直接当双鞋重量）',usableInterior:'真实有效内仓几何（独立于标称容量）',mountCoordinatesM:'真实挂点坐标（米，未核验时不使用）'});
export function catalogParameterText(key,field,collection){
 const evidence=parameterEvidence(field,collection),label=labels[key]??key;
 const value=evidence.usable?(typeof field.value==='number'?String(field.value):Object.entries(field.value).map(([axis,n])=>`${({diameter:'直径 ',height:'高度 ',length:'长度 ',width:'宽度 ',depth:'厚度 '}[axis]??'')}${n}`).join(' × ')):'暂无有效核验数据';
 const sourceNote=evidence.status==='reference'?'（商家/索引参考，未核验）':'';
 const date=evidence.usable&&field.verifiedAt?`；核验 ${field.verifiedAt}`:'';
 const basis=field?.basis?`；口径：${field.basis}`:'';
 return `${label}：${value}${sourceNote}${date}${basis}`;
}
const restrictionLabels={
 'resolve weight discrepancy':'不同官方资料的重量存在冲突，尚未确定计重值',
 'no measured inner chamber, mount coordinates or per-mount load limits':'缺少实测内仓、真实挂点位置及各挂点承载资料',
 'anonymous project GLB is not verified as this product':'当前匿名背包外观未被核验为这个具体型号',
 'define separate derived runtime proxy without claiming it is an official packed envelope':'收纳代理是独立工程近似，不能宣称厂家核验了该包络',
 'confirm exact orderable SKU and accessory weight basis':'需要核对可购买的具体产品编号及附件计重范围',
 'need actual compressed dimensions; cannot reuse old Spark SpII or another temperature/size':'缺少压缩收纳三边，不能套用旧Spark SpII、其他温标或尺码',
 'runtime orientation/proxy mapping must be explicit; model year not published':'代理轴向使用明确映射，厂家未公布型号年份',
 'packed dimensions not found in checked page':'已查页面未提供完整收纳尺寸',
 'do not copy L/XL 380 g or use 60 L coverage as packed volume':'不能套用L/XL的380克，也不能把60升背包覆盖范围当收纳体积',
 'need assembled/headband packed envelope':'还缺少含头带的完整收拢外包络',
 'do not combine older 600 lm E065AA data with E065AB 625 lm':'不能把旧600流明E065AA与625流明E065AB的参数拼接',
 'obtain actual external folded envelope':'还需核对真实外部折叠收纳尺寸',
 'do not substitute POT-750-NH or bail-handle variant':'不能套用POT-750-NH或提梁版本参数',
 'do not combine old 26-item kit content/version with this 31-item page':'不能将旧26件版急救包内容与当前31件版混用',
 'keep NX EU 06204 distinct from newer Hubba Hubba models':'NX欧洲版06204与后续Hubba Hubba型号分开记录',
 'confirm bundled pole/stake envelope and packed geometry':'还需核对含帐杆、地钉的整包收纳外形',
 'shared marketing copy says 1.05 kg but the 5C table says 0.85 kg; keep 5A and 5C separate':'共用介绍写1.05千克，但5C表格为0.85千克；5A与5C不混用，冲突保留',
 'full folded envelope unavailable':'完整折叠收纳外包络未知',
 'clarify weight basis and complete pair envelope':'需要明确单支或成对计重，并核对整对收纳外包络',
 'do not mix older 65220621 with current 65620621S':'不能将旧65220621与当前65620621S混用',
 'actual deformation and accessory weighing scope not independently measured; manufacturer tolerance +/-5%; not a recommendation for trip temperature or fit':'实际形变与附件范围未经独立实测；厂家注明约±5%公差，不作为出行温度或适配建议',
 'soft pouch deformation not measured; no official model year or exact color SKU published in checked text':'软包形变未实测；所查正文未公布型号年份或精确颜色编号',
};
export const catalogRestrictions=candidate=>candidate.blockers.map(text=>restrictionLabels[text]??text).join('；');
export function catalogWeightText(field,collection){
 const evidence=parameterEvidence(field,collection);
 if(!evidence.usable){
  const observations=[...new Set((field?.observations??[]).map(r=>r.valueKg).filter(n=>Number.isFinite(n)&&n>0))];
  return'官方标称重量：暂无官方数据或存在冲突。'+(observations.length?`来源中的待核对值：${observations.join(' / ')} kg；口径未解决，不计入已核验重量。`:'');
 }
 return evidence.status==='verified'?`官方标称重量：${field.value} kg${field.verifiedAt?'（核验 '+field.verifiedAt+'）':''}。`:
  `官方标称重量：暂无官方数据。参考重量 ${field.value} kg（未核验，不计入已核验重量）。`;
}

// Evidence is a field-level claim. A general product link cannot fill an unknown field.
export function catalogSource(sourceId,collection){
 const source=collection.sources?.[sourceId];let url;
 try{url=new URL(source?.url);}catch{return null;}
 if(url.protocol!=='https:'||url.username||url.password)return null;
 const type=({'manufacturer-product':'品牌产品页','manufacturer-manual':'品牌官方文档','retailer-product':'商家参考资料'}[source.type]??'来源类型未核验');
 return{sourceId,url:url.href,type,location:source.location??'未记录页面位置',checkedAt:source.checkedAt??'未记录',host:url.hostname};
}
export function catalogEvidenceRows(candidate,collection){
 return Object.entries(candidate.fields).map(([key,field])=>{
  const check=parameterEvidence(field,collection),status=check.usable?(field.dataStatus==='verified'?'已核验官方参数':'参考参数，未核验'):
   field.value===null?'缺失或冲突，未采用':'证据不完整，未采用';
  const ids=[...new Set([...(field.sourceIds??[]),...(field.observations??[]).map(o=>o.sourceId).filter(Boolean)])];
  const sources=ids.map(id=>catalogSource(id,collection)).filter(Boolean);
  const observations=(field.observations??[]).filter(o=>Number.isFinite(o.valueKg)&&o.valueKg>0).map(o=>({
   valueKg:o.valueKg,sourceId:o.sourceId??null,source:catalogSource(o.sourceId,collection),
  }));
  return{key,label:key==='weightKg'?'装备重量（千克）':labels[key]??key,status,verifiedAt:field.verifiedAt??null,
   basis:field.basis??null,sources,observations,unavailableSourceCount:ids.length-sources.length};
 });
}
export function primaryCatalogSource(candidate,collection){
 const ids=[...Object.values(candidate.fields).flatMap(f=>f.sourceIds??[]),...(candidate.sourceIds??[])];
 return ids.map(id=>catalogSource(id,collection)).find(Boolean)??null;
}
