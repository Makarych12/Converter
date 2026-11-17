/**
 * Лёгкие SVG-графики без зависимостей: спарклайн и интерактивный график с перекрестием.
 */

const NS = 'http://www.w3.org/2000/svg';
let gradientSeq = 0;

/**
 * Спарклайн как SVG-строка. Зелёный — рост, красный — падение.
 * Без анимаций, фильтров и теней; в режиме `lite` — без градиентной заливки (меньше узлов и растеризации).
 */
export function sparklineSVG(values, { width = 120, height = 36, lite = false } = {}) {
  if (!values || values.length < 2) {
    return `<svg viewBox="0 0 ${width} ${height}" class="spark spark--empty" aria-hidden="true"><line x1="0" x2="${width}" y1="${height / 2}" y2="${height / 2}" /></svg>`;
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || Math.abs(max) * 0.001 || 1;
  const pad = 3;
  const stepX = width / (values.length - 1);
  const pts = values.map((v, i) => [i * stepX, height - pad - ((v - min) / span) * (height - pad * 2)]);
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join('');
  const up = values[values.length - 1] >= values[0];
  const last = pts[pts.length - 1];
  if (lite) {
    return `<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" class="spark ${up ? 'is-up' : 'is-down'}" aria-hidden="true">
    <path d="${d}" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>
  </svg>`;
  }
  const id = `sg${++gradientSeq}`;
  return `<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" class="spark ${up ? 'is-up' : 'is-down'}" aria-hidden="true">
    <defs><linearGradient id="${id}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="currentColor" stop-opacity=".28"/><stop offset="1" stop-color="currentColor" stop-opacity="0"/></linearGradient></defs>
    <path d="${d}L${width},${height}L0,${height}Z" fill="url(#${id})" stroke="none"/>
    <path d="${d}" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>
    <circle cx="${last[0].toFixed(1)}" cy="${last[1].toFixed(1)}" r="2.2" fill="currentColor"/>
  </svg>`;
}

function niceTicks(min, max, count = 4) {
  const span = max - min || Math.abs(max) || 1;
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
  const ticks = [];
  for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-6; v += step) ticks.push(v);
  return ticks;
}

function el(name, attrs = {}) {
  const node = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
}

export class LineChart {
  /**
   * @param {HTMLElement} host
   * @param {{formatY: (v:number)=>string, formatX: (t:number)=>string, formatTip: (t:number)=>string}} fmt
   */
  constructor(host, fmt) {
    this.host = host;
    this.fmt = fmt;
    this.points = [];
    this.host.classList.add('chart');
    this.svg = el('svg', { class: 'chart__svg', role: 'img' });
    this.tip = document.createElement('div');
    this.tip.className = 'chart__tip';
    this.tip.hidden = true;
    this.host.append(this.svg, this.tip);

    // Перерисовка только при реальном изменении размера (на мобильных скрытие адресной строки
    // меняет высоту окна, но не размер графика)
    this.size = '';
    this.ro = new ResizeObserver(() => {
      const size = `${this.host.clientWidth}x${this.host.clientHeight}`;
      if (size !== this.size) this.render();
    });
    this.ro.observe(this.host);

    // pointermove приходит чаще, чем кадры экрана — обрабатываем последнее событие раз за кадр
    let frame = 0;
    let lastEvent = null;
    const move = (e) => {
      lastEvent = e;
      if (!frame) frame = requestAnimationFrame(() => { frame = 0; this.hover(lastEvent); });
    };
    this.svg.addEventListener('pointermove', move);
    this.svg.addEventListener('pointerdown', move);
    this.svg.addEventListener('pointerleave', () => this.clearHover());
    this.svg.addEventListener('pointercancel', () => this.clearHover());
  }

  setData(points, { label = '' } = {}) {
    this.points = points || [];
    this.svg.setAttribute('aria-label', label);
    this.render();
  }

