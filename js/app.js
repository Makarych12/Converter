import { evaluate } from './parser.js';
import { getCurrency, searchCurrencies, KIND_LABELS } from './currencies.js';
import {
  formatAmount, plainAmount, formatRate, plainRate, formatInput, formatPercent, formatUpdated,
  amountPrecision, plainNumber, formatNumber, DISPLAY_LOCALE,
} from './format.js';
import { loadCachedRates, refreshRates, convert, rateOf } from './rates.js';
import { loadWeek, sparkValues, getPairSeries, PERIODS } from './history.js';
import { sparklineSVG, LineChart } from './charts.js';
import { copyToClipboard, showToast, ICON_COPY } from './clipboard.js';
import { lsGet, lsSet } from './storage.js';

/* ============================ Состояние ============================ */

const LS_STATE = 'convector:state:v1';
const DEFAULT_LIST = ['EUR', 'USD', 'BGN', 'GBP', 'RUB', 'KZT', 'BTC', 'XAU'];
const AUTO_REFRESH_MS = 5 * 60e3;
const MIN_CARDS = 2;

const COPY_FORMATS = [
  { id: 'number', label: 'Число' },
  { id: 'pair', label: 'Число + валюта' },
  { id: 'full', label: 'Полное выражение' },
  { id: 'link', label: 'Прямая ссылка' },
  { id: 'grid', label: 'Вся сетка' },
];

const $ = (sel, root = document) => root.querySelector(sel);
const valid = (code) => !!getCurrency(code);
const up = (s) => String(s || '').trim().toUpperCase();

function loadState() {
  const saved = lsGet(LS_STATE, {});
  const s = {
    list: DEFAULT_LIST.slice(),
    from: 'EUR',
    to: 'BGN',
    amount: 100,
    text: '100',
    copyFormat: 'full',
    period: '7D',
    theme: 'system',
    ...saved,
  };
  s.list = (Array.isArray(s.list) ? s.list : DEFAULT_LIST).map(up).filter(valid);

  // URL имеет приоритет: ?amount=100&from=EUR&to=BGN[&list=EUR,USD,…]
  const params = new URLSearchParams(location.search);
  if (params.has('list')) {
    const list = params.get('list').split(',').map(up).filter(valid);
    if (list.length) s.list = list;
  }
  if (valid(up(params.get('from')))) s.from = up(params.get('from'));
  if (valid(up(params.get('to')))) s.to = up(params.get('to'));
  if (params.has('amount')) {
    const r = evaluate(params.get('amount'));
    if (r.ok) { s.amount = r.value; s.text = ''; }
  }

  if (!valid(s.from)) s.from = 'EUR';
  if (!valid(s.to) || s.to === s.from) s.to = s.from === 'USD' ? 'EUR' : 'USD';
  // пользовательский порядок сохраняется, from/to гарантированно попадают в сетку
  s.list = [...new Set([...s.list, s.from, s.to])];
  if (!Number.isFinite(s.amount)) s.amount = 100;
  if (!s.text) s.text = formatInput(s.amount, getCurrency(s.from));
  if (!PERIODS[s.period]) s.period = '7D';
  if (!COPY_FORMATS.some((f) => f.id === s.copyFormat)) s.copyFormat = 'full';
  return s;
}

const state = loadState();
let snapshot = loadCachedRates();
let rates = snapshot?.rates || {};
let week = null;
let loading = false;
let lastError = null;

let saveTimer = 0;
function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const { list, from, to, amount, text, copyFormat, period, theme } = state;
    lsSet(LS_STATE, { list, from, to, amount, text, copyFormat, period, theme });
    history.replaceState(null, '', `${location.pathname}${queryString(true)}${location.hash}`);
  }, 250);
}

function sourcePlain() {
  return plainNumber(state.amount, { min: 0, max: amountPrecision(state.amount, getCurrency(state.from)).max });
}

function queryString(withList) {
  let q = `?amount=${sourcePlain()}&from=${state.from}&to=${state.to}`;
  if (withList) q += `&list=${state.list.join(',')}`;
  return q;
}

const shareLink = () => `${location.origin}${location.pathname}${queryString(false)}`;
const valueIn = (code) => convert(state.amount, state.from, code, rates);

/* ============================ Разметка ============================ */

