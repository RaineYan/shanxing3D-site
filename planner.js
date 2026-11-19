import { CATEGORIES, DURATIONS, GEAR, planLabel, ruleDescription } from './gear-data.js';
import {interpretTrip, normalizeTripContext} from './viewer/trip-intent.js';
import {plannedKit} from './viewer/planner-bridge.js';
import {TRIP_ITEM_OPTIONS,normalizeTripChoices,selectedTripItems,setTripChoice} from './viewer/trip-items.js';

const STORAGE_KEY = 'shanxing3d:planner:v1';
const VIEWS = ['explore', 'plan', 'library', 'checklist'];
const defaults = () => ({ version: 1, plan: { type: 'day', hours: 4 }, generated: false, prepared: [], choices:normalizeTripChoices() });
const notice = document.querySelector('#storage-notice');
function storageNotice(message) { notice.textContent = message; notice.hidden = false; }
function readState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaults();
    const saved = JSON.parse(raw);
    if (saved?.version !== 1 || !['day', 'overnight'].includes(saved?.plan?.type) ||
        !DURATIONS[saved.plan.type].includes(saved.plan.hours) || typeof saved.generated !== 'boolean' || !Array.isArray(saved.prepared)) throw new Error('Invalid saved plan');
    const choices=normalizeTripChoices(saved.choices),allowed = new Set(selectedTripItems(saved.plan,choices).map(item => item.id));
    return { version: 1, plan: { type: saved.plan.type, hours: saved.plan.hours, context: normalizeTripContext(saved.plan.context) }, generated: saved.generated,
      prepared: saved.generated ? [...new Set(saved.prepared.filter(id => allowed.has(id)))] : [],choices };
  } catch {
    storageNotice('无法读取上次保存的计划，当前使用默认设置。你仍可继续规划；若浏览器限制了本地存储，刷新可能无法保留。');
    return defaults();
  }
}
let state = readState();
let listFilter = 'all';
let categoryFilter = 'all';

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    notice.hidden = true;
  } catch {
    storageNotice('浏览器无法保存本地数据。本次操作仍有效，但关闭或刷新后可能丢失；请检查浏览器存储设置。');
  }
}
function element(tag, className, content) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (content !== undefined) node.textContent = content;
  return node;
}
function currentItems() { return state.generated ? selectedTripItems(state.plan,state.choices) : []; }
function progress() {
  const items = currentItems();
  const ready = items.filter(item => state.prepared.includes(item.id)).length;
  return { items, ready, pending: items.length - ready, percent: items.length ? Math.round(ready / items.length * 100) : 0 };
}

const ruleHelp = document.querySelector('.rule-help');
const ruleHelpToggle = document.querySelector('#rule-help-toggle');
const ruleHelpPanel = document.querySelector('#rule-help-panel');
let ruleHelpPinned = false;
function setRuleHelp(open) {
  ruleHelpPanel.hidden = !open;
  ruleHelpToggle.setAttribute('aria-expanded', String(open));
  if (!open) ruleHelpPinned = false;
}
ruleHelp.addEventListener('pointerenter', event => {
  if (event.pointerType === 'mouse') setRuleHelp(true);
});
ruleHelp.addEventListener('pointerleave', () => {
  if (!ruleHelpPinned && !ruleHelpPanel.contains(document.activeElement)) setRuleHelp(false);
});
ruleHelpToggle.addEventListener('click', () => {
  ruleHelpPinned = !ruleHelpPinned;
  setRuleHelp(ruleHelpPinned);
});
ruleHelp.addEventListener('focusout', event => {
  if (!ruleHelp.contains(event.relatedTarget) && !ruleHelp.matches(':hover')) setRuleHelp(false);
});
document.addEventListener('pointerdown', event => {
  if (!ruleHelp.contains(event.target)) setRuleHelp(false);
});
document.addEventListener('keydown', event => {
  if (event.key !== 'Escape' || ruleHelpPanel.hidden) return;
  setRuleHelp(false);
  if (ruleHelp.contains(document.activeElement) || document.activeElement === document.body) ruleHelpToggle.focus();
});

