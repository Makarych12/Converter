/**
 * Справочник активов: фиат (160+), криптовалюты, драгоценные металлы.
 * Названия фиата берутся из Intl.DisplayNames (ru + en), поэтому список остаётся компактным.
 */

// ISO 4217 + распространённые неофициальные коды, доступные в источниках курсов
const FIAT_CODES = (
  'AED AFN ALL AMD ANG AOA ARS AUD AWG AZN BAM BBD BDT BGN BHD BIF BMD BND BOB BRL BSD BTN BWP BYN ' +
  'BZD CAD CDF CHF CLP CNY CNH COP CRC CUC CUP CVE CZK DJF DKK DOP DZD EGP ERN ETB EUR FJD FKP GBP GEL ' +
  'GGP GHS GIP GMD GNF GTQ GYD HKD HNL HRK HTG HUF IDR ILS IMP INR IQD IRR ISK JEP JMD JOD JPY KES KGS ' +
  'KHR KMF KPW KRW KWD KYD KZT LAK LBP LKR LRD LSL LYD MAD MDL MGA MKD MMK MNT MOP MRU MUR MVR MWK MXN ' +
  'MYR MZN NAD NGN NIO NOK NPR NZD OMR PAB PEN PGK PHP PKR PLN PYG QAR RON RSD RUB RWF SAR SBD SCR SDG ' +
  'SEK SGD SHP SLE SLL SOS SRD SSP STN SVC SYP SZL THB TJS TMT TND TOP TRY TTD TVD TWD TZS UAH UGX USD ' +
  'UYU UZS VES VND VUV WST XAF XCD XCG XOF XPF YER ZAR ZMW ZWG ZWL'
).split(' ');

// Валюта → регион флага (если не совпадает с первыми двумя буквами кода)
const FLAG_OVERRIDES = {
  EUR: 'EU', XAF: 'CM', XOF: 'SN', XCD: 'AG', XPF: 'PF', ANG: 'CW', XCG: 'CW', CNH: 'CN',
};

// Названия, которых нет в Intl или которые там неудачные
const NAME_OVERRIDES = {
  CNH: { ru: 'Офшорный юань', en: 'Chinese Yuan (Offshore)' },
  GGP: { ru: 'Гернсийский фунт', en: 'Guernsey Pound' },
  IMP: { ru: 'Мэнский фунт', en: 'Manx Pound' },
  JEP: { ru: 'Джерсийский фунт', en: 'Jersey Pound' },
  TVD: { ru: 'Доллар Тувалу', en: 'Tuvaluan Dollar' },
  XCG: { ru: 'Карибский гульден', en: 'Caribbean Guilder' },
  ZWG: { ru: 'Зимбабвийский золотой', en: 'Zimbabwe Gold' },
};

// Народные названия и синонимы для поиска
const ALIASES = {
  USD: 'доллар бакс сша америка usa dollar buck',
  EUR: 'евро европа euro europe',
  RUB: 'рубль россия рф russia ruble',
  GBP: 'фунт стерлинг британия англия великобритания uk pound',
  CNY: 'юань жэньминьби китай china yuan rmb',
  JPY: 'иена йена япония japan yen',
  KZT: 'тенге казахстан',
  UAH: 'гривна украина',
  BYN: 'белорусский рубль беларусь',
  CHF: 'франк швейцария',
  TRY: 'лира турция',
  AED: 'дирхам оаэ эмираты дубай uae',
  GEL: 'лари грузия',
  AMD: 'драм армения',
  AZN: 'манат азербайджан',
  UZS: 'сум узбекистан',
  KGS: 'сом киргизия кыргызстан',
  TJS: 'сомони таджикистан',
  INR: 'рупия индия',
  THB: 'бат таиланд тайланд',
  VND: 'донг вьетнам',
  KRW: 'вона корея',
  BGN: 'лев болгария',
  PLN: 'злотый польша',
  CZK: 'крона чехия',
  ILS: 'шекель израиль',
  EGP: 'египетский фунт египет',
  RSD: 'динар сербия',
  MDL: 'лей молдова',
  CAD: 'канада канадский',
  AUD: 'австралия австралийский',
  BRL: 'реал бразилия',
  MXN: 'песо мексика',
};

