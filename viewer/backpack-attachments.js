// Independent, version-scoped attachment data. Every value here is DEMO, not Osprey hardware.
export const ATTACHMENT_TYPE_LABELS=Object.freeze({'paired-straps':'双带固定','supported-side':'侧面压缩带','side-pocket':'侧袋','tool-retainer':'工具挂点'});
export function createDemoAttachmentProfile(variantId,exteriorSizeM){
 const {x,y,z}=exteriorSizeM;
 if(![x,y,z].every(n=>Number.isFinite(n)&&n>0))throw Error('invalid-exterior-reference');
 const metadata={unit:'m',dataStatus:'demo',variantId,referenceFrame:'backpack-local-meters',sourceIds:[variantId+'-reference'],
  source:'开发演示结构/位置/接触范围，非实测扣具或承重参数',sourceUrl:null,sourceType:'project-demo',verifiedAt:null};
 const point=(id,name,type,positionM,rotationRad,regionSizeM,capabilities,supportPointsM,contact)=>({
  ...metadata,id,name,type,positionM,rotationRad,regionSizeM,capabilities,supportPointsM,contact,
  capacity:1,resourceIds:[id+'-upper-strap',id+'-lower-strap'],maxLoadKg:null});
 const sideGap=Math.max(0,.165-x/2);
 return{
  attachmentSchemaVersion:2,
  backpackCollision:{...metadata,id:'exterior-envelope',shape:'box',centerM:[0,0,0],sizeM:[x,y,z],
   source:'当前统一外部尺寸的保守包络，含肩带；仅拒绝明显侵入，非GLB网格或真实包体'},
  attachments:[
   point('top','顶部','paired-straps',[0,.31,0],[0,0,0],[.56,.18,.18],['paired-retention'],[[-.12,.22,0],[.12,.22,0]],{axis:'y',sign:1,gapM:0,maxInsetM:.005}),
   point('bottom','底部','paired-straps',[0,-.31,0],[0,0,0],[.56,.18,.18],['paired-retention'],[[-.12,-.22,0],[.12,-.22,0]],{axis:'y',sign:-1,gapM:0,maxInsetM:.005}),
   ...[-1,1].map(sign=>point(sign<0?'left':'right',sign<0?'左侧':'右侧','supported-side',[sign*.23,0,0],[0,0,Math.PI/2],[.18,.56,.18],
    ['paired-retention','base-support','tip-retention'],[[sign*.12,-.16,0],[sign*.12,.16,0]],{axis:'x',sign,gapM:sideGap,maxInsetM:0})),
   ...[-1,1].map(sign=>point(sign<0?'left-pocket':'right-pocket',sign<0?'左侧袋':'右侧袋','side-pocket',[sign*(x/2+.02),-.04,.04],[0,0,0],[.10,.24,.10],
    ['base-support','neck-retention'],[[sign*.12,-.10,.04],[sign*.12,.02,.04]],{axis:'x',sign,gapM:0,maxInsetM:.02})),
   point('front-tool','前部工具挂点','tool-retainer',[0,0,z/2+.05],[0,0,0],[.12,.58,.12],['paired-retention','tip-retention'],
    [[0,-.16,z*.4],[0,.16,z*.4]],{axis:'z',sign:1,gapM:.02,maxInsetM:0}),
  ]
 };
}