const hoursSelect = document.querySelector('#trip-hours');
function renderPlan() {
  document.querySelectorAll('[name="trip-type"]').forEach(radio => { radio.checked = radio.value === state.plan.type; });
  hoursSelect.replaceChildren(...DURATIONS[state.plan.type].map(hours => {
    const option = element('option', '', `${hours} 小时`);
    option.value = hours;
    return option;
  }));
  hoursSelect.value = state.plan.hours;
  document.querySelector('#trip-destination').value = state.plan.context?.destination ?? '';
  const items = selectedTripItems(state.plan, state.choices);
  document.querySelector('#rule-count').textContent = `本次预选 ${items.length} 项装备`;
  const highlights = items.filter(item => item.reasons?.length);
  document.querySelector('#trip-equipment-highlights').replaceChildren(...highlights.map(item =>
    element('li', '', `${item.name} · ${item.reasons.join('；')}`)));
  document.querySelector('#trip-equipment-list').replaceChildren(...items.map(item =>
    element('li', '', item.name)));
  document.querySelector('#trip-equipment-highlights').hidden = !highlights.length;
  const context = state.plan.context;
  const reasons = [];
  if (context?.lodging === 'indoors') reasons.push('住店或山屋，基础清单不预选帐篷、睡袋和睡垫，请核对住宿提供的寝具与餐食。');
  if (context?.conditions.includes('rain')) reasons.push('你提到降雨，检查防雨外套、防水收纳和备用干袜。');
  if (context?.conditions.includes('cold')) reasons.push('你提到低温，检查备用保暖层和干袜。');
  if (context?.conditions.includes('wind')) reasons.push('你提到大风，检查防风外层，并核对路线是否开放。');
  if (context?.conditions.includes('noSupply')) reasons.push('你提到无可靠补给，补充备用食物与水源处理准备，并核对实际可用水源。');
  if (context?.weatherSignals.length) {
    const labels = { rain: '防雨与防水收纳', cold: '保暖与干燥备用衣物', wind: '防风和路线开放情况' };
    reasons.push(`上次查询的预报提示核对${context.weatherSignals.map(key => labels[key]).join('、')}。`);
  }
  document.querySelector('#rule-explanation').textContent = [
    context?.lodging === 'indoors' ? '' : ruleDescription(state.plan), ...reasons,
  ].filter(Boolean).join(' ');
}
function renderSummary() {
  const { ready, pending, items, percent } = progress();
  const summary = document.querySelector('#explore-summary');
  summary.replaceChildren();
  if (!state.generated) {
    summary.append(element('p', 'summary-label', '还没有出发计划'), element('p', 'subtle', '一日轻行，或在山野过夜。先选行程，再逐件核对。'));
  } else {
    summary.append(element('p', 'summary-label', planLabel(state.plan)), element('p', 'summary-number', `${ready} / ${items.length}`), element('p', 'subtle', `已准备 · ${percent}%　还有 ${pending} 项待核对`));
    const link = element('a', 'text-link', '继续准备我的清单 →'); link.href = '#checklist'; summary.append(link);
  }
  document.querySelector('#explore-plan-link').firstChild.textContent = state.generated ? '调整徒步计划 ' : '开始徒步计划 ';
  const badge = document.querySelector('#nav-count');
  badge.hidden = !state.generated;
  badge.textContent = `${ready}/${items.length}`;
  badge.setAttribute('aria-label', `已准备 ${ready} 项，共 ${items.length} 项`);
}