function badgeHTML(cur, size = '') {
  if (!cur) return '';
  if (cur.kind === 'fiat') {
    return `<span class="badge badge--flag ${size}" aria-hidden="true">${cur.flag || cur.code.slice(0, 2)}</span>`;
  }
  return `<span class="badge badge--token ${size}" style="--c:${cur.color}" aria-hidden="true">${cur.sym}</span>`;
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ============================ Сетка карточек ============================ */

const grid = $('#grid');
/** @type {Map<string, {root: HTMLElement, input: HTMLInputElement, preview: HTMLElement, rate: HTMLElement, spark: HTMLElement, change: HTMLElement, role: HTMLElement, sparkKey?: string}>} */
const cards = new Map();
let editing = null; // код карточки в фокусе или 'main'

function createCard(code) {
  const cur = getCurrency(code);
  const root = document.createElement('article');
  root.className = 'card panel';
  root.dataset.code = code;
  root.innerHTML = `
    <div class="card__head">
      <button class="card__select" type="button" title="Сделать целью конвертации">
        ${badgeHTML(cur)}
        <span class="card__title"><strong>${code}</strong><span>${esc(cur.ru)}</span></span>
      </button>
      <span class="card__role"></span>
      <button class="icon-btn icon-btn--sm card__remove" type="button" aria-label="Убрать ${code}" title="Убрать">
        <svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7L7 17"/></svg>
      </button>
    </div>
    <div class="card__value">
      <input class="card__input" type="text" inputmode="decimal" autocomplete="off" spellcheck="false"
             enterkeyhint="done" placeholder="0" aria-label="Сумма в ${code}">
      ${cur.sym ? `<span class="card__sym">${esc(cur.sym)}</span>` : ''}
      <button class="copy-btn" type="button" aria-label="Скопировать сумму в ${code}" title="Скопировать число">${ICON_COPY}<span class="copy-label">Копировать</span></button>
    </div>
    <div class="card__preview"></div>
    <div class="card__foot">
      <span class="card__rate"></span>
      <span class="card__trend"><span class="card__spark"></span><span class="card__change"></span></span>
    </div>`;

  const entry = {
    root,
    input: $('.card__input', root),
    preview: $('.card__preview', root),
    rate: $('.card__rate', root),
    spark: $('.card__spark', root),
    change: $('.card__change', root),
    role: $('.card__role', root),
  };

  entry.input.addEventListener('focus', () => {
    editing = code;
    requestAnimationFrame(() => entry.input.select());
  });
  entry.input.addEventListener('input', () => onSourceInput(code, entry.input.value, entry.preview));
  entry.input.addEventListener('blur', () => commitInput(code, entry.input, entry.preview));
  entry.input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') entry.input.blur();
    if (e.key === 'Escape') { entry.input.value = state.from === code ? state.text : entry.input.value; entry.input.blur(); }
  });

  $('.copy-btn', root).addEventListener('click', (e) => {
    const v = valueIn(code);
    if (!Number.isFinite(v)) { showToast(`Курс ${code} пока недоступен`, 'error'); return; }
    copyToClipboard(plainAmount(v, cur), e.currentTarget);
  });
  $('.card__remove', root).addEventListener('click', () => removeCurrency(code));
  $('.card__select', root).addEventListener('click', () => setTarget(code));

  cards.set(code, entry);
  return entry;
}

function renderGrid() {
  for (const [code, entry] of cards) {
    if (!state.list.includes(code)) { entry.root.remove(); cards.delete(code); }
  }
  const frag = document.createDocumentFragment();
  for (const code of state.list) frag.append((cards.get(code) || createCard(code)).root);
  frag.append(addTile);
  grid.append(frag);
  $('#grid-count').textContent = state.list.length;
  updateAll();
}

const addTile = document.createElement('button');
addTile.type = 'button';
addTile.className = 'card card--add';
addTile.innerHTML = `<span class="card--add__plus" aria-hidden="true">+</span><span>Добавить валюту</span><kbd>/</kbd>`;
addTile.addEventListener('click', () => openPicker('add'));