export const CRYPTO = [
  { code: 'BTC',  cg: 'bitcoin',                 ru: 'Биткоин',        en: 'Bitcoin',          sym: '₿', color: '#f7931a', alias: 'биток bitcoin' },
  { code: 'ETH',  cg: 'ethereum',                ru: 'Эфириум',        en: 'Ethereum',         sym: 'Ξ', color: '#627eea', alias: 'эфир ether' },
  { code: 'USDT', cg: 'tether',                  ru: 'Tether',         en: 'Tether',           sym: '₮', color: '#26a17b', alias: 'тезер тетер стейблкоин stablecoin' },
  { code: 'USDC', cg: 'usd-coin',                ru: 'USD Coin',       en: 'USD Coin',         sym: '$', color: '#2775ca', alias: 'стейблкоин stablecoin' },
  { code: 'BNB',  cg: 'binancecoin',             ru: 'BNB',            en: 'BNB',              sym: 'B', color: '#f3ba2f', alias: 'бинанс binance' },
  { code: 'SOL',  cg: 'solana',                  ru: 'Солана',         en: 'Solana',           sym: '◎', color: '#9945ff', alias: '' },
  { code: 'XRP',  cg: 'ripple',                  ru: 'XRP',            en: 'XRP',              sym: '✕', color: '#5d6a7b', alias: 'рипл ripple' },
  { code: 'TON',  cg: 'the-open-network',        ru: 'Toncoin',        en: 'Toncoin',          sym: '◆', color: '#0098ea', alias: 'тон телеграм telegram' },
  { code: 'DOGE', cg: 'dogecoin',                ru: 'Догикоин',       en: 'Dogecoin',         sym: 'Ð', color: '#c2a633', alias: 'доги' },
  { code: 'ADA',  cg: 'cardano',                 ru: 'Кардано',        en: 'Cardano',          sym: '₳', color: '#3468d1', alias: '' },
  { code: 'TRX',  cg: 'tron',                    ru: 'TRON',           en: 'TRON',             sym: 'T', color: '#ef0027', alias: 'трон' },
  { code: 'LTC',  cg: 'litecoin',                ru: 'Лайткоин',       en: 'Litecoin',         sym: 'Ł', color: '#345d9d', alias: '' },
  { code: 'DOT',  cg: 'polkadot',                ru: 'Polkadot',       en: 'Polkadot',         sym: '●', color: '#e6007a', alias: 'полкадот' },
  { code: 'AVAX', cg: 'avalanche-2',             ru: 'Avalanche',      en: 'Avalanche',        sym: 'A', color: '#e84142', alias: 'аваланч' },
  { code: 'LINK', cg: 'chainlink',               ru: 'Chainlink',      en: 'Chainlink',        sym: '⬡', color: '#2a5ada', alias: 'чейнлинк' },
  { code: 'XLM',  cg: 'stellar',                 ru: 'Stellar',        en: 'Stellar',          sym: '*', color: '#3d4a5c', alias: 'стеллар' },
  { code: 'BCH',  cg: 'bitcoin-cash',            ru: 'Bitcoin Cash',   en: 'Bitcoin Cash',     sym: 'Ƀ', color: '#8dc351', alias: 'биткоин кэш' },
  { code: 'SHIB', cg: 'shiba-inu',               ru: 'Shiba Inu',      en: 'Shiba Inu',        sym: 'S', color: '#f00500', alias: 'шиба' },
  { code: 'DAI',  cg: 'dai',                     ru: 'Dai',            en: 'Dai',              sym: '◈', color: '#f5ac37', alias: 'стейблкоин stablecoin' },
  { code: 'XMR',  cg: 'monero',                  ru: 'Monero',         en: 'Monero',           sym: 'ɱ', color: '#ff6600', alias: 'монеро' },
  { code: 'ATOM', cg: 'cosmos',                  ru: 'Cosmos',         en: 'Cosmos',           sym: '⚛', color: '#2e3148', alias: 'космос' },
  { code: 'NEAR', cg: 'near',                    ru: 'NEAR',           en: 'NEAR Protocol',    sym: 'N', color: '#00c08b', alias: 'неар' },
  { code: 'UNI',  cg: 'uniswap',                 ru: 'Uniswap',        en: 'Uniswap',          sym: '🦄', color: '#ff007a', alias: 'юнисвап' },
  { code: 'SUI',  cg: 'sui',                     ru: 'Sui',            en: 'Sui',              sym: 'S', color: '#4da2ff', alias: '' },
  { code: 'PEPE', cg: 'pepe',                    ru: 'Pepe',           en: 'Pepe',             sym: 'P', color: '#4c9540', alias: 'пепе' },
  { code: 'POL',  cg: 'polygon-ecosystem-token', ru: 'Polygon',        en: 'Polygon (POL)',    sym: '⬢', color: '#8247e5', alias: 'полигон matic матик' },
  { code: 'ETC',  cg: 'ethereum-classic',        ru: 'Ethereum Classic', en: 'Ethereum Classic', sym: 'ξ', color: '#3ab83a', alias: 'эфир классик' },
  { code: 'PAXG', cg: 'pax-gold',                ru: 'PAX Gold',       en: 'PAX Gold',         sym: 'Au', color: '#e4ce4d', alias: 'токен золото gold' },
  { code: 'XAUT', cg: 'tether-gold',             ru: 'Tether Gold',    en: 'Tether Gold',      sym: 'Au', color: '#d4af37', alias: 'токен золото gold' },
];

