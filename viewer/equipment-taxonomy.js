// Product-independent coverage. A category is not a measured product or a packing model.
const groups=[
 ['carry','携行与收纳',[['backpack','徒步背包'],['daypack','折叠日包'],['waistpack','腰包/胸包'],['dry-bag','防水袋'],['pack-liner','背包内衬袋'],['stuff-sack','收纳袋'],['rain-cover','背包雨罩'],['compression-sack','压缩袋']]],
 ['sleep','露营与睡眠',[['tent','帐篷'],['tarp','天幕/遮雨布'],['bivy','露宿袋/应急袋'],['sleeping-bag','睡袋'],['quilt','露营被'],['sleeping-pad','睡垫'],['pillow','露营枕'],['groundsheet','帐篷地布']]],
 ['hydration','饮水与食物',[['water-bottle','水壶'],['hydration-bladder','吸管水袋'],['soft-bottle','软水瓶'],['water-filter','滤水器'],['purification-tablets','净水片'],['water-container','储水袋/桶'],['food','正餐食物'],['snacks','路餐/能量补给']]],
 ['cooking','炊事与燃料',[['stove','炉头/炉具'],['cookware','锅具'],['mug','水杯'],['cutlery','餐具'],['fuel-canister','燃料容器'],['windshield','炉具挡风板'],['lighter','打火机/火种'],['coffee-kit','咖啡/茶具']]],
 ['clothing','衣物与鞋袜',[['raincoat','雨衣/防雨外层'],['insulation-jacket','保暖外套'],['fleece','抓绒'],['base-layer','贴身层'],['hiking-pants','徒步裤'],['socks','备用袜'],['boots','徒步鞋'],['camp-shoes','营地鞋']]],
 ['accessories','行走与防护',[['hat','帽子'],['gloves','手套'],['gaiters','雪套/防沙套'],['sunglasses','太阳镜'],['buff','头巾/脖套'],['trekking-poles','登山杖'],['traction','防滑链/简易冰爪'],['umbrella','徒步伞']]],
 ['electronics','照明与电子',[['headlamp','头灯'],['lantern','营地灯'],['power-bank','充电宝'],['charging-cable','充电线/转接头'],['solar-panel','便携太阳能板'],['gps','手持GPS'],['satellite-communicator','卫星通信终端'],['radio','对讲机']]],
 ['personal','应急与个人用品',[['first-aid-kit','急救包'],['emergency-blanket','保温毯'],['whistle','求生哨'],['compass','指北针'],['repair-kit','维修/修补用品'],['knife','刀具/多功能工具'],['towel','毛巾'],['toiletry-kit','洗漱/分装用品']]],
 ['support','摄影与营地附件',[['tripod','三脚架'],['camera','相机'],['camera-lens','镜头'],['phone','手机'],['air-pump','睡垫气泵'],['tent-stakes','地钉'],['cordage','风绳/固定带'],['trash-bag','垃圾袋']]],
];
export const EQUIPMENT_TYPES=Object.freeze(groups.flatMap(([groupId,group,rows])=>rows.map(([id,name])=>Object.freeze({id,name,groupId,group}))));
export const typeById=id=>EQUIPMENT_TYPES.find(t=>t.id===id);
export function catalogCoverage(collection){return EQUIPMENT_TYPES.map(t=>({...t,productCount:collection.candidates.filter(c=>c.equipmentId===t.id).length,
 enabledCount:collection.candidates.filter(c=>c.equipmentId===t.id&&collection.enabledCandidateIds.includes(c.candidateId)).length}));}
export function genericItem(typeId){
 if(!typeById(typeId))throw Error('unknown-equipment-type');
 return{recordKind:'generic',equipmentId:typeId,brand:null,model:null,size:null,weightKg:null,packedDimensionsM:null,dataStatus:'missing',sourceUrl:null,
  note:'普通/无品牌用品类别占位；尚未记录具体物品，不是产品实测数据，不能直接用于重量或空间计算'};
}