function renderLibrary() {
  const active = new Set(currentItems().map(item => item.id));
  const items = GEAR.filter(item => categoryFilter === 'all' || item.category === categoryFilter);
  document.querySelector('#library-count').textContent = `${items.length} 件参考装备 · ${items.filter(item => item.model).length} 个实际 3D 模型`;
  const cards = items.map(item => {
    const card = element('article', 'gear-card panel');
    const top = element('div', 'gear-card-top');
    top.append(element('span', 'gear-category', item.category), element('span', item.model ? 'model-badge' : 'plain-badge', item.model ? '3D 模型' : '资料卡'));
    const title = element('h2', '', item.name);
    const inPlan = active.has(item.id);
    const ready = inPlan && state.prepared.includes(item.id);
    const status = !state.generated ? '尚未生成清单' : !inPlan ? '本次未列入' : ready ? '已准备' : '待准备';
    const bottom = element('div', 'gear-card-bottom');
    bottom.append(element('span', `gear-status ${inPlan ? ready ? 'is-ready' : 'is-pending' : ''}`, status));
    if (item.model) {
      const link = element('a', 'text-link', '查看 3D 背包 ↗'); link.href = '#explore';
      link.addEventListener('click', () => {
        requestAnimationFrame(() => { document.querySelector('#viewer').scrollIntoView({ block: 'center' }); document.querySelector('#viewer').focus({ preventScroll: true }); });
      });
      bottom.append(link);
    }
    card.append(top, title, element('p', 'gear-note', item.note), bottom);
    return card;
  });
  document.querySelector('#gear-grid').replaceChildren(...cards);
}

function updateProgress() {
  const { ready, pending, items, percent } = progress();
  document.querySelector('#checklist-empty').hidden = state.generated;
  document.querySelector('#checklist-content').hidden = !state.generated;
  document.querySelector('#checklist-heading-progress').hidden = !state.generated;
  document.querySelector('#checklist-plan').textContent = planLabel(state.plan);
  document.querySelector('#progress-count').textContent = `已准备 ${ready} / ${items.length} 项`;
  document.querySelector('#progress-percent').textContent = `${percent}%`;
  const meter = document.querySelector('#preparation-progress');
  meter.max = items.length || 1; meter.value = ready;
  document.querySelector('#pending-summary').textContent = !items.length?'尚未选择携带物品，请展开“选择携带物品”添加。':pending
    ? `还有 ${pending} 项待准备。可切换“待准备”逐件核对。` : '本次清单已全部勾选。出发前请再结合路线、天气与个人需求复核。';
  if(state.generated){const kit=plannedKit(state);
    document.querySelector('#trip-packing-preview').textContent=`${kit.equipmentIds.length} 类装备可带入3D待放区，${kit.checklistOnly.length}项留在清单核对或另选具体型号。使用演示型号，不自动勾选准备、不自动放置。可展开“选择携带物品”增减本次物品。`;
  }
  document.querySelectorAll('[data-filter]').forEach(button => {
    button.setAttribute('aria-pressed', String(button.dataset.filter === listFilter));
    const count = button.dataset.filter === 'all' ? items.length : button.dataset.filter === 'ready' ? ready : pending;
    button.textContent = `${{ all: '全部', pending: '待准备', ready: '已准备' }[button.dataset.filter]} ${count}`;
  });
}

function renderChecklist() {
  updateProgress();
  const items = currentItems().filter(item => listFilter === 'all' || (listFilter === 'ready') === state.prepared.includes(item.id));
  const groups = [];
  for (const category of new Set([...CATEGORIES,...currentItems().map(r=>r.category)])) {
    const matches = items.filter(item => item.category === category);
    if (!matches.length) continue;
    const group = element('section', 'checklist-group panel');
    group.append(element('h2', '', `${category} · ${matches.length}`));
    for (const item of matches) {
      const label = element('label', 'check-row');
      const checkbox = element('input'); checkbox.type = 'checkbox'; checkbox.dataset.gearId = item.id;
      checkbox.checked = state.prepared.includes(item.id);
      const text = element('span', 'check-text');
      text.append(element('strong', '', item.name+(item.extra?' · 额外携带':'')), element('small', '', item.reasons?.length ? item.reasons.join('；') + '。' : item.note));
      label.append(checkbox, text);
      group.append(label);
    }
    groups.push(group);
  }
  if (!groups.length && state.generated) {
    const empty = element('div', 'panel filter-empty');
    empty.append(element('h2', '', !currentItems().length?'尚未选择携带物品':listFilter === 'ready' ? '还没有已准备的装备' : '当前没有待准备物品'), element('p', 'subtle', !currentItems().length?'展开“选择携带物品”添加本次要带的装备。':listFilter === 'ready' ? '切换“全部”或“待准备”，从第一件开始。' : '已完成本次勾选，出发前仍请按实际情况复核。'));
    groups.push(empty);
  }
  document.querySelector('#checklist-groups').replaceChildren(...groups);
}