export const METALS = [
  { code: 'XAU', ru: 'Золото',   en: 'Gold',      sym: 'Au', color: '#e3b341', alias: 'gold голд' },
  { code: 'XAG', ru: 'Серебро',  en: 'Silver',    sym: 'Ag', color: '#b8c0cc', alias: 'silver' },
  { code: 'XPT', ru: 'Платина',  en: 'Platinum',  sym: 'Pt', color: '#8fa3b5', alias: 'platinum' },
  { code: 'XPD', ru: 'Палладий', en: 'Palladium', sym: 'Pd', color: '#a59b8e', alias: 'palladium' },
];

// Порядок популярности для пустого поиска
export const POPULAR = [
  'USD', 'EUR', 'RUB', 'GBP', 'CNY', 'JPY', 'CHF', 'KZT', 'UAH', 'BYN', 'TRY', 'AED', 'GEL', 'AMD',
  'BTC', 'ETH', 'USDT', 'TON', 'XAU', 'XAG', 'BGN', 'PLN', 'CZK', 'CAD', 'AUD', 'INR', 'THB', 'KRW',
];

export const FRANKFURTER_CODES = new Set(
  'AUD BRL CAD CHF CNY CZK DKK EUR GBP HKD HUF IDR ILS INR ISK JPY KRW MXN MYR NOK NZD PHP PLN RON SEK SGD THB TRY USD ZAR'.split(' ')
);

function safeDisplayNames(locale, type) {
  try { return new Intl.DisplayNames([locale], { type }); } catch { return null; }
}

const dnCurRu = safeDisplayNames('ru', 'currency');
const dnCurEn = safeDisplayNames('en', 'currency');
const dnRegRu = safeDisplayNames('ru', 'region');
const dnRegEn = safeDisplayNames('en', 'region');

function displayName(dn, code) {
  if (!dn) return '';
  try {
    const name = dn.of(code);
    return name && name !== code ? name : '';
  } catch { return ''; }
}

function capitalize(s) {
  return s ? s.charAt(0).toLocaleUpperCase('ru') + s.slice(1) : s;
}