function updateCards() {
  for (const [code, entry] of cards) {
    const cur = getCurrency(code);
    const isFrom = code === state.from;
    entry.root.classList.toggle('is-from', isFrom);
    entry.root.classList.toggle('is-to', code === state.to);
    entry.role.textContent = isFrom ? 'Источник' : code === state.to ? 'Цель' : '';
    entry.root.classList.toggle('is-missing', !rates[code]);

    if (editing !== code) {
      if (isFrom) {
        entry.input.value = state.text;
      } else {
        const v = valueIn(code);
        entry.input.value = state.text.trim() === '' ? '' : Number.isFinite(v) ? formatAmount(v, cur) : '';
        entry.input.placeholder = Number.isFinite(v) ? '0' : '—';
      }
    }

    // Курс в карточке: показываем «крупное» направление, чтобы не было 0,0000171
    if (isFrom) {
      entry.rate.textContent = 'Исходная сумма';
    } else {
      const r = rateOf(state.from, code, rates);
      if (!Number.isFinite(r)) entry.rate.textContent = 'Нет курса';
      else if (r < 0.01) entry.rate.textContent = `1 ${code} = ${formatRate(1 / r)} ${state.from}`;
      else entry.rate.textContent = `1 ${state.from} = ${formatRate(r)} ${code}`;
    }

    // Спарклайн: цена 1 единицы карточки в исходной валюте за 7 дней
    const comparator = isFrom ? (code === 'USD' ? 'EUR' : 'USD') : state.from;
    const key = `${comparator}|${snapshot?.ts}|${week ? week.length : 0}`;
    if (entry.sparkKey !== key) {
      entry.sparkKey = key;
      const values = week ? sparkValues(week, code, comparator, rates) : [];
      entry.spark.innerHTML = sparklineSVG(values);
      const ch = values.length > 1 ? (values[values.length - 1] / values[0] - 1) * 100 : NaN;
      entry.change.textContent = Number.isFinite(ch) ? `7д ${formatPercent(ch)}` : week ? '' : '…';
      entry.change.className = `card__change ${ch > 0.005 ? 'is-up' : ch < -0.005 ? 'is-down' : ''}`;
      entry.spark.title = `Курс 1 ${code} в ${comparator} за 7 дней`;
    }
  }
}

/* ============================ Главная панель ============================ */

const amountInput = $('#amount');
const amountPreview = $('#amount-preview');

function pillHTML(code) {
  const cur = getCurrency(code);
  return `${badgeHTML(cur, 'badge--lg')}<span class="cur-pill__text"><strong>${code}</strong><span>${esc(cur.ru)}</span></span>
    <svg class="icon cur-pill__caret" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>`;
}

function updateMain() {
  $('#from-pill').innerHTML = pillHTML(state.from);
  $('#to-pill').innerHTML = pillHTML(state.to);
  if (editing !== 'main') amountInput.value = state.text;

  const toCur = getCurrency(state.to);
  const v = valueIn(state.to);
  const result = $('#result');
  if (state.text.trim() === '') {
    result.innerHTML = '<span class="result__value is-empty">0</span>';
  } else if (Number.isFinite(v)) {
    result.innerHTML = `<span class="result__value">${formatAmount(v, toCur)}</span><span class="result__code">${toCur.sym && toCur.sym.length <= 2 ? esc(toCur.sym) : state.to}</span>`;
  } else {
    result.innerHTML = '<span class="result__value is-empty">—</span>';
  }

  const r = rateOf(state.from, state.to, rates);
  $('#rate-line').textContent = Number.isFinite(r)
    ? `1 ${state.from} = ${formatRate(r)} ${state.to}  ·  1 ${state.to} = ${formatRate(1 / r)} ${state.from}`
    : snapshot ? 'Курс для этой пары недоступен' : 'Загружаем курсы…';

  renderCopyMain();
}

function setPreview(el, res, code) {
  el.classList.remove('is-error');
  if (res.ok && res.isExpression) {
    el.textContent = `= ${formatInput(res.value, getCurrency(code))}`;
  } else if (!res.ok && !res.empty) {
    el.textContent = res.error;
    el.classList.add('is-error');
  } else {
    el.textContent = '';
  }
}

/** Ввод в любой карточке или в главном поле: карточка становится источником. */
function onSourceInput(code, text, previewEl) {
  const res = evaluate(text);
  let pairChanged = false;
  if (code !== state.from) {
    if (code === state.to) state.to = state.from;
    state.from = code;
    pairChanged = true;
  }
  state.text = text;
  if (res.ok) state.amount = res.value;
  else if (res.empty) state.amount = 0;
  setPreview(previewEl, res, code);
  if (previewEl !== amountPreview) setPreview(amountPreview, res, code);

  updateAll();
  persist();
  if (pairChanged) loadChart();
}