const choicePickers=[...document.querySelectorAll('[data-trip-choices]')].map(root=>{
 const search=element('input');search.type='search';search.placeholder='搜索物品或类别';search.setAttribute('aria-label','搜索可携带物品');
 const count=element('p','subtle'),list=element('div','trip-choice-list'),reset=element('button','button secondary','恢复计划建议');reset.type='button';
 const rows=TRIP_ITEM_OPTIONS.map(item=>{const label=element('label','trip-choice-row'),box=element('input');box.type='checkbox';box.dataset.tripChoice=item.id;box.setAttribute('aria-label','携带 '+item.name);
   const text=element('span');text.append(element('strong','',item.name),element('small','',item.category));label.append(box,text);list.append(label);return{item,label,box};});
 root.append(search,count,list,reset);
 const filter=()=>{const query=search.value.trim().toLocaleLowerCase();for(const r of rows)r.label.hidden=!!query&&!`${r.item.name} ${r.item.category}`.toLocaleLowerCase().includes(query);};
 search.addEventListener('input',filter);
 search.addEventListener('keydown',event=>{if(event.key==='Enter')event.preventDefault();});
 list.addEventListener('change',event=>{const id=event.target.dataset.tripChoice;if(!id)return;state.choices=setTripChoice(state.plan,state.choices,id,event.target.checked);choicesChanged();});
 reset.onclick=()=>{state.choices=normalizeTripChoices();choicesChanged();};
 return{rows,count,filter};
});
function choicesChanged(){const allowed=new Set(selectedTripItems(state.plan,state.choices).map(r=>r.id));state.prepared=state.prepared.filter(id=>allowed.has(id));save();refresh();}
function renderChoices(){const selected=selectedTripItems(state.plan,state.choices),ids=new Set(selected.map(r=>r.id));for(const picker of choicePickers){
 for(const row of picker.rows)row.box.checked=ids.has(row.item.id);picker.count.textContent=`本次携带 ${selected.length} 项，其中额外选择 ${selected.filter(r=>r.extra).length} 项；可选 ${TRIP_ITEM_OPTIONS.length} 项。携带选择与“已准备”分开记录。`;picker.filter();}}
function refresh() { renderPlan(); renderSummary(); renderLibrary(); renderChecklist();renderChoices(); }
export function preparePackingPlan(){
  state.generated=true;save();refresh();
  return structuredClone(state); // Works even when browser storage is unavailable.
}
function updatePlan(plan) {
  state.plan = { ...plan, context: normalizeTripContext(plan.context) };
  const allowed = new Set(selectedTripItems(plan,state.choices).map(item => item.id));
  state.prepared = state.prepared.filter(id => allowed.has(id));
  save(); refresh();
  document.querySelector('#plan-message').textContent = state.generated ? '清单已随行程更新；共同装备的勾选已保留。' : '行程选择已记录，点击下方按钮查看清单。';
}
document.querySelectorAll('[name="trip-type"]').forEach(radio => radio.addEventListener('change', () => {
  updatePlan({ type: radio.value, hours: radio.value === 'day' ? 4 : 24,
    context: { ...state.plan.context, hours: null, durationPending: false, forecastInput: '', lodging: null, weatherSignals: [], lodgingCold: false } });
}));
hoursSelect.addEventListener('change', () => updatePlan({ ...state.plan, hours: Number(hoursSelect.value),
  context: { ...state.plan.context, hours: null, durationPending: false, forecastInput: '', weatherSignals: [], lodgingCold: false } }));
