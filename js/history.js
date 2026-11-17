/**
 * Исторические данные: снапшоты Fawaz для спарклайнов (7 дней по всем валютам сразу)
 * и ряды для интерактивного графика (Frankfurter / CoinGecko / Fawaz).
 */

import { CRYPTO, FRANKFURTER_CODES } from './currencies.js';
import { fetchFawaz, fetchJSON } from './rates.js';
import { idbGet, idbSet } from './storage.js';

const DAY = 86400000;
const FAWAZ_START = '2024-03-02';
const ECB_START = '1999-01-04';

const isoDate = (ms) => new Date(ms).toISOString().slice(0, 10);
const daysAgo = (n) => isoDate(Date.now() - n * DAY);
const dateToMs = (d) => Date.parse(`${d}T15:00:00Z`); // фиксинг ЕЦБ ≈ 16:00 CET

async function pool(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return out;
}

/* ---------------- Дневные снапшоты Fawaz ---------------- */

const daySnapshots = new Map(); // date → rates | null
const dayPending = new Map();

/** Снапшот курсов к EUR на конкретную дату (кэшируется навсегда — история не меняется). */
export async function getDaySnapshot(date) {
  if (daySnapshots.has(date)) return daySnapshots.get(date);
  if (dayPending.has(date)) return dayPending.get(date);
  const p = (async () => {
    const cached = await idbGet(`day:${date}`);
    if (cached) { daySnapshots.set(date, cached); return cached; }
    try {
      const { rates } = await fetchFawaz(date);
      daySnapshots.set(date, rates);
      idbSet(`day:${date}`, rates);
      return rates;
    } catch {
      daySnapshots.set(date, null); // не повторяем в этой сессии
      return null;
    }
  })();
  dayPending.set(date, p);
  try { return await p; } finally { dayPending.delete(date); }
}

let weekCache = null;

/** Последние 7 дней (без сегодняшнего — его заменяет живой курс). */
export async function loadWeek() {
  const dates = Array.from({ length: 7 }, (_, i) => daysAgo(7 - i));
  const key = dates.join();
  if (weekCache?.key === key) return weekCache.points;
  const snaps = await pool(dates, 7, getDaySnapshot);
  const points = dates.map((d, i) => ({ t: dateToMs(d), rates: snaps[i] })).filter((p) => p.rates);
  weekCache = { key, points };
  return points;
}

/**
 * Значения для спарклайна: цена 1 `code` в `comparator` за 7 дней + текущий курс.
 */
export function sparkValues(week, code, comparator, liveRates) {
  const values = [];
  for (const { rates } of week || []) {
    const a = rates[code];
    const b = rates[comparator];
    if (a && b) values.push(b / a);
  }
  const la = liveRates?.[code];
  const lb = liveRates?.[comparator];
  if (la && lb) values.push(lb / la);
  return values;
}

/* ---------------- Ряды для графика ---------------- */

export const PERIODS = {
  '24h': { label: '24ч', cgDays: 1, fiatDays: 5, step: 1, ttl: 5 * 60e3 },
  '7D': { label: '7Д', cgDays: 7, fiatDays: 7, step: 1, ttl: 30 * 60e3 },
  '1M': { label: '1М', cgDays: 30, fiatDays: 31, step: 1, ttl: 60 * 60e3 },
  '1Y': { label: '1Г', cgDays: 365, fiatDays: 365, step: 7, ttl: 6 * 3600e3 },
  ALL: { label: 'Всё', cgDays: 365, fiatDays: null, step: 14, ttl: 12 * 3600e3 },
};

const cryptoById = new Map(CRYPTO.map((c) => [c.code, c]));
const seriesMemory = new Map();

/** Ряд «цена 1 единицы `code` в EUR» во времени. */
async function seriesEUR(code, period) {
  if (code === 'EUR') return { kind: 'const', value: 1, source: null };
  const cfg = PERIODS[period];
  const crypto = cryptoById.get(code);

  if (crypto) {
    const data = await fetchJSON(
      `https://api.coingecko.com/api/v3/coins/${crypto.cg}/market_chart?vs_currency=eur&days=${cfg.cgDays}`,
      { timeout: 15000 },
    );
    const points = (data.prices || []).filter((p) => Number.isFinite(p[1]) && p[1] > 0);
    if (points.length < 2) throw new Error('Нет данных CoinGecko');
    return { kind: 'points', points, source: 'CoinGecko', limited: period === 'ALL' };
  }

  if (FRANKFURTER_CODES.has(code)) {
    const start = cfg.fiatDays ? daysAgo(cfg.fiatDays) : ECB_START;
    const data = await fetchJSON(`https://api.frankfurter.dev/v1/${start}..?base=EUR&symbols=${code}`, { timeout: 15000 });
    const points = Object.entries(data.rates || {})
      .map(([d, r]) => [dateToMs(d), r[code] ? 1 / r[code] : NaN])
      .filter((p) => Number.isFinite(p[1]))
      .sort((a, b) => a[0] - b[0]);
    if (points.length < 2) throw new Error('Нет данных ЕЦБ');
    return { kind: 'points', points, source: 'ЕЦБ / Frankfurter', daily: true };
  }

  // Остальной фиат и металлы — дневные снапшоты Fawaz с шагом
  const startMs = cfg.fiatDays ? Date.now() - cfg.fiatDays * DAY : Date.parse(FAWAZ_START);
  const dates = [];
  for (let t = Date.now() - DAY; t >= startMs; t -= cfg.step * DAY) dates.push(isoDate(t));
  dates.reverse();
  const snaps = await pool(dates, 6, getDaySnapshot);
  const points = dates
    .map((d, i) => [dateToMs(d), snaps[i]?.[code] ? 1 / snaps[i][code] : NaN])
    .filter((p) => Number.isFinite(p[1]));
  if (points.length < 2) throw new Error('Нет исторических данных');
  return { kind: 'points', points, source: 'Fawazahmed0', daily: true, fawaz: true };
}