function commitInput(code, input, previewEl) {
  if (editing === code) editing = null;
  const res = evaluate(input.value);
  if (state.from === code || code === 'main') {
    if (res.ok) {
      // «100*2» → «200»: выражение сворачивается в результат
      if (res.isExpression) state.text = formatInput(res.value, getCurrency(state.from));
    } else if (!res.empty) {
      state.text = formatInput(state.amount, getCurrency(state.from)); // откат к последнему корректному
    }
  }
  previewEl.textContent = '';
  previewEl.classList.remove('is-error');
  amountPreview.textContent = '';
  updateAll();
  persist();
}

amountInput.addEventListener('focus', () => { editing = 'main'; });
amountInput.addEventListener('input', () => onSourceInput(state.from, amountInput.value, amountPreview));
amountInput.addEventListener('blur', () => commitInput('main', amountInput, amountPreview));
amountInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') amountInput.blur(); });

$('#swap-btn').addEventListener('click', () => {
  [state.from, state.to] = [state.to, state.from];
  state.text = formatInput(state.amount, getCurrency(state.from));
  $('#swap-btn').classList.remove('is-spinning');
  void $('#swap-btn').offsetWidth;
  $('#swap-btn').classList.add('is-spinning');
  updateAll();
  persist();
  loadChart();
});

$('#from-pill').addEventListener('click', () => openPicker('from'));
$('#to-pill').addEventListener('click', () => openPicker('to'));

function setTarget(code) {
  if (code === state.to) return;
  if (code === state.from) {
    [state.from, state.to] = [state.to, state.from];
    state.text = formatInput(state.amount, getCurrency(state.from));
  } else {
    state.to = code;
  }
  updateAll();
  persist();
  loadChart();
}

function setSource(code) {
  if (code === state.from) return;
  if (code === state.to) {
    [state.from, state.to] = [state.to, state.from];
  } else {
    state.from = code;
  }
  state.text = formatInput(state.amount, getCurrency(state.from));
  updateAll();
  persist();
  loadChart();
}

function updateAll() {
  updateCards();
  updateMain();
  updateChartHeader();
}

/* ============================ Копирование ============================ */

function copyPayload(format) {
  const toCur = getCurrency(state.to);
  const v = valueIn(state.to);
  const r = rateOf(state.from, state.to, rates);
  if (format !== 'link' && (!Number.isFinite(v) || !Number.isFinite(r))) return null;
  switch (format) {
    case 'number': return plainAmount(v, toCur);
    case 'pair': return `${plainAmount(v, toCur)} ${state.to}`;
    case 'full': return `${sourcePlain()} ${state.from} = ${plainAmount(v, toCur)} ${state.to} (Курс: ${plainRate(r)})`;
    case 'link': return shareLink();
    case 'grid':
      return state.list
        .filter((c) => c !== state.from)
        .map((c) => {
          const x = valueIn(c);
          return Number.isFinite(x) ? `${sourcePlain()} ${state.from} = ${plainAmount(x, getCurrency(c))} ${c}` : null;
        })
        .filter(Boolean)
        .join('\n');
    default: return null;
  }
}

const copyMain = $('#copy-main');
const copyCaret = $('#copy-caret');
const copyMenu = $('#copy-menu');

function renderCopyMain() {
  if (copyMain.classList.contains('is-copied')) return; // не перебиваем фидбек «Скопировано!»
  const f = COPY_FORMATS.find((x) => x.id === state.copyFormat);
  copyMain.innerHTML = `${ICON_COPY}<span class="copy-label">Копировать</span><small class="copy-split__format">${f.label}</small>`;
}

async function doCopy(format, button) {
  const text = copyPayload(format);
  if (!text) { showToast('Нечего копировать — курс ещё не загружен', 'error'); return; }
  await copyToClipboard(text, button);
}

copyMain.addEventListener('click', () => doCopy(state.copyFormat, copyMain));

function openCopyMenu() {
  copyMenu.innerHTML = COPY_FORMATS.map((f) => {
    const preview = copyPayload(f.id) || '—';
    return `<button class="menu__item ${f.id === state.copyFormat ? 'is-active' : ''}" role="menuitemradio"
        aria-checked="${f.id === state.copyFormat}" data-format="${f.id}" type="button">
        <span class="menu__label">${f.label}</span>
        <span class="menu__preview">${esc(preview.split('\n').slice(0, 2).join(' · '))}</span>
      </button>`;
  }).join('');
  copyMenu.hidden = false;
  copyCaret.setAttribute('aria-expanded', 'true');
  $('.menu__item.is-active', copyMenu)?.focus();
}