const tripInput = document.querySelector('#trip-intent');
const tripResult = document.querySelector('#trip-intent-result');
const tripDestination = document.querySelector('#trip-destination');
let interpretedText = '';
const tripSubmit = document.querySelector('#plan-form button[type="submit"]');
const weatherOutput = document.querySelector('#trip-weather');
const weatherPanel = document.querySelector('#trip-weather-panel');
const weatherSummary = document.querySelector('#trip-weather-summary');
const weatherRefresh = document.querySelector('#trip-weather-refresh');
let analysisRunning = false;
let tripInputVersion = 0;
let weatherRequest = 0;
function savedWeatherInput() {
  const { context, type, hours } = state.plan;
  if (!context?.destination || !(context.startDate || context.timing)) return '';
  if (context.forecastInput && context.startDate) return `${context.startDate} ${context.forecastInput}`;
  const duration = context.durationPending ? '' : `${context.hours ?? hours}小时`;
  const stay = type === 'overnight' ? '过夜' : '';
  return `${context.startDate || context.timing}去${context.destination}徒步${duration}${stay}`;
}
async function requestTripAnalysis(text) {
  const response = await fetch('/api/trip-analysis', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }), signal: AbortSignal.timeout(32000),
  });
  if (!response.ok) throw new Error('Analysis unavailable');
  return response.json();
}
async function refreshChecklistWeather() {
  const text = savedWeatherInput();
  if (!text || weatherRefresh.disabled) return;
  const request = ++weatherRequest;
  weatherRefresh.disabled = true;
  weatherSummary.textContent = '正在重新查询预报…';
  try {
    const result = await requestTripAnalysis(text);
    if (request !== weatherRequest) return;
    showWeather(result.weather);
    if (result.intent.startDate && !state.plan.context.startDate) {
      state.plan.context.startDate = result.intent.startDate;
      save();
    }
  } catch {
    if (request === weatherRequest) showWeather({ status: 'unavailable' });
  } finally {
    if (request === weatherRequest) weatherRefresh.disabled = false;
  }
}
weatherRefresh.addEventListener('click', refreshChecklistWeather);
function clearWeather() {
  weatherRequest++;
  weatherRefresh.disabled = false;
  weatherPanel.hidden = true;
  weatherPanel.open = false;
  weatherOutput.textContent = '';
}