  render() {
    const w = this.host.clientWidth;
    const h = this.host.clientHeight;
    if (!w || !h) return;
    this.size = `${w}x${h}`;
    const svg = this.svg;
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    svg.replaceChildren();
    this.clearHover();
    const pts = this.points;
    if (pts.length < 2) return;

    const ys = pts.map((p) => p[1]);
    let min = Math.min(...ys);
    let max = Math.max(...ys);
    if (min === max) { min -= Math.abs(min) * 0.01 || 1; max += Math.abs(max) * 0.01 || 1; }
    const padY = (max - min) * 0.08;
    min -= padY; max += padY;

    const ticks = niceTicks(min, max, h < 220 ? 3 : 4).filter((t) => t >= min && t <= max);
    const labelW = Math.max(...ticks.map((t) => this.fmt.formatY(t).length)) * 7 + 12;
    const m = { top: 12, right: labelW, bottom: 26, left: 4 };
    const iw = w - m.left - m.right;
    const ih = h - m.top - m.bottom;
    const t0 = pts[0][0];
    const t1 = pts[pts.length - 1][0];
    const x = (t) => m.left + ((t - t0) / (t1 - t0 || 1)) * iw;
    const y = (v) => m.top + (1 - (v - min) / (max - min)) * ih;
    this.geom = { x, y, m, iw, ih, w, h };

    const up = pts[pts.length - 1][1] >= pts[0][1];
    svg.classList.toggle('is-up', up);
    svg.classList.toggle('is-down', !up);

    const grid = el('g', { class: 'chart__grid' });
    for (const t of ticks) {
      const yy = y(t);
      grid.append(el('line', { x1: m.left, x2: m.left + iw, y1: yy, y2: yy }));
      const text = el('text', { x: w - 4, y: yy + 4, 'text-anchor': 'end' });
      text.textContent = this.fmt.formatY(t);
      grid.append(text);
    }
    const xCount = Math.max(2, Math.min(6, Math.floor(iw / 90)));
    for (let i = 0; i < xCount; i++) {
      const t = t0 + ((t1 - t0) * i) / (xCount - 1);
      const text = el('text', {
        x: x(t), y: h - 6,
        'text-anchor': i === 0 ? 'start' : i === xCount - 1 ? 'end' : 'middle',
      });
      text.textContent = this.fmt.formatX(t);
      grid.append(text);
    }
    svg.append(grid);

    const gid = `cg${++gradientSeq}`;
    const defs = el('defs');
    const lg = el('linearGradient', { id: gid, x1: 0, x2: 0, y1: 0, y2: 1 });
    lg.append(el('stop', { offset: 0, 'stop-color': 'currentColor', 'stop-opacity': 0.3 }));
    lg.append(el('stop', { offset: 1, 'stop-color': 'currentColor', 'stop-opacity': 0 }));
    defs.append(lg);
    svg.append(defs);

    const line = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p[0]).toFixed(1)},${y(p[1]).toFixed(1)}`).join('');
    svg.append(el('path', { d: `${line}L${x(t1)},${m.top + ih}L${x(t0)},${m.top + ih}Z`, fill: `url(#${gid})`, class: 'chart__area' }));
    svg.append(el('path', { d: line, class: 'chart__line' }));

    this.cross = el('line', { class: 'chart__cross', y1: m.top, y2: m.top + ih, visibility: 'hidden' });
    this.dot = el('circle', { class: 'chart__dot', r: 4.5, visibility: 'hidden' });
    svg.append(this.cross, this.dot);
  }

  hover(e) {
    if (!this.geom || this.points.length < 2) return;
    const rect = this.svg.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const { x, y, w } = this.geom;
    // ближайшая точка по X (бинпоиск)
    const pts = this.points;
    let lo = 0;
    let hi = pts.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (x(pts[mid][0]) < px) lo = mid; else hi = mid;
    }
    const p = Math.abs(x(pts[lo][0]) - px) < Math.abs(x(pts[hi][0]) - px) ? pts[lo] : pts[hi];
    const cx = x(p[0]);
    const cy = y(p[1]);
    this.cross.setAttribute('x1', cx);
    this.cross.setAttribute('x2', cx);
    this.cross.setAttribute('visibility', 'visible');
    this.dot.setAttribute('cx', cx);
    this.dot.setAttribute('cy', cy);
    this.dot.setAttribute('visibility', 'visible');

    this.tip.innerHTML = `<strong>${this.fmt.formatY(p[1], true)}</strong><span>${this.fmt.formatTip(p[0])}</span>`;
    this.tip.hidden = false;
    const tw = this.tip.offsetWidth;
    const left = Math.min(Math.max(cx - tw / 2, 0), w - tw);
    this.tip.style.transform = `translate(${left}px, ${Math.max(cy - 58, 0)}px)`;
    this.host.dispatchEvent(new CustomEvent('chart-hover', { detail: { point: p } }));
  }

  clearHover() {
    this.cross?.setAttribute('visibility', 'hidden');
    this.dot?.setAttribute('visibility', 'hidden');
    this.tip.hidden = true;
  }
}
