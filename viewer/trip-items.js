// Carry choices are separate from preparation, ownership and placed instances.
import {GEAR,itemsForPlan} from '../gear-data.js';
import {EQUIPMENT_TYPES} from './equipment-taxonomy.js';
const aliases={water:'water-bottle','rain-shell':'raincoat',headlamp:'headlamp','first-aid':'first-aid-kit',tent:'tent','sleeping-bag':'sleeping-bag','sleeping-mat':'sleeping-pad','trekking-poles':'trekking-poles'};
export const AUTO_TRIP_TYPES=Object.freeze([...new Set([...Object.values(aliases),'cookware','tripod'])]);
const represented=new Set([...GEAR.map(r=>r.id),...Object.values(aliases)]);
export const TRIP_ITEM_OPTIONS=Object.freeze([
 ...GEAR.map(r=>Object.freeze({...r,packingType:aliases[r.id]??null})),
 ...EQUIPMENT_TYPES.filter(r=>!represented.has(r.id)).map(r=>Object.freeze({id:'extra:'+r.id,name:r.name,category:r.group,
   note:'自主选择的额外物品；具体型号、数量和实际准备情况请另行核对。',packingType:r.id})),
]);
const known=new Set(TRIP_ITEM_OPTIONS.map(r=>r.id));
export function normalizeTripChoices(value){
 const clean=a=>[...new Set((Array.isArray(a)?a:[]).filter(id=>typeof id==='string'&&known.has(id)))];
 return {excluded:clean(value?.excluded),extras:clean(value?.extras)};
}
export function tripEquipmentReasons(plan) {
 const context = plan.context;
 const reasons = new Map();
 const add = (ids, reason) => {
  for (const id of ids) reasons.set(id, [...(reasons.get(id) ?? []), reason]);
 };
 for (const [condition, ids, description] of [
  ['rain', ['rain-shell', 'extra-socks', 'extra:dry-bag'], '有降雨，保护衣物和怕水装备'],
  ['cold', ['warm-layer', 'extra-socks', 'extra:gloves'], '有低温，补足保暖和干燥替换'],
  ['wind', ['rain-shell'], '有大风，核对外层防风能力'],
 ]) {
  const forecast = context?.weatherSignals?.includes(condition);
  if (forecast || context?.conditions?.includes(condition)) {
   add(ids, (forecast ? '点位预报' : '你提供的情况') + '显示' + description);
  }
 }
 if (context?.lodgingCold) {
  add(['warm-layer', 'extra-socks'], '住宿点夜间预报偏冷，核对干燥换洗与保暖衣物');
  if (context.lodging === 'camp' && !context.durationPending) {
   add(['sleeping-bag', 'sleeping-mat'], '营地夜间偏冷，核对睡袋舒适温标和睡垫保温性能');
  }
 }
 if (context?.conditions?.includes('noSupply')) {
  add(['water', 'water-treatment', 'extra-food'], '途中补给不可靠，预留饮食并核对实际可用水源');
 }
 return reasons;
}
function recommendedIds(plan, reasons) {
 return new Set([...itemsForPlan(plan).map(item => item.id), ...reasons.keys()]);
}
export function selectedTripItems(plan,choices){
 const {excluded,extras}=normalizeTripChoices(choices), reasons=tripEquipmentReasons(plan);
 const recommended=recommendedIds(plan,reasons);
 const picked=new Set([...recommended,...extras]);for(const id of excluded)picked.delete(id);
 return TRIP_ITEM_OPTIONS.filter(r=>picked.has(r.id)).map(r=>{
  const itemReasons=reasons.get(r.id);
  return {...r,extra:!recommended.has(r.id), ...(itemReasons ? { reasons:itemReasons } : {})};
 });
}
export function setTripChoice(plan,choices,id,carry){
 if(!known.has(id))throw Error('未知携带物品');
 const normalized=normalizeTripChoices(choices),excluded=new Set(normalized.excluded),extras=new Set(normalized.extras);
 if(carry){excluded.delete(id);if(!recommendedIds(plan,tripEquipmentReasons(plan)).has(id))extras.add(id);}
 else{extras.delete(id);excluded.add(id);}
 return {excluded:[...excluded],extras:[...extras]};
}
