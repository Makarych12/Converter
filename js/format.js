/**
 * Форматирование чисел: «красивое» для экрана (ru-RU) и «чистое» для буфера обмена (195.58).
 */

export const DISPLAY_LOCALE = 'ru-RU';

const digitsCache = new Map();
const nfCache = new Map();

/** Количество знаков после запятой по ISO 4217 (JPY → 0, KWD → 3, остальные → 2). */
export function currencyDigits(code) {
  if (digitsCache.has(code)) return digitsCache.get(code);
  let d = 2;
  try {
    d = new Intl.NumberFormat('en', { style: 'currency', currency: code }).resolvedOptions().maximumFractionDigits;
  } catch { /* не-ISO код */ }
  digitsCache.set(code, d);
  return d;
}

function magnitudeDecimals(a, significant) {
  // Сколько знаков нужно, чтобы показать `significant` значащих цифр числа < 1
  return Math.min(12, Math.max(0, Math.ceil(-Math.log10(a)) + significant - 1));
}

/**
 * Точность отображения суммы.
 * @param {number} value
 * @param {{kind: string, code: string}} cur
 * @returns {{min: number, max: number}}
 */
export function amountPrecision(value, cur) {
  const a = Math.abs(value);
  const kind = cur?.kind || 'fiat';
  if (kind === 'fiat') {
    const d = currencyDigits(cur?.code || 'USD');
    if (!Number.isFinite(a) || a === 0 || a >= 1) return { min: d, max: d };
    return { min: d, max: Math.max(d, magnitudeDecimals(a, 3)) };
  }
  if (!Number.isFinite(a) || a === 0) return { min: 2, max: 2 };
  if (a >= 1000) return { min: 2, max: 2 };
  if (a >= 1) return { min: 2, max: 4 };
  return { min: 2, max: Math.max(2, magnitudeDecimals(a, 4)) };
}

/** Точность для курса (1 EUR = 1.9558 BGN). */
export function ratePrecision(rate) {
  const a = Math.abs(rate);
  if (!Number.isFinite(a) || a === 0) return { min: 2, max: 2 };
  if (a >= 100) return { min: 2, max: 2 };
  if (a >= 1) return { min: 4, max: 4 };
  return { min: 2, max: Math.max(4, magnitudeDecimals(a, 4)) };
}

function nf(min, max, grouping = true) {
  const key = `${min}|${max}|${grouping}`;
  let f = nfCache.get(key);
  if (!f) {
    f = new Intl.NumberFormat(DISPLAY_LOCALE, { minimumFractionDigits: min, maximumFractionDigits: max, useGrouping: grouping });
    nfCache.set(key, f);
  }
  return f;
}

/** Число в виде «1 234,56» для экрана. */
export function formatNumber(value, { min, max }) {
  if (!Number.isFinite(value)) return '—';
  return nf(min, max).format(value);
}

/** Число в «чистом» виде для буфера и URL: точка, без разрядов, без экспоненты. */
export function plainNumber(value, { min, max }) {
  if (!Number.isFinite(value)) return '';
  let s = value.toFixed(max);
  if (max > min && s.includes('.')) {
    // обрезаем незначащие нули до `min` знаков
    const [int, frac] = s.split('.');
    let f = frac.replace(/0+$/, '');
    if (f.length < min) f = f.padEnd(min, '0');
    s = f ? `${int}.${f}` : int;
  }
  if (/^-0(\.0+)?$/.test(s)) s = s.slice(1);
  return s;
}

export const formatAmount = (value, cur) => formatNumber(value, amountPrecision(value, cur));
export const plainAmount = (value, cur) => plainNumber(value, amountPrecision(value, cur));
export const formatRate = (rate) => formatNumber(rate, ratePrecision(rate));
export const plainRate = (rate) => plainNumber(rate, ratePrecision(rate));

/** Сумма, которую ввёл пользователь, — без принудительных нулей (100, а не 100,00). */
export function formatInput(value, cur) {
  const p = amountPrecision(value, cur);
  return formatNumber(value, { min: 0, max: p.max });
}

export function formatPercent(p) {
  if (!Number.isFinite(p)) return '—';
  const s = nf(2, 2).format(Math.abs(p));
  return `${p > 0 ? '+' : p < 0 ? '−' : ''}${s}%`;
}

const timeFmt = new Intl.DateTimeFormat(DISPLAY_LOCALE, { hour: '2-digit', minute: '2-digit' });
const dateTimeFmt = new Intl.DateTimeFormat(DISPLAY_LOCALE, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

export function formatUpdated(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const sameDay = new Date().toDateString() === d.toDateString();
  return sameDay ? timeFmt.format(d) : dateTimeFmt.format(d);
}