function flagEmoji(region) {
  if (!/^[A-Z]{2}$/.test(region)) return '';
  return String.fromCodePoint(...[...region].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}

function currencySymbols(code) {
  const out = new Set();
  for (const locale of ['ru-RU', 'en-US']) {
    for (const display of ['narrowSymbol', 'symbol']) {
      try {
        const part = new Intl.NumberFormat(locale, { style: 'currency', currency: code, currencyDisplay: display })
          .formatToParts(1)
          .find((p) => p.type === 'currency');
        if (part && part.value && part.value.toUpperCase() !== code) out.add(part.value);
      } catch { /* неизвестная валюта */ }
    }
  }
  return [...out];
}

function buildFiat(code) {
  const region = FLAG_OVERRIDES[code] || code.slice(0, 2);
  const override = NAME_OVERRIDES[code];
  const ru = override?.ru || capitalize(displayName(dnCurRu, code)) || code;
  const en = override?.en || displayName(dnCurEn, code) || code;
  const symbols = currencySymbols(code);
  // Самый «узнаваемый» символ — самый короткий
  const sym = symbols.slice().sort((a, b) => a.length - b.length)[0] || '';
  const regionNames = [displayName(dnRegRu, region), displayName(dnRegEn, region)].filter(Boolean);
  return {
    code, kind: 'fiat', ru, en, sym, symbols, region,
    flag: flagEmoji(region),
    search: [code, ru, en, ...symbols, ...regionNames, ALIASES[code] || ''].join(' ').toLocaleLowerCase('ru'),
  };
}

function buildOther(item, kind) {
  return {
    ...item, kind, symbols: [item.sym], flag: '',
    search: [item.code, item.ru, item.en, item.sym, item.alias || '', kind === 'metal' ? 'металл metal' : 'крипта криптовалюта crypto']
      .join(' ').toLocaleLowerCase('ru'),
  };
}

/** @type {Map<string, any>} */
export const CURRENCIES = new Map();
for (const code of FIAT_CODES) CURRENCIES.set(code, buildFiat(code));
for (const c of CRYPTO) CURRENCIES.set(c.code, buildOther(c, 'crypto'));
for (const m of METALS) CURRENCIES.set(m.code, buildOther(m, 'metal'));

export function getCurrency(code) {
  return CURRENCIES.get(String(code || '').toUpperCase()) || null;
}

const popularRank = new Map(POPULAR.map((c, i) => [c, i]));

/**
 * Поиск по ISO-коду, названию (ru/en), символу, флагу и стране.
 * @param {string} query
 * @param {'all'|'fiat'|'crypto'|'metal'} kind
 */
export function searchCurrencies(query, kind = 'all') {
  const raw = String(query || '').trim();
  const q = raw.toLocaleLowerCase('ru');
  const qUpper = raw.toUpperCase();
  const results = [];

  for (const cur of CURRENCIES.values()) {
    if (kind !== 'all' && cur.kind !== kind) continue;
    let score = 0;
    if (!q) {
      score = 1;
    } else if (cur.code === qUpper) {
      score = 100;
    } else if (cur.flag && raw.includes(cur.flag)) {
      score = 95;
    } else if (cur.symbols.includes(raw)) {
      score = 90;
    } else if (cur.code.startsWith(qUpper)) {
      score = 80;
    } else if (cur.search.split(/[\s,()-]+/).some((w) => w.startsWith(q))) {
      score = 60;
    } else if (cur.search.includes(q)) {
      score = 40;
    }
    if (score > 0) results.push({ cur, score });
  }

  results.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const ra = popularRank.has(a.cur.code) ? popularRank.get(a.cur.code) : 1e3;
    const rb = popularRank.has(b.cur.code) ? popularRank.get(b.cur.code) : 1e3;
    if (ra !== rb) return ra - rb;
    return a.cur.code.localeCompare(b.cur.code);
  });
  return results.map((r) => r.cur);
}

export const KIND_LABELS = { fiat: 'Фиат', crypto: 'Крипта', metal: 'Металлы' };