function closeCopyMenu(focusCaret = false) {
  if (copyMenu.hidden) return;
  copyMenu.hidden = true;
  copyCaret.setAttribute('aria-expanded', 'false');
  if (focusCaret) copyCaret.focus();
}

copyCaret.addEventListener('click', (e) => {
  e.stopPropagation();
  if (copyMenu.hidden) openCopyMenu(); else closeCopyMenu();
});

copyMenu.addEventListener('click', (e) => {
  const item = e.target.closest('.menu__item');
  if (!item) return;
  state.copyFormat = item.dataset.format;
  persist();
  closeCopyMenu();
  renderCopyMain();
  doCopy(state.copyFormat, copyMain);
});

copyMenu.addEventListener('keydown', (e) => {
  const items = [...copyMenu.querySelectorAll('.menu__item')];
  const i = items.indexOf(document.activeElement);
  if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length].focus(); }
  if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
  if (e.key === 'Escape') { e.preventDefault(); closeCopyMenu(true); }
  if (e.key === 'Tab') closeCopyMenu();
});

document.addEventListener('click', (e) => {
  if (!e.target.closest('#copy-split')) closeCopyMenu();
});

/* ============================ График ============================ */

const chartHost = $('#chart');
const chartMeta = $('#chart-meta');
const chartFmtTime = new Intl.DateTimeFormat(DISPLAY_LOCALE, { hour: '2-digit', minute: '2-digit' });
const chartFmtDay = new Intl.DateTimeFormat(DISPLAY_LOCALE, { day: 'numeric', month: 'short' });
const chartFmtMonth = new Intl.DateTimeFormat(DISPLAY_LOCALE, { month: 'short', year: '2-digit' });
const chartFmtYear = new Intl.DateTimeFormat(DISPLAY_LOCALE, { year: 'numeric' });
const chartFmtTip = new Intl.DateTimeFormat(DISPLAY_LOCALE, { day: 'numeric', month: 'long', year: 'numeric' });
const chartFmtTipTime = new Intl.DateTimeFormat(DISPLAY_LOCALE, { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });

let chartData = null;
let chartReq = 0;

const chart = new LineChart(chartHost, {
  // ось: без копеек для больших чисел; подсказка — полная точность
  formatY: (v, tip) => (!tip && Math.abs(v) >= 1000 ? formatNumber(v, { min: 0, max: 0 }) : formatRate(v)),
  formatX: (t) => {
    const p = state.period;
    if (p === '24h') return chartFmtTime.format(t);
    if (p === '7D' || p === '1M') return chartFmtDay.format(t);
    if (p === '1Y') return chartFmtMonth.format(t);
    const span = chartData?.points?.length ? Date.now() - chartData.points[0][0] : 0;
    return span > 4 * 365 * 864e5 ? chartFmtYear.format(t) : chartFmtMonth.format(t);
  },
  formatTip: (t) => {
    const dense = chartData && chartData.points.length > 1
      && (chartData.points[1][0] - chartData.points[0][0]) < 20 * 3600e3;
    return (dense ? chartFmtTipTime : chartFmtTip).format(t);
  },
});

const periodTabs = $('#period-tabs');
periodTabs.innerHTML = Object.entries(PERIODS)
  .map(([id, p]) => `<button type="button" class="tab" data-period="${id}" aria-pressed="${id === state.period}">${p.label}</button>`)
  .join('');
periodTabs.addEventListener('click', (e) => {
  const btn = e.target.closest('.tab');
  if (!btn || btn.dataset.period === state.period) return;
  state.period = btn.dataset.period;
  periodTabs.querySelectorAll('.tab').forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
  persist();
  loadChart();
});

/** Для «мелких» курсов (1 EUR = 0,0000169 BTC) график показывает обратный курс: 1 BTC = 59 130 EUR. */
function chartInverted(from = state.from, to = state.to) {
  return rateOf(from, to, rates) < 0.01;
}

function updateChartHeader() {
  const f = getCurrency(state.from);
  const t = getCurrency(state.to);
  $('#chart-title').innerHTML = `${badgeHTML(f)}${badgeHTML(t)}<span>${state.from} → ${state.to}</span>`;
  const r = rateOf(state.from, state.to, rates);
  $('#chart-rate').textContent = !Number.isFinite(r) ? ''
    : chartInverted() ? `1 ${state.to} = ${formatRate(1 / r)} ${state.from}`
    : `1 ${state.from} = ${formatRate(r)} ${state.to}`;
}