async function cachedSeriesEUR(code, period) {
  const key = `series:${code}:${period}`;
  const ttl = PERIODS[period].ttl;
  const mem = seriesMemory.get(key);
  if (mem && Date.now() - mem.ts < ttl) return mem.data;

  const stored = mem || (await idbGet(key));
  if (stored && Date.now() - stored.ts < ttl) {
    seriesMemory.set(key, stored);
    return stored.data;
  }
  try {
    const data = await seriesEUR(code, period);
    const entry = { ts: Date.now(), data };
    seriesMemory.set(key, entry);
    if (data.kind === 'points') idbSet(key, entry);
    return data;
  } catch (err) {
    if (stored) return { ...stored.data, stale: true }; // офлайн — отдаём то, что было
    throw err;
  }
}

function lookup(points, t) {
  // последний элемент с time <= t (бинпоиск); если такого нет — первый
  let lo = 0;
  let hi = points.length - 1;
  if (t < points[0][0]) return points[0][1];
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (points[mid][0] <= t) lo = mid; else hi = mid - 1;
  }
  return points[lo][1];
}

function downsample(points, max = 500) {
  if (points.length <= max) return points;
  const step = points.length / max;
  const out = [];
  for (let i = 0; i < max; i++) out.push(points[Math.floor(i * step)]);
  out.push(points[points.length - 1]);
  return out;
}

/**
 * Ряд курса пары: «1 from = N to».
 * @returns {Promise<{points: [number, number][], sources: string[], notes: string[], stale: boolean}>}
 */
export async function getPairSeries(from, to, period, liveRates, { maxPoints = 500 } = {}) {
  const [a, b] = await Promise.all([cachedSeriesEUR(from, period), cachedSeriesEUR(to, period)]);
  const series = [a, b].filter((s) => s.kind === 'points');
  const notes = [];
  const sources = [...new Set(series.map((s) => s.source))];

  let base;
  if (!series.length) {
    // EUR/EUR — плоская линия
    const now = Date.now();
    base = [now - (PERIODS[period].fiatDays || 365) * DAY, now];
  } else {
    const start = Math.max(...series.map((s) => s.points[0][0]));
    const end = Math.max(...series.map((s) => s.points[s.points.length - 1][0]));
    const densest = series
      .map((s) => s.points.filter((p) => p[0] >= start && p[0] <= end))
      .sort((x, y) => y.length - x.length)[0];
    base = densest.map((p) => p[0]);
  }

  const valueAt = (s, t) => (s.kind === 'const' ? s.value : lookup(s.points, t));
  let points = base.map((t) => [t, valueAt(a, t) / valueAt(b, t)]).filter((p) => Number.isFinite(p[1]));

  // Последняя точка — живой курс
  const lf = liveRates?.[from];
  const lt = liveRates?.[to];
  if (lf && lt && points.length && points[points.length - 1][0] < Date.now() - 30 * 60e3) {
    points.push([Date.now(), lt / lf]);
  }
  points = downsample(points, maxPoints);

  const allDaily = series.length && series.every((s) => s.daily);
  if (period === '24h' && allDaily) notes.push('Внутридневных данных по фиату нет: ЕЦБ публикует курс раз в день — показаны последние фиксинги.');
  if (period === 'ALL' && series.some((s) => s.limited)) notes.push('Для криптовалют бесплатный CoinGecko отдаёт историю только за 1 год.');
  if (period === 'ALL' && series.some((s) => s.fawaz)) notes.push('История по этой паре доступна с марта 2024 года.');
  if (series.some((s) => s.stale)) notes.push('Офлайн: показаны сохранённые данные.');

  return { points, sources, notes, stale: series.some((s) => s.stale) };
}