function showWeather(weather) {
  const notes = {
    'date-needed': '要查预报，请提供明确的出发日期。',
    'location-needed': '暂未找到唯一的山地点位。可补充省市或更具体的路线名，也可以先看装备清单。',
    'outside-range': '行程日期超出可查预报范围。',
    unavailable: '天气服务暂时不可用，可继续按你提供的情况整理。',
  };
  weatherPanel.hidden = false;
  weatherRefresh.hidden = !savedWeatherInput();
  const lodging = weather?.lodging;
  const lodgingSummary = lodging?.status === 'ready'
    ? `住宿点夜间最低 ${lodging.minTemp}°C`
    : lodging ? '住宿点预报待补充' : '';
  const lodgingDetails = lodging?.status === 'ready'
    ? `住宿点 ${lodging.pointName} · 夜间最低 ${lodging.minTemp}°C（18:00 至次日 08:00） · ${lodging.start} 至 ${lodging.end} · 点位 ${lodging.latitude.toFixed(4)}, ${lodging.longitude.toFixed(4)}${Number.isFinite(lodging.elevation) ? ` · 参考海拔 ${Math.round(lodging.elevation)} 米` : ''} · ${lodging.source}${lodging.cached ? '（近期查询）' : ''} · 获取于 ${new Date(lodging.fetchedAt).toLocaleString('zh-CN')}`
    : lodging?.status === 'location-needed'
      ? '住宿点未定位。可以在行程描述里写具体客栈或营地名，或补充住宿坐标。'
      : lodging ? '住宿点夜间预报暂不可用。' : '';
  if (weather?.status !== 'ready') {
    weatherSummary.textContent = ['路线高点预报暂未获取', lodgingSummary].filter(Boolean).join(' · ');
    weatherOutput.textContent = [notes[weather?.status] ?? notes.unavailable, lodgingDetails].filter(Boolean).join('\n');
    return;
  }
  const elevation = Number.isFinite(weather.elevation) ? ` · 参考海拔 ${Math.round(weather.elevation)} 米` : '';
  const location = weather.pointName || '所选点位';
  weatherSummary.textContent = [`${location}${elevation} · 最低 ${weather.minTemp}°C`, lodgingSummary].filter(Boolean).join(' · ');
  const altitudeNote = weather.elevation >= 3500 ? '。高海拔点位预报仅供参考，请核对当地开放情况和专项装备。' : '';
  weatherOutput.textContent = `${weather.source}${weather.cached ? '（近期查询）' : ''} · ${weather.start} 至 ${weather.end} · 最低 ${weather.minTemp}°C · 最高降水概率 ${weather.rainChance}% · 最大阵风 ${weather.gust} km/h · 点位 ${weather.pointName ?? ''} ${weather.latitude.toFixed(4)}, ${weather.longitude.toFixed(4)}${weather.elevation == null ? '' : ` · 预报参考海拔 ${weather.elevation} 米`} · 获取于 ${new Date(weather.fetchedAt).toLocaleString('zh-CN')}${altitudeNote}`;
  if (lodgingDetails) weatherOutput.textContent += '\n' + lodgingDetails;
}
tripInput.addEventListener('input', () => {
  tripInputVersion++;
  interpretedText = '';
  clearWeather();
  tripResult.textContent = '';
});
async function applyTripText() {
  const text = tripInput.value.trim();
  if (!text) {
    tripResult.textContent = '输入一句话，或展开行程参数手动填写。';
    return false;
  }
  if (analysisRunning) return false;
  analysisRunning = true;
  const version = tripInputVersion;
  tripSubmit.disabled = true;
  tripResult.textContent = '正在整理清单…';
  clearWeather();
  let result;
  try {
    result = await requestTripAnalysis(text);
  } catch {
    result = { source: 'local', intent: interpretTrip(text), weather: { status: 'unavailable' } };
  } finally {
    analysisRunning = false;
    tripSubmit.disabled = false;
  }
  if (tripInputVersion !== version) return false;
  const intent = result.intent;
  const destination = intent.destination || tripDestination.value.trim();
  if (!destination) {
    document.querySelector('.trip-manual').open = true;
    tripResult.textContent = '还没识别出徒步地点。可以补充具体山峰或路线名。';
    return false;
  }
  const durationPending = !intent.hours;
  const type = intent.type ?? (intent.hours > 12 ? 'overnight' : 'day');
  const options = DURATIONS[type];
  const hours = durationPending ? options[0] : options.find(option => option >= intent.hours) ?? options.at(-1);
  const weatherSignals = result.weather.status === 'ready' ? result.weather.signals : [];
  const lodgingCold = result.weather.lodging?.status === 'ready' && result.weather.lodging.signals.includes('cold');
  updatePlan({ type, hours, context: { ...intent, destination, forecastInput: text, weatherSignals, lodgingCold, durationPending } });
  showWeather(result.weather);
  interpretedText = result.weather.status === 'unavailable' ? '' : text;
  tripResult.textContent = '';
  return true;
}
document.querySelector('.trip-manual').addEventListener('change', event => {
  tripInputVersion++;
  clearWeather();
  tripResult.textContent = '';
  if (event.target === tripDestination) {
    interpretedText = tripInput.value.trim();
    return;
  }
  const text = tripInput.value.trim();
  if (text && text !== interpretedText && tripDestination.value.trim()) {
    const { destination, timing, conditions, lodging } = interpretTrip(text);
    const plan = state.plan;
    updatePlan({ ...plan, context: { destination: tripDestination.value.trim() || destination, timing, conditions,
      lodging: plan.type === 'overnight' ? lodging : null } });
    interpretedText = text;
  }
});
tripDestination.addEventListener('change', () => {
  updatePlan({ ...state.plan, context: { ...state.plan.context, destination: tripDestination.value, forecastInput: '', weatherSignals: [], lodgingCold: false } });
});
document.querySelector('#plan-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (analysisRunning) return;
  if (tripInput.value.trim() && tripInput.value.trim() !== interpretedText && !await applyTripText()) return;
  state.generated = true;
  listFilter = 'all';
  save();
  refresh();
  const recommendation = document.querySelector('#plan-recommendation');
  recommendation.querySelector('.trip-equipment-details').open = true;
  recommendation.focus({ preventScroll: true });
  recommendation.scrollIntoView({ block: 'nearest' });
});
document.querySelector('#checklist-groups').addEventListener('change', event => {
  const checkbox = event.target;
  const id = checkbox.dataset.gearId;
  if (!id || !currentItems().some(item => item.id === id)) return;
  state.prepared = checkbox.checked ? [...new Set([...state.prepared, id])] : state.prepared.filter(known => known !== id);
  save(); renderSummary(); renderLibrary();
  // Keep the active checkbox node for keyboard users in the unfiltered view.
  if (listFilter === 'all') updateProgress();
  else {
    const allRows = [...document.querySelectorAll('[data-gear-id]')];
    const index = allRows.indexOf(checkbox);
    renderChecklist();
    const rows = [...document.querySelectorAll('[data-gear-id]')];
    (rows[Math.min(index, rows.length - 1)] ?? document.querySelector(`[data-filter="${listFilter}"]`)).focus({ preventScroll: true });
  }
});
document.querySelectorAll('[data-filter]').forEach(button => button.addEventListener('click', () => {
  listFilter = button.dataset.filter; renderChecklist();
}));
const categorySelect = document.querySelector('#category-filter');
for (const category of CATEGORIES) { const option = element('option', '', category); option.value = category; categorySelect.append(option); }
categorySelect.addEventListener('change', () => { categoryFilter = categorySelect.value; renderLibrary(); });