function setChartChange() {
  const chip = $('#chart-change');
  const pts = chartData?.points;
  if (!pts || pts.length < 2) { chip.textContent = ''; chip.className = 'chip'; return; }
  const ch = (pts[pts.length - 1][1] / pts[0][1] - 1) * 100;
  chip.textContent = `${formatPercent(ch)} · ${PERIODS[state.period].label}`;
  chip.className = `chip ${ch > 0.005 ? 'chip--up' : ch < -0.005 ? 'chip--down' : ''}`;
}

async function loadChart() {
  const req = ++chartReq;
  const { from, to, period } = state;
  chartHost.classList.add('is-loading');
  chartHost.classList.remove('is-error');
  chartMeta.textContent = 'Загружаем историю…';
  try {
    const raw = await getPairSeries(from, to, period, rates);
    if (req !== chartReq) return;
    const invert = chartInverted(from, to);
    const data = invert ? { ...raw, points: raw.points.map(([t, v]) => [t, 1 / v]) } : raw;
    chartData = data;
    const [a, b] = invert ? [to, from] : [from, to];
    chart.setData(data.points, { label: `График курса ${a}/${b} за период ${PERIODS[period].label}` });
    const ys = data.points.map((p) => p[1]);
    const parts = [];
    if (ys.length) parts.push(`мин ${formatRate(Math.min(...ys))}`, `макс ${formatRate(Math.max(...ys))}`);
    if (data.sources.length) parts.push(`источник: ${data.sources.join(' + ')}`);
    chartMeta.innerHTML = `<span>${parts.join(' · ')}</span>${data.notes.map((n) => `<span class="note">${esc(n)}</span>`).join('')}`;
  } catch (err) {
    if (req !== chartReq) return;
    console.warn('[chart]', err);
    chartData = null;
    chart.setData([]);
    chartHost.classList.add('is-error');
    chartMeta.innerHTML = `<span class="note note--error">Не удалось загрузить историю${navigator.onLine ? '' : ' — нет подключения'}.</span>
      <button class="btn btn--ghost btn--sm" type="button" id="chart-retry">Повторить</button>`;
    $('#chart-retry')?.addEventListener('click', loadChart);
  } finally {
    if (req === chartReq) chartHost.classList.remove('is-loading');
    setChartChange();
  }
}

/* ============================ Выбор валюты ============================ */

const picker = $('#picker');
const pickerSearch = $('#picker-search');
const pickerList = $('#picker-list');
const pickerTabs = $('#picker-tabs');
const pickerState = { mode: 'add', kind: 'all', active: 0, items: [] };

pickerTabs.innerHTML = [['all', 'Все'], ...Object.entries(KIND_LABELS)]
  .map(([id, label]) => `<button type="button" class="tab" data-kind="${id}" aria-pressed="${id === 'all'}">${label}</button>`)
  .join('');

function openPicker(mode) {
  pickerState.mode = mode;
  pickerState.active = 0;
  $('#picker-title').textContent = mode === 'from' ? 'Исходная валюта' : mode === 'to' ? 'Целевая валюта' : 'Добавить валюты';
  $('#picker-foot').hidden = mode !== 'add';
  pickerSearch.value = '';
  renderPicker();
  picker.showModal();
  // на телефоне не открываем клавиатуру сразу — список важнее
  if (matchMedia('(pointer: fine)').matches) pickerSearch.focus();
}

function renderPicker() {
  const items = searchCurrencies(pickerSearch.value, pickerState.kind);
  pickerState.items = items;
  pickerState.active = Math.min(pickerState.active, Math.max(0, items.length - 1));
  const current = pickerState.mode === 'from' ? state.from : pickerState.mode === 'to' ? state.to : null;

  if (!items.length) {
    pickerList.innerHTML = '<li class="picker__empty">Ничего не найдено. Попробуйте код (USD), название («тенге») или символ (€).</li>';
  } else {
    pickerList.innerHTML = items.map((cur, i) => {
      const inList = state.list.includes(cur.code);
      const selected = pickerState.mode === 'add' ? inList : cur.code === current;
      const r = rateOf(cur.code, state.from, rates);
      const rate = cur.code === state.from ? '' : Number.isFinite(r) ? `${formatRate(r)} ${state.from}` : '';
      return `<li class="picker__item ${i === pickerState.active ? 'is-active' : ''} ${selected ? 'is-selected' : ''}"
          role="option" id="opt-${cur.code}" data-code="${cur.code}" aria-selected="${selected}">
          ${badgeHTML(cur)}
          <span class="picker__name"><strong>${cur.code}</strong><span>${esc(cur.ru)}${cur.sym && cur.sym !== cur.code ? ` · ${esc(cur.sym)}` : ''}</span></span>
          <span class="picker__rate">${rate}</span>
          <span class="picker__check" aria-hidden="true">${selected ? '✓' : pickerState.mode === 'add' ? '+' : ''}</span>
        </li>`;
    }).join('');
  }
  pickerSearch.setAttribute('aria-activedescendant', items[pickerState.active] ? `opt-${items[pickerState.active].code}` : '');
  $('#picker-summary').textContent = `В сетке: ${state.list.length}`;
}

