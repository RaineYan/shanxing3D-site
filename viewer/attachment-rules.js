// Pure compatibility rules. No equipment IDs or global backpack selection in this module.
import { Euler, Quaternion, Matrix4 } from '../vendor/three/three.module.js';
const axes=['x','y','z'];
const finite3=v=>Array.isArray(v)&&v.length===3&&v.every(Number.isFinite);
export function validateAttachmentProfile(profile) {
  if(!profile?.variantId||profile.referenceFrame!=='backpack-local-meters'||!Array.isArray(profile.attachments))throw Error('invalid-attachment-profile');
  const body=profile.backpackCollision;
  if(!body||body.variantId!==profile.variantId||body.unit!=='m'||body.referenceFrame!==profile.referenceFrame||body.shape!=='box'||
    !finite3(body.centerM)||!finite3(body.sizeM)||body.sizeM.some(n=>n<=0)||!['demo','verified'].includes(body.dataStatus))throw Error('invalid-backpack-collision');
  const ids=new Set();
  for(const a of profile.attachments){
    if(!a.id||ids.has(a.id)||a.variantId!==profile.variantId||a.unit!=='m'||a.referenceFrame!==profile.referenceFrame||!a.type||!finite3(a.positionM)||!finite3(a.rotationRad)||
      !finite3(a.regionSizeM)||a.regionSizeM.some(n=>n<=0)||!Number.isInteger(a.capacity)||a.capacity<1||
      !Array.isArray(a.capabilities)||!Array.isArray(a.resourceIds)||!a.resourceIds.length||a.resourceIds.some(r=>typeof r!=='string'||!r)||
      !['demo','verified','missing'].includes(a.dataStatus)||a.maxLoadKg!==null&&(!Number.isFinite(a.maxLoadKg)||a.maxLoadKg<=0))throw Error('invalid-attachment-profile');
    if(a.dataStatus==='verified'){
      let url;try{url=new URL(a.sourceUrl);}catch{throw Error('missing-attachment-evidence');}
      if(url.protocol!=='https:'||url.username||url.password||!['official-site','official-document'].includes(a.sourceType)||
        !/^\d{4}-\d{2}-\d{2}$/.test(a.verifiedAt??'')||!Number.isFinite(Date.parse(a.verifiedAt))||new Date(a.verifiedAt).toISOString().slice(0,10)!==a.verifiedAt)throw Error('missing-attachment-evidence');
    }
    ids.add(a.id);
    const c=a.contact;
    if(c&&(!axes.includes(c.axis)||![1,-1].includes(c.sign)||!Number.isFinite(c.gapM)||c.gapM<0||!Number.isFinite(c.maxInsetM)||c.maxInsetM<0||
      c.maxInsetM>body.sizeM[axes.indexOf(c.axis)]*.1||c.gapM>0&&c.maxInsetM>0))throw Error('invalid-contact-region');
    if(a.supportPointsM!==undefined&&(!Array.isArray(a.supportPointsM)||a.supportPointsM.length!==2||!a.supportPointsM.every(finite3)))throw Error('invalid-mount-guide');
  }
  return profile;
}
export function installationRotation(anchor,option) {
  const q=new Quaternion().setFromEuler(new Euler(...anchor.rotationRad)).multiply(new Quaternion().setFromEuler(new Euler(...(option.rotationRad??[0,0,0]))));
  return new Euler().setFromQuaternion(q,'XYZ');
}
export function rotatedExtent(asset,rotation){
  const m=new Matrix4().makeRotationFromEuler(rotation).elements,d=axes.map(k=>asset.packedSizeM[k]);
  return axes.map((_,i)=>d.reduce((sum,n,j)=>sum+Math.abs(m[j*4+i])*n,0));
}
export function installationPosition(asset,anchor,option,body){
  const p=[...anchor.positionM],c=anchor.contact;
  if(c&&body){const i=axes.indexOf(c.axis),extent=rotatedExtent(asset,installationRotation(anchor,option));
    p[i]=body.centerM[i]+c.sign*(body.sizeM[i]/2+c.gapM-c.maxInsetM+extent[i]/2);}
  return p;
}
export function attachmentCompatibility(asset,anchor,{weightKg=null}={}) {
  const fail=reason=>({allowed:false,reason,option:null,dataStatus:anchor?.dataStatus??'missing',loadStatus:'unverified'});
  if(!anchor||anchor.dataStatus==='missing'||!anchor.type)return fail('invalid-anchor');
  const size=asset?.packedSizeM;
  if(!size||!axes.every(k=>Number.isFinite(size[k])&&size[k]>0))return fail('missing-mount-dimensions');
  const options=(Array.isArray(asset.mounting?.options)?asset.mounting.options:[]).filter(o=>Array.isArray(o?.interfaceTypes)&&o.interfaceTypes.includes(anchor.type));
  if(!options.length)return fail('invalid-anchor');
  let reason='incompatible-mount-shape';
  for(const option of options){
    if(![option.shapes,option.packingStates,option.requires].every(Array.isArray)||!finite3(option.rotationRad??[0,0,0])){reason='invalid-mount-config';continue;}
    if(!option.shapes.includes(asset.collisionShape)||!option.packingStates.includes(asset.packingState))continue;
    if(!option.requires.every(c=>anchor.capabilities?.includes(c))){reason='missing-mount-support';continue;}
    const extent=rotatedExtent(asset,installationRotation(anchor,option));
    if(!finite3(extent)||!finite3(anchor.regionSizeM)||extent.some((n,i)=>n>anchor.regionSizeM[i]+1e-8)){reason='outside-anchor-region';continue;}
    if(anchor.dataStatus==='verified'&&(asset.productSpec?.dataStatus!=='verified'||!axes.every(k=>asset.productSpec.packedDimensions&&Math.abs(asset.productSpec.packedDimensions[k]-size[k])<1e-8)))return fail('missing-mount-dimensions');
    if(Number.isFinite(anchor.maxLoadKg)&&weightKg!==null&&weightKg>anchor.maxLoadKg)return fail('mount-overweight');
    const loadKnown=Number.isFinite(anchor.maxLoadKg)&&weightKg!==null;
    if(anchor.dataStatus==='verified'&&!loadKnown)return fail('missing-mount-load-data');
    return{allowed:true,reason:null,option,dataStatus:anchor.dataStatus,loadStatus:loadKnown?'within-configured-limit':'unverified',
      warning:anchor.dataStatus==='demo'?'演示安装几何可用，真实固定结构与承载未核验':null};
  }
  return fail(reason);
}
