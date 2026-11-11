// Small dependency-free SVG time-series charts (line + bar) with a hover/tap tooltip.
(function () {
  'use strict';

  const NS = 'http://www.w3.org/2000/svg';
  const DAY = 86400000;

  const dayNum = (s) => Math.round(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) / DAY);
  const dayStr = (n) => new Date(n * DAY).toISOString().slice(0, 10);

  function el(name, attrs, parent) {
    const node = document.createElementNS(NS, name);
    for (const k in attrs) node.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(node);
    return node;
  }

  function niceStep(range, count) {
    const raw = range / count;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const norm = raw / mag;
    const step = norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10;
    return step * mag;
  }

  function fmt(v, decimals) {
    return v.toLocaleString('de-DE', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  }

  function shortDate(n) {
    const d = new Date(n * DAY);
    return `${String(d.getUTCDate()).padStart(2, '0')}.${String(d.getUTCMonth() + 1).padStart(2, '0')}.`;
  }

  function longDate(n) {
    return new Date(n * DAY).toLocaleDateString('de-DE', {
      weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC',
    });
  }

  /** 7-day trailing average over the logged values (gaps are skipped, not treated as zero). */
  function movingAverage(points, days) {
    return points.map((p, i) => {
      let sum = 0;
      let n = 0;
      for (let j = i; j >= 0 && points[j].x > p.x - days; j--) {
        sum += points[j].y;
        n++;
      }
      return { x: p.x, y: sum / n };
    });
  }

  /**
   * opts: { data: [{date, value}], from, to (YYYY-MM-DD), type: 'line'|'bar',
   *         goal, unit, decimals, label, trend: bool, formatValue }
   */
  function render(container, opts) {
    container.innerHTML = '';
    container.classList.add('chart');
    const pts = opts.data
      .filter((d) => d.value !== null && d.value !== undefined)
      .map((d) => ({ x: dayNum(d.date), y: d.value }))
      .sort((a, b) => a.x - b.x);

    if (!pts.length) {
      const empty = document.createElement('div');
      empty.className = 'chart-empty';
      empty.textContent = 'Noch keine Daten in diesem Zeitraum';
      container.appendChild(empty);
      return;
    }

    const width = Math.max(container.clientWidth, 260);
    const height = opts.height || 200;
    const pad = { l: 44, r: 12, t: 14, b: 26 };
    const pw = width - pad.l - pad.r;
    const ph = height - pad.t - pad.b;

    const isBar = opts.type === 'bar';
    let x0 = dayNum(opts.from);
    let x1 = dayNum(opts.to);
    if (x1 <= x0) x1 = x0 + 1;
    if (isBar) { x0 -= 0.5; x1 += 0.5; }

    const values = pts.map((p) => p.y);
    if (opts.goal !== null && opts.goal !== undefined) values.push(opts.goal);
    let yMin = isBar ? 0 : Math.min(...values);
    let yMax = Math.max(...values);
    if (yMax === yMin) { yMax += 1; if (!isBar) yMin -= 1; }
    const step = niceStep(yMax - yMin, 4);
    yMin = isBar ? 0 : Math.floor((yMin - step * 0.25) / step) * step;
    yMax = Math.ceil((yMax + (isBar ? 0 : step * 0.25)) / step) * step;
    if (isBar && yMax === Math.max(...values)) yMax += step;

    const sx = (x) => pad.l + ((x - x0) / (x1 - x0)) * pw;
    const sy = (y) => pad.t + (1 - (y - yMin) / (yMax - yMin)) * ph;
    const decimals = opts.decimals || 0;
    const tickDecimals = step < 1 ? 1 : 0;

    const svg = el('svg', { viewBox: `0 0 ${width} ${height}`, width, height, role: 'img', 'aria-label': opts.label || '' }, container);

    // Horizontal grid + y labels
    for (let y = yMin; y <= yMax + step / 1000; y += step) {
      el('line', { x1: pad.l, x2: width - pad.r, y1: sy(y), y2: sy(y), class: 'grid' }, svg);
      const t = el('text', { x: pad.l - 6, y: sy(y) + 4, class: 'axis', 'text-anchor': 'end' }, svg);
      t.textContent = Math.abs(y) >= 10000 ? `${fmt(y / 1000, 0)}k` : fmt(y, tickDecimals);
    }

    // X labels
    const spanDays = Math.round(x1 - x0);
    const labelCount = Math.max(2, Math.min(6, Math.floor(pw / 70)));
    const xStep = Math.max(1, Math.ceil(spanDays / (labelCount - 1)));
    for (let x = Math.ceil(x0); x <= Math.floor(x1); x += xStep) {
      const t = el('text', { x: sx(x), y: height - 8, class: 'axis', 'text-anchor': 'middle' }, svg);
      t.textContent = shortDate(x);
    }

    // Goal line
    if (opts.goal !== null && opts.goal !== undefined) {
      el('line', { x1: pad.l, x2: width - pad.r, y1: sy(opts.goal), y2: sy(opts.goal), class: 'goal' }, svg);
      const t = el('text', { x: width - pad.r - 2, y: sy(opts.goal) - 5, class: 'goal-label', 'text-anchor': 'end' }, svg);
      t.textContent = `Ziel ${fmt(opts.goal, decimals)}`;
    }

    if (isBar) {
      const bw = Math.max(1.5, Math.min(24, (pw / (x1 - x0)) * 0.7));
      for (const p of pts) {
        const hit = opts.goal !== null && opts.goal !== undefined && p.y >= opts.goal;
        el('rect', {
          x: sx(p.x) - bw / 2, y: sy(p.y), width: bw, height: Math.max(0, sy(0) - sy(p.y)),
          rx: Math.min(3, bw / 3), class: hit ? 'bar bar-hit' : 'bar',
        }, svg);
      }
    } else {
      const d = opts.stepped
        ? pts.map((p, i) => (i ? `H${sx(p.x).toFixed(1)}V${sy(p.y).toFixed(1)}` : `M${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`)).join('')
        : pts.map((p, i) => `${i ? 'L' : 'M'}${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join('');
      el('path', { d, class: opts.trend ? 'line line-raw' : 'line' }, svg);
      if (opts.dots !== false && pts.length <= 90) {
        for (const p of pts) el('circle', { cx: sx(p.x), cy: sy(p.y), r: 2.5, class: 'dot' }, svg);
      }
      if (opts.trend && pts.length > 2) {
        const ma = movingAverage(pts, 7);
        const md = ma.map((p, i) => `${i ? 'L' : 'M'}${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join('');
        el('path', { d: md, class: 'line line-trend' }, svg);
      }
    }

    // Tooltip
    const cursor = el('line', { y1: pad.t, y2: pad.t + ph, class: 'cursor', visibility: 'hidden' }, svg);
    const marker = el('circle', { r: 4.5, class: 'marker', visibility: 'hidden' }, svg);
    const tip = document.createElement('div');
    tip.className = 'chart-tip';
    tip.hidden = true;
    container.appendChild(tip);
    const overlay = el('rect', { x: pad.l, y: pad.t, width: pw, height: ph, fill: 'transparent' }, svg);

    const formatValue = opts.formatValue || ((v) => `${fmt(v, decimals)} ${opts.unit || ''}`.trim());

    function show(evt) {
      const rect = svg.getBoundingClientRect();
      const mx = ((evt.clientX - rect.left) / rect.width) * width;
      const xVal = x0 + ((mx - pad.l) / pw) * (x1 - x0);
      let best = pts[0];
      for (const p of pts) if (Math.abs(p.x - xVal) < Math.abs(best.x - xVal)) best = p;
      const cx = sx(best.x);
      cursor.setAttribute('x1', cx);
      cursor.setAttribute('x2', cx);
      cursor.setAttribute('visibility', 'visible');
      marker.setAttribute('cx', cx);
      marker.setAttribute('cy', sy(best.y));
      marker.setAttribute('visibility', 'visible');
      tip.hidden = false;
      tip.innerHTML = '';
      const strong = document.createElement('strong');
      strong.textContent = formatValue(best.y);
      const small = document.createElement('span');
      small.textContent = longDate(best.x);
      tip.append(strong, small);
      const left = (cx / width) * rect.width;
      tip.style.left = `${Math.min(Math.max(left, 60), rect.width - 60)}px`;
    }
    function hide() {
      cursor.setAttribute('visibility', 'hidden');
      marker.setAttribute('visibility', 'hidden');
      tip.hidden = true;
    }
    overlay.addEventListener('pointermove', show);
    overlay.addEventListener('pointerdown', show);
    overlay.addEventListener('pointerleave', hide);
  }

  window.Charts = { render, dayNum, dayStr };
})();