function moveActive(delta) {
  const n = pickerState.items.length;
  if (!n) return;
  pickerState.active = (pickerState.active + delta + n) % n;
  pickerList.querySelectorAll('.picker__item').forEach((li, i) => li.classList.toggle('is-active', i === pickerState.active));
  const activeEl = pickerList.children[pickerState.active];
  activeEl?.scrollIntoView({ block: 'nearest' });
  pickerSearch.setAttribute('aria-activedescendant', activeEl?.id || '');
}

function choose(code) {
  const mode = pickerState.mode;
  if (mode === 'add') {
    if (state.list.includes(code)) removeCurrency(code);
    else addCurrency(code);
    const scroll = pickerList.scrollTop;
    renderPicker();
    pickerList.scrollTop = scroll;
    return;
  }
  if (!state.list.includes(code)) addCurrency(code, mode === 'from');
  if (mode === 'from') setSource(code); else setTarget(code);
  picker.close();
}

pickerSearch.addEventListener('input', () => { pickerState.active = 0; renderPicker(); pickerList.scrollTop = 0; });
pickerSearch.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown') { e.preventDefault(); moveActive(1); }
  if (e.key === 'ArrowUp') { e.preventDefault(); moveActive(-1); }
  if (e.key === 'Enter') {
    e.preventDefault();
    const cur = pickerState.items[pickerState.active];
    if (cur) choose(cur.code);
  }
});
pickerList.addEventListener('click', (e) => {
  const li = e.target.closest('.picker__item');
  if (li) choose(li.dataset.code);
});
pickerTabs.addEventListener('click', (e) => {
  const btn = e.target.closest('.tab');
  if (!btn) return;
  pickerState.kind = btn.dataset.kind;
  pickerState.active = 0;
  pickerTabs.querySelectorAll('.tab').forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
  renderPicker();
  pickerList.scrollTop = 0;
});
$('#picker-close').addEventListener('click', () => picker.close());
$('#picker-done').addEventListener('click', () => picker.close());
picker.addEventListener('click', (e) => { if (e.target === picker) picker.close(); }); // клик по фону

function addCurrency(code, atStart = false) {
  if (state.list.includes(code)) return;
  if (atStart) state.list.unshift(code); else state.list.push(code);
  renderGrid();
  persist();
  cards.get(code)?.root.classList.add('is-new');
  setTimeout(() => cards.get(code)?.root.classList.remove('is-new'), 700);
}

function removeCurrency(code) {
  if (state.list.length <= MIN_CARDS) {
    showToast(`В сетке должно остаться минимум ${MIN_CARDS} валюты`, 'error');
    return;
  }
  const rest = state.list.filter((c) => c !== code);
  let pairChanged = false;
  if (code === state.from) {
    const next = rest.includes(state.to) ? state.to : rest[0];
    const v = valueIn(next);
    if (Number.isFinite(v)) state.amount = v;
    state.from = next;
    state.text = formatInput(state.amount, getCurrency(next));
    pairChanged = true;
  }
  if (code === state.to || state.to === state.from) {
    state.to = rest.find((c) => c !== state.from);
    pairChanged = true;
  }
  state.list = rest;
  renderGrid();
  persist();
  if (pairChanged) loadChart();
}

/* ============================ Курсы, статус, офлайн ============================ */

const statusEl = $('#status');
const statusText = $('#status-text');
const refreshBtn = $('#refresh-btn');

