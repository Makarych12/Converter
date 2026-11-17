/**
 * Источники курсов (без API-ключей):
 *  - Fawazahmed0 Currency API (jsDelivr CDN, зеркало на Cloudflare Pages) — 300+ кодов: фиат, крипта, металлы
 *  - Frankfurter (ЕЦБ) — официальные курсы ~30 основных валют (перекрывают Fawaz)
 *  - CoinGecko — актуальные цены криптовалют (перекрывают Fawaz)
 *
 * Все курсы хранятся как «единиц валюты за 1 EUR».
 */

import { CRYPTO, CURRENCIES } from './currencies.js';
import { lsGet, lsSet } from './storage.js';

const LS_RATES = 'convector:rates:v1';

export function fawazUrls(date = 'latest', base = 'eur') {
  return [
    `https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@${date}/v1/currencies/${base}.min.json`,
    `https://${date}.currency-api.pages.dev/v1/currencies/${base}.min.json`,
  ];
}

export async function fetchJSON(url, { timeout = 10000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} — ${url}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchFirst(urls, opts) {
  let lastErr;
  for (const url of urls) {
    try { return await fetchJSON(url, opts); } catch (err) { lastErr = err; }
  }
  throw lastErr;
}

/** Fawaz: снапшот всех курсов к EUR на дату (или latest). */
export async function fetchFawaz(date = 'latest') {
  const data = await fetchFirst(fawazUrls(date));
  const rates = {};
  for (const [k, v] of Object.entries(data.eur || {})) {
    const code = k.toUpperCase();
    if (CURRENCIES.has(code) && Number.isFinite(v) && v > 0) rates[code] = v;
  }
  rates.EUR = 1;
  return { date: data.date, rates };
}

async function fetchFrankfurter() {
  const data = await fetchJSON('https://api.frankfurter.dev/v1/latest?base=EUR');
  return { date: data.date, rates: { ...data.rates, EUR: 1 } };
}

async function fetchCoinGecko() {
  const ids = CRYPTO.map((c) => c.cg).join(',');
  const data = await fetchJSON(
    `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=eur&include_24hr_change=true`,
  );
  const rates = {};
  const change24h = {};
  for (const c of CRYPTO) {
    const row = data[c.cg];
    if (row && Number.isFinite(row.eur) && row.eur > 0) {
      rates[c.code] = 1 / row.eur;
      if (Number.isFinite(row.eur_24h_change)) change24h[c.code] = row.eur_24h_change;
    }
  }
  if (!Object.keys(rates).length) throw new Error('CoinGecko вернул пустой ответ');
  return { rates, change24h };
}

/** Мгновенное (синхронное) чтение последних курсов из localStorage. */
export function loadCachedRates() {
  const snap = lsGet(LS_RATES);
  return snap && snap.rates ? snap : null;
}

/**
 * Загружает курсы из всех источников параллельно и сливает их с предыдущим снапшотом,
 * так что недоступность одного источника не «теряет» валюты.
 */
export async function refreshRates(prev = loadCachedRates()) {
  const [fawaz, frank, cg] = await Promise.allSettled([fetchFawaz(), fetchFrankfurter(), fetchCoinGecko()]);
  const ok = (r) => r.status === 'fulfilled';

  if (!ok(fawaz) && !ok(frank) && !ok(cg)) {
    const err = new Error('Все источники курсов недоступны');
    err.causes = [fawaz.reason, frank.reason, cg.reason];
    throw err;
  }

  const rates = {
    ...(prev?.rates || {}),
    ...(ok(fawaz) ? fawaz.value.rates : {}),
    ...(ok(frank) ? frank.value.rates : {}),
    ...(ok(cg) ? cg.value.rates : {}),
    EUR: 1,
  };

  const snapshot = {
    ts: Date.now(),
    rates,
    change24h: ok(cg) ? cg.value.change24h : prev?.change24h || {},
    sources: {
      fawaz: ok(fawaz) ? { ok: true, date: fawaz.value.date } : { ok: false, error: String(fawaz.reason?.message || fawaz.reason) },
      frankfurter: ok(frank) ? { ok: true, date: frank.value.date } : { ok: false, error: String(frank.reason?.message || frank.reason) },
      coingecko: ok(cg) ? { ok: true } : { ok: false, error: String(cg.reason?.message || cg.reason) },
    },
  };

  // Один снапшот — одна сериализация. Дубль в IndexedDB не нужен: localStorage читается синхронно при старте.
  lsSet(LS_RATES, snapshot);
  return snapshot;
}

/** Конвертация через EUR-кросс. */
export function convert(amount, from, to, rates) {
  if (from === to) return amount;
  const rf = rates?.[from];
  const rt = rates?.[to];
  if (!rf || !rt) return NaN;
  return (amount / rf) * rt;
}

/** Курс: сколько `to` в 1 `from`. */
export function rateOf(from, to, rates) {
  return convert(1, from, to, rates);
}
