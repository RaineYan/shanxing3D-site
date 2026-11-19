// Reference catalog, not an inventory or an online recommendation service.
// Inspiration: https://www.nps.gov/articles/10essentials.htm
// The scene/duration thresholds below are our local MVP rules, not NPS rules.
export const CATEGORIES = ['携行与收纳', '衣物与防护', '饮水与食物', '导航与通信', '应急与照明', '露营与睡眠'];
export const DURATIONS = { day: [2, 4, 6, 8, 10, 12], overnight: [24, 36, 48, 72] };
export const GEAR = [
  { id: 'backpack', name: '徒步背包', category: '携行与收纳', note: '装好本次行程所需装备，检查肩带与扣具。', model: true },
  { id: 'boots', name: '徒步鞋', category: '衣物与防护', note: '选择适合路线、已磨合且合脚的鞋。' },
  { id: 'water', name: '饮水与水壶', category: '饮水与食物', note: '按天气、时长和可靠补水点准备饮水。' },
  { id: 'trail-food', name: '路餐与基础备用食物', category: '饮水与食物', note: '准备易携带的路餐，并留出应对延误的余量。' },
  { id: 'offline-map', name: '离线地图与导航备份', category: '导航与通信', note: '提前下载路线，准备纸图或其他导航备份并学会使用。' },
  { id: 'phone-power', name: '手机与备用电源', category: '导航与通信', note: '充好电，准备充电线与备用电源。' },
  { id: 'rain-shell', name: '防雨外套', category: '衣物与防护', note: '根据天气准备防雨、防风的外层。' },
  { id: 'warm-layer', name: '备用保暖层', category: '衣物与防护', note: '根据途中可能遇到的低温准备衣物。' },
  { id: 'sun-kit', name: '遮阳帽与防晒用品', category: '衣物与防护', note: '结合暴露程度准备帽子、太阳镜和防晒用品。' },
  { id: 'headlamp', name: '头灯与备用电量', category: '应急与照明', note: '检查照明，即使计划当天返回也为延误留准备。' },
  { id: 'first-aid', name: '急救包与个人药品', category: '应急与照明', note: '检查用品有效期，并按个人需要准备常用药品。' },
  { id: 'emergency-shelter', name: '应急保温毯或露宿袋', category: '应急与照明', note: '为意外停留准备应急遮蔽与保温用品。' },
  { id: 'repair-kit', name: '基础维修工具', category: '应急与照明', note: '按装备需要准备修补胶带等工具，遵守携带规定。' },
  { id: 'fire-kit', name: '应急火种（遵守当地规定）', category: '应急与照明', note: '先核对当地禁火及携带规定；携带不等于允许生火。' },
  { id: 'whistle', name: '求生哨', category: '应急与照明', note: '放在随手可取的位置，出发前检查。' },
  { id: 'waste-bag', name: '垃圾袋与防水收纳', category: '携行与收纳', note: '带走垃圾，为怕水物品准备防水收纳。' },
  { id: 'trekking-poles', name: '登山杖', category: '携行与收纳', note: '较长或负重行程的参考装备，按路线与习惯选择。' },
  { id: 'extra-socks', name: '备用徒步袜', category: '衣物与防护', note: '长时间步行或过夜时准备干燥的备用袜。' },
  { id: 'extra-food', name: '额外备用食物', category: '饮水与食物', note: '在基础路餐余量之外，为较长行程再留补给。' },
  { id: 'tent', name: '帐篷与配套固定件', category: '露营与睡眠', note: '过夜按露营预设；确认营地允许扎营并检查配件。' },
  { id: 'sleeping-bag', name: '睡袋', category: '露营与睡眠', note: '根据营地预期低温选择，并保持干燥。' },
  { id: 'sleeping-mat', name: '防潮垫', category: '露营与睡眠', note: '准备适合地面条件与温度的睡垫。' },
  { id: 'camp-meals', name: '过夜餐食', category: '饮水与食物', note: '核对晚餐与早餐，可优先准备无需烹饪的食物。' },
  { id: 'hygiene', name: '基础洗漱用品', category: '携行与收纳', note: '按营地规定使用，妥善带走产生的垃圾。' },
  { id: 'change-clothes', name: '备用换洗衣物', category: '衣物与防护', note: '较长过夜行程增加干燥衣物，按天气选择。' },
  { id: 'water-treatment', name: '水处理用品', category: '饮水与食物', note: '较长行程核对水源与处理方案，不默认途中水可直饮。' },
];

const BASE = GEAR.slice(0, 16).map(item => item.id);
const CAMP = ['tent', 'sleeping-bag', 'sleeping-mat', 'camp-meals', 'hygiene'];

export function itemsForPlan(plan) {
  const ids = new Set(BASE);
  const hours = plan.context?.durationPending ? 0 : plan.context?.hours ?? plan.hours;
  if (plan.type === 'overnight' || hours >= 8) {
    ids.add('trekking-poles'); ids.add('extra-socks');
  }
  if ((plan.type === 'day' && hours >= 8) || (plan.type === 'overnight' && hours >= 36)) ids.add('extra-food');
  if (plan.type === 'overnight' && !plan.context?.durationPending && plan.context?.lodging !== 'indoors') CAMP.forEach(id => ids.add(id));
  const conditions = new Set([...(plan.context?.conditions ?? []), ...(plan.context?.weatherSignals ?? [])]);
  if (conditions.has('rain') || conditions.has('cold')) ids.add('extra-socks');
  if (plan.context?.conditions?.includes('noSupply')) {
    ids.add('extra-food');
    ids.add('water-treatment');
  }
  if (plan.type === 'overnight' && hours >= 36) {
    ids.add('change-clothes'); ids.add('water-treatment');
  }
  return GEAR.filter(item => ids.has(item.id));
}

export function planLabel(plan) {
  const context = plan.context;
  const type = plan.type === 'day' ? '一日徒步' : context?.lodging === 'indoors' ? '过夜徒步 · 住宿' : '过夜徒步 · 露营';
  if (context?.durationPending) return [context.destination, '时长待补充'].filter(Boolean).join(' / ');
  return [context?.destination, type, `${context?.hours ?? plan.hours} 小时`].filter(Boolean).join(' / ');
}

export function ruleDescription(plan) {
  if (plan.context?.durationPending) return '先预选基础装备，再按已知天气与补给调整。过夜和长线装备待补充行程后再加入。';
  const hours = plan.context?.durationPending ? 0 : plan.context?.hours ?? plan.hours;
  if (plan.type === 'overnight') return hours >= 36
    ? '露营清单 + 较长行程补充：睡眠装备、备用衣物、水处理用品与额外食物。'
    : '露营清单：在基础装备上加入睡眠装备、过夜餐食、洗漱用品、登山杖和备用袜。';
  return hours >= 8 ? '较长一日行程：基础装备 + 登山杖、备用袜与额外备用食物。' : '当天往返：携行、补给、防护、导航与应急的基础参考清单。';
}
