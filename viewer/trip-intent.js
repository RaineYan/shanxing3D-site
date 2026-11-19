const numberWords = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
const quantity = '[0-9]{1,3}|十[一二两三四五六七八九]?|[二三四五六七八九]十[一二两三四五六七八九]?|[一二两三四五六七八九]';
const conditionWords = {
  rain: /(?:会下雨|有雨|下雨|降雨|雨天|小雨|中雨|大雨)/,
  cold: /(?:低温|很冷|夜里冷|零下|气温低)/,
  wind: /(?:大风|风大|强风)/,
  noSupply: /(?:无补给|没有补给|没补给|不确定.*补给)/,
};

function numberOf(value) {
  if (/^\d+$/.test(value)) return Number(value);
  if (!value.includes('十')) return numberWords[value];
  const [tens, units] = value.split('十');
  return (numberWords[tens] ?? 1) * 10 + (numberWords[units] ?? 0);
}

export function normalizeTripContext(value) {
  return {
    destination: typeof value?.destination === 'string' ? value.destination.trim().slice(0, 60) : '',
    timing: typeof value?.timing === 'string' ? value.timing.trim().slice(0, 24) : '',
    startDate: typeof value?.startDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.startDate) ? value.startDate : '',
    forecastInput: typeof value?.forecastInput === 'string' ? value.forecastInput.trim().slice(0, 480) : '',
    lodgingCold: value?.lodgingCold === true,
    durationPending: value?.durationPending === true,
    hours: Number.isInteger(value?.hours) && value.hours > 0 && value.hours <= 168 ? value.hours : null,
    lodging: ['camp', 'indoors'].includes(value?.lodging) ? value.lodging : null,
    weatherSignals: [...new Set(Array.isArray(value?.weatherSignals) ? value.weatherSignals.filter(key => ['rain', 'cold', 'wind'].includes(key)) : [])],
    conditions: [...new Set(Array.isArray(value?.conditions) ? value.conditions.filter(key => Object.hasOwn(conditionWords, key)) : [])],
  };
}

export function interpretTrip(input) {
  const text = input.trim();
  const destination = text.match(/(?:前往|想去|要去|去|到|攀登|爬)\s*([\p{Script=Han}A-Za-z·]{2,24}?)(?=徒步|登山|爬山|露营|玩|走|住|[，。；、,\s]|[\d一二两三四五六七八九十]+(?:天|小时)|$)/u)?.[1] ?? '';
  const timing = text.match(/(?:\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}月\d{1,2}[日号]|(?:这|本|下)?周[一二三四五六日天末]|明天|后天|今天)/)?.[0] ?? '';
  const days = text.match(new RegExp(`(${quantity})\\s*(?:天|日游|日徒步)`));
  const hours = text.match(new RegExp(`(${quantity})\\s*(?:个)?小时`));
  const lodging = /住(?:酒店|民宿|山屋|客栈)|不露营/.test(text) ? 'indoors' : /露营|扎营|住帐篷/.test(text) ? 'camp' : null;
  const conditions = Object.entries(conditionWords).filter(([, pattern]) => pattern.test(text.replace(/(?:不会|不|没有)(?:下雨|降雨|有雨|冷|刮大风)/g, ''))).map(([key]) => key);
  const dayCount = days ? numberOf(days[1]) : 0;
  const exactHours = dayCount > 1 ? dayCount * 24 : hours ? numberOf(hours[1]) : null;
  const type = dayCount > 1 || /过夜|两日|一晚/.test(text) || lodging ? 'overnight'
    : dayCount === 1 || /当天往返|当天回|一日徒步/.test(text) || (exactHours && exactHours <= 12) ? 'day' : null;
  return { type, ...normalizeTripContext({ destination, timing, hours: exactHours, lodging, conditions }) };
}