function renderStatus() {
  const online = navigator.onLine;
  let text;
  let cls;
  if (loading && !snapshot) { text = 'Загружаем курсы…'; cls = 'is-loading'; }
  else if (!snapshot) { text = online ? 'Не удалось загрузить курсы' : 'Офлайн — нет сохранённых курсов'; cls = 'is-error'; }
  else if (!online) { text = `Офлайн · курсы от ${formatUpdated(snapshot.ts)}`; cls = 'is-offline'; }
  else if (loading) { text = 'Обновляем…'; cls = 'is-loading'; }
  else if (lastError) { text = `Нет связи · курсы от ${formatUpdated(snapshot.ts)}`; cls = 'is-offline'; }
  else { text = `Обновлено ${formatUpdated(snapshot.ts)}`; cls = 'is-online'; }
  statusText.textContent = text;
  statusEl.className = `status ${cls}`;
  const src = snapshot?.sources;
  statusEl.title = src
    ? [`ЕЦБ / Frankfurter: ${src.frankfurter.ok ? `✓ ${src.frankfurter.date}` : '✗'}`,
      `Fawazahmed0: ${src.fawaz.ok ? `✓ ${src.fawaz.date}` : '✗'}`,
      `CoinGecko: ${src.coingecko.ok ? '✓' : '✗'}`].join('\n')
    : '';
  refreshBtn.classList.toggle('is-spinning', loading);
}

async function refresh({ manual = false } = {}) {
  if (loading) return;
  loading = true;
  renderStatus();
  try {
    snapshot = await refreshRates(snapshot);
    rates = snapshot.rates;
    lastError = null;
    updateAll();
    if (manual) showToast('Курсы обновлены', 'info');
  } catch (err) {
    lastError = err;
    console.warn('[rates]', err, err.causes);
    if (manual) showToast(navigator.onLine ? 'Источники курсов недоступны' : 'Нет подключения к интернету', 'error');
  } finally {
    loading = false;
    renderStatus();
  }
}

refreshBtn.addEventListener('click', async () => {
  await refresh({ manual: true });
  loadChart();
});

window.addEventListener('online', () => { renderStatus(); refresh(); });
window.addEventListener('offline', renderStatus);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && (!snapshot || Date.now() - snapshot.ts > AUTO_REFRESH_MS)) refresh();
});
setInterval(() => {
  if (document.visibilityState === 'visible' && navigator.onLine) refresh();
}, AUTO_REFRESH_MS);

/* ============================ Тема, PWA, горячие клавиши ============================ */

const themeMeta = document.querySelector('meta[name="theme-color"]');
const darkQuery = matchMedia('(prefers-color-scheme: dark)');

function applyTheme() {
  const root = document.documentElement;
  if (state.theme === 'light' || state.theme === 'dark') root.dataset.theme = state.theme;
  else delete root.dataset.theme;
  const dark = state.theme === 'dark' || (state.theme === 'system' && darkQuery.matches);
  themeMeta.content = dark ? '#0b0d17' : '#eef1f8';
  requestAnimationFrame(() => chart.render());
}
$('#theme-btn').addEventListener('click', () => {
  const dark = state.theme === 'dark' || (state.theme === 'system' && darkQuery.matches);
  state.theme = dark ? 'light' : 'dark';
  applyTheme();
  persist();
});
darkQuery.addEventListener('change', applyTheme);

let installPrompt = null;
const installBtn = $('#install-btn');
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installPrompt = e;
  installBtn.hidden = false;
});
installBtn.addEventListener('click', async () => {
  if (!installPrompt) return;
  installPrompt.prompt();
  await installPrompt.userChoice;
  installPrompt = null;
  installBtn.hidden = true;
});
window.addEventListener('appinstalled', () => { installBtn.hidden = true; showToast('Приложение установлено', 'success'); });

document.addEventListener('keydown', (e) => {
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName);
  if (picker.open) return;
  if ((e.key === '/' && !typing) || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k')) {
    e.preventDefault();
    openPicker('add');
  }
});

if ('serviceWorker' in navigator && (location.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(location.hostname))) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch((err) => console.warn('[sw]', err));
  });
}

/* ============================ Старт ============================ */

applyTheme();
renderGrid();          // мгновенно — из localStorage, без ожидания сети
renderStatus();
persist();
refresh().then(() => { if (chartHost.classList.contains('is-error')) loadChart(); });
loadChart();
loadWeek()
  .then((w) => { week = w; updateCards(); })
  .catch((err) => { console.warn('[week]', err); week = []; updateCards(); });