const navigation = document.querySelector('.navigation');
const navigationIndicator = navigation?.querySelector('.navigation-indicator');
document.addEventListener('pointermove', event => {
  if (event.pointerType === 'touch') return;
  const panel = event.target.closest?.('.trip-brief, .plan-form, .gear-personal, .catalog-search-hero, .progress-panel, .checklist-group');
  if (!panel) return;
  const bounds = panel.getBoundingClientRect();
  panel.style.setProperty('--spot-x', `${event.clientX - bounds.left}px`);
  panel.style.setProperty('--spot-y', `${event.clientY - bounds.top}px`);
}, { passive: true });
function moveNavigationIndicator() {
  const active = navigation?.querySelector('a[aria-current="page"]');
  if (!active || !navigationIndicator) return;
  const navRect = navigation.getBoundingClientRect();
  const activeRect = active.getBoundingClientRect();
  navigationIndicator.style.setProperty('--nav-x', `${activeRect.left - navRect.left - navigation.clientLeft}px`);
  navigationIndicator.style.setProperty('--nav-y', `${activeRect.top - navRect.top - navigation.clientTop}px`);
  navigationIndicator.style.setProperty('--nav-width', `${activeRect.width}px`);
  navigationIndicator.style.setProperty('--nav-height', `${activeRect.height}px`);
}
window.addEventListener('resize', moveNavigationIndicator, { passive: true });

function route(focus = true) {
  setRuleHelp(false);
  const requested = location.hash.slice(1);
  const view = VIEWS.includes(requested) ? requested : 'explore';
  document.querySelectorAll('.view').forEach(section => { section.hidden = section.id !== `view-${view}`; });
  document.querySelectorAll('.navigation a').forEach(link => {
    if (link.hash === `#${view}`) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current');
  });
  moveNavigationIndicator();
  if (view === 'plan' || view === 'checklist') {
    const slot = document.querySelector(view === 'plan' ? '#plan-weather-slot' : '#checklist-weather-slot');
    if (weatherPanel.parentElement !== slot) slot.append(weatherPanel);
  }
  if (view === 'checklist' && state.generated && weatherPanel.hidden && savedWeatherInput()) {
    weatherPanel.hidden = false;
    weatherRefresh.hidden = false;
    weatherSummary.textContent = '查询路线高点预报';
    if (state.plan.context.startDate) void refreshChecklistWeather();
    else {
      weatherOutput.textContent = `此清单只保存了「${state.plan.context.timing}」。重新查询将按今天换算日期。`;
      weatherPanel.open = true;
    }
  }
  document.title = `山行装箱 · ${{ explore: '探索', plan: '徒步计划', library: '装备库', checklist: '我的清单' }[view]}`;
  if (focus) { document.querySelector(`#${view}-title`).focus({ preventScroll: true }); window.scrollTo(0, 0); }
}
window.addEventListener('hashchange', () => route());
refresh(); route(false);
