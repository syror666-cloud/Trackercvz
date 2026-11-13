'use strict';

/**
 * PDF reports in a calm, Apple-like style (Inter, lots of white space, soft grey tiles, brand colours as accents):
 *  - nutritionPlanPdf: the client's daily plan with kcal and macros per food, meal and day
 *  - checkinPdf: the weekly check-in – this week vs. last week, charts, coach comment, plan changes, day by day
 * Each returns a Promise<Buffer>. All data comes in as plain objects, so the layouts stay independent of the database.
 */

const path = require('node:path');
const PDFDocument = require('pdfkit');

const FONTS = path.join(__dirname, 'pdf-fonts');
const ICON = path.join(__dirname, '..', 'public', 'icon-192.png');
const C = {
  text: '#1d1d1f', secondary: '#6e6e73', tertiary: '#86868b', fill: '#f5f5f7', line: '#e5e5ea',
  navy: '#002941', soft: '#b6dfed', coral: '#fd6e6e', good: '#1f8a4c', bad: '#c0392b',
  protein: '#c2410c', carbs: '#2f6f8f', fat: '#8a6d00', prev: '#c7d3db',
};
const A4 = { w: 595.28, h: 841.89 };
const M = 48; // page margin
const W = A4.w - 2 * M;

const nf = (v, d = 0) => (v === null || v === undefined || Number.isNaN(v) ? '–'
  : Number(v).toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d }));
const signed = (v, d = 0, unit = '') => (v === null || v === undefined ? null
  : `${v > 0 ? '+' : v < 0 ? '−' : '±'}${nf(Math.abs(v), d)}${unit}`);
const fmtSleep = (h) => {
  if (h === null || h === undefined) return '–';
  const t = Math.round(h * 60);
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')} h`;
};
const fmtDate = (s, opts) => new Date(`${s}T12:00:00Z`).toLocaleDateString('de-DE', { timeZone: 'UTC', ...opts });

function newDoc(meta) {
  const doc = new PDFDocument({ size: 'A4', margin: M, bufferPages: true, info: { Producer: 'StayOnTrack', Creator: 'StayOnTrack', ...meta } });
  doc.registerFont('R', path.join(FONTS, 'inter-400.woff'));
  doc.registerFont('M', path.join(FONTS, 'inter-500.woff'));
  doc.registerFont('SB', path.join(FONTS, 'inter-600.woff'));
  doc.registerFont('B', path.join(FONTS, 'inter-700.woff'));
  doc.font('R');
  return doc;
}

function finish(doc) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    // footer on every page: brand left, page x of y right
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      doc.page.margins.bottom = 0; // the footer sits below the text area – don't let it start a new page
      const y = A4.h - 34;
      doc.save().moveTo(M, y - 10).lineTo(A4.w - M, y - 10).lineWidth(0.5).strokeColor(C.line).stroke().restore();
      doc.font('SB').fontSize(8).fillColor(C.secondary).text('StayOnTrack', M, y, { lineBreak: false });
      doc.font('R').fontSize(8).fillColor(C.tertiary)
        .text(`Seite ${i - range.start + 1} von ${range.count}`, M, y, { width: W, align: 'right', lineBreak: false });
    }
    doc.end();
  });
}

/** Page header: app icon, eyebrow, big title, subtitle line. Returns the y below it. */
function header(doc, { eyebrow, title, subtitle, right }) {
  let y = M - 8;
  try {
    doc.save();
    doc.roundedRect(M, y, 34, 34, 8).clip();
    doc.image(ICON, M, y, { width: 34, height: 34 });
    doc.restore();
  } catch {
    doc.restore();
  }
  doc.font('SB').fontSize(11).fillColor(C.text).text('StayOnTrack', M + 44, y + 4, { lineBreak: false });
  doc.font('R').fontSize(9).fillColor(C.secondary).text('Coaching', M + 44, y + 19, { lineBreak: false });
  if (right) doc.font('R').fontSize(9).fillColor(C.secondary).text(right, M, y + 12, { width: W, align: 'right', lineBreak: false });
  y += 62;
  if (eyebrow) {
    doc.font('SB').fontSize(9).fillColor(C.secondary).text(eyebrow.toUpperCase(), M, y, { characterSpacing: 0.6 });
    y += 16;
  }
  doc.font('B').fontSize(28).fillColor(C.text).text(title, M, y, { width: W, characterSpacing: -0.6 });
  y = doc.y + 4;
  if (subtitle) {
    doc.font('R').fontSize(12).fillColor(C.secondary).text(subtitle, M, y, { width: W });
    y = doc.y;
  }
  return y + 22;
}

function sectionTitle(doc, text, y, aside) {
  doc.font('SB').fontSize(15).fillColor(C.text).text(text, M, y, { width: W, characterSpacing: -0.2 });
  if (aside) doc.font('R').fontSize(10).fillColor(C.secondary).text(aside, M, y + 4, { width: W, align: 'right' });
  return y + 26;
}

/** Room left on the page; starts a new one when the block wouldn't fit. */
function ensure(doc, y, need) {
  if (y + need <= A4.h - 64) return y;
  doc.addPage();
  return M;
}

/** Soft grey tile with a label, a big value and an optional coloured delta line. */
function tile(doc, x, y, w, h, { label, value, sub, delta, good }) {
  doc.save().roundedRect(x, y, w, h, 12).fill(C.fill).restore();
  doc.font('M').fontSize(9).fillColor(C.secondary).text(label, x + 14, y + 13, { width: w - 28, lineBreak: false });
  doc.font('SB').fontSize(19).fillColor(C.text).text(value, x + 14, y + 29, { width: w - 28, lineBreak: false, characterSpacing: -0.3 });
  let ly = y + 55;
  if (delta) {
    doc.font('M').fontSize(9).fillColor(good === true ? C.good : good === false ? C.bad : C.secondary).text(delta, x + 14, ly, { width: w - 28, lineBreak: false });
    ly += 13;
  }
  if (sub) doc.font('R').fontSize(8.5).fillColor(C.tertiary).text(sub, x + 14, ly, { width: w - 28, lineBreak: false });
}

function tiles(doc, y, items, cols = 3, h = 84) {
  const gap = 10;
  const w = (W - gap * (cols - 1)) / cols;
  items.forEach((it, i) => tile(doc, M + (i % cols) * (w + gap), y + Math.floor(i / cols) * (h + gap), w, h, it));
  return y + Math.ceil(items.length / cols) * (h + gap) - gap + 26;
}

/** Thin horizontal progress bar with a label row above. */
function progress(doc, x, y, w, { label, value, target, color, unit = 'g' }) {
  doc.font('M').fontSize(9.5).fillColor(C.text).text(label, x, y, { lineBreak: false });
  doc.font('R').fontSize(9.5).fillColor(C.secondary)
    .text(target ? `${nf(value)} / ${nf(target)} ${unit}` : `${nf(value)} ${unit}`, x, y, { width: w, align: 'right', lineBreak: false });
  const by = y + 15;
  doc.save().roundedRect(x, by, w, 6, 3).fill(C.line).restore();
  const pct = target ? Math.min(1, value / target) : 1;
  if (pct > 0) doc.save().roundedRect(x, by, Math.max(6, w * pct), 6, 3).fill(color).restore();
  return by + 18;
}

/**
 * Bar chart over 14 days: the previous week in a quiet grey, this week in the brand colour; optional goal line.
 * values: [{ date, value }] (14 entries, oldest first).
 */
function barChart(doc, x, y, fullW, h, { values, goal, format, color = C.navy }) {
  const w = goal ? fullW - 58 : fullW; // goal label sits in a gutter on the right, never on the bars
  const max = Math.max(goal || 0, ...values.map((v) => v.value || 0)) * 1.12 || 1;
  const n = values.length;
  const slot = w / n;
  const bw = Math.min(18, slot * 0.62);
  const base = y + h;
  doc.save().moveTo(x, base).lineTo(x + w, base).lineWidth(0.5).strokeColor(C.line).stroke().restore();
  values.forEach((v, i) => {
    const bx = x + i * slot + (slot - bw) / 2;
    if (v.value) {
      const bh = Math.max(2, (v.value / max) * h);
      doc.save().roundedRect(bx, base - bh, bw, bh, Math.min(4, bw / 2)).fill(i < n / 2 ? C.prev : color).restore();
    }
    if (i % 2 === 1 || n <= 7) {
      doc.font('R').fontSize(7).fillColor(C.tertiary).text(fmtDate(v.date, { day: 'numeric' }), bx - 6, base + 5, { width: bw + 12, align: 'center', lineBreak: false });
    }
  });
  if (goal) {
    const gy = base - (goal / max) * h;
    doc.save().moveTo(x, gy).lineTo(x + w + 4, gy).dash(3, { space: 3 }).lineWidth(0.8).strokeColor(C.coral).stroke().undash().restore();
    doc.font('M').fontSize(7.5).fillColor(C.coral).text('Ziel', x + w + 8, gy - 9, { width: 50, lineBreak: false });
    doc.font('SB').fontSize(8).fillColor(C.coral).text(format(goal), x + w + 8, gy + 1, { width: 50, lineBreak: false });
  }
  return base + 20;
}

/** Line chart (weight) over 14 days with dots; gaps stay gaps. */
function lineChart(doc, x, y, w, h, { values, format }) {
  const pts = values.map((v, i) => ({ i, v: v.value })).filter((p) => p.v !== null && p.v !== undefined);
  const base = y + h;
  doc.save().moveTo(x, base).lineTo(x + w, base).lineWidth(0.5).strokeColor(C.line).stroke().restore();
  if (!pts.length) {
    doc.font('R').fontSize(9).fillColor(C.tertiary).text('Keine Werte in diesen zwei Wochen', x, y + h / 2 - 6, { width: w, align: 'center' });
    return base + 20;
  }
  const lo = Math.min(...pts.map((p) => p.v));
  const hi = Math.max(...pts.map((p) => p.v));
  const pad = Math.max(0.5, (hi - lo) * 0.25);
  const min = lo - pad;
  const max = hi + pad;
  const slot = w / values.length;
  const px = (i) => x + i * slot + slot / 2;
  const py = (v) => y + 8 + (1 - (v - min) / (max - min)) * (h - 16);
  doc.save();
  pts.forEach((p, k) => (k ? doc.lineTo(px(p.i), py(p.v)) : doc.moveTo(px(p.i), py(p.v))));
  doc.lineWidth(1.6).lineJoin('round').strokeColor(C.navy).stroke();
  doc.restore();
  pts.forEach((p) => doc.save().circle(px(p.i), py(p.v), 2.6).fillAndStroke(p.i < values.length / 2 ? C.prev : C.navy, '#ffffff').restore());
  doc.font('R').fontSize(7.5).fillColor(C.tertiary)
    .text(format(hi), x - 40, py(hi) - 4, { width: 36, align: 'right', lineBreak: false })
    .text(format(lo), x - 40, py(lo) - 4, { width: 36, align: 'right', lineBreak: false });
  values.forEach((v, i) => {
    if (i % 2 === 1) doc.font('R').fontSize(7).fillColor(C.tertiary).text(fmtDate(v.date, { day: 'numeric' }), px(i) - 10, base + 5, { width: 20, align: 'center', lineBreak: false });
  });
  return base + 20;
}

function legend(doc, y, items) {
  let x = M;
  for (const [label, color] of items) {
    doc.save().circle(x + 4, y + 4.5, 3.5).fill(color).restore();
    doc.font('R').fontSize(8.5).fillColor(C.secondary).text(label, x + 12, y, { lineBreak: false });
    x += 12 + doc.widthOfString(label) + 18;
  }
  return y + 18;
}

// ---------------------------------------------------------------------------------------------------------
/**
 * data: { client: { displayName }, coachName, date (YYYY-MM-DD), plan: { meals: [{ name, kcalTotal, macros, items:
 *   [{ name, amount, unit, kcalTotal, protein, carbs, fat }] }], totalKcal, macros, macroGoals }, goals: { caloriesMin, caloriesMax } }
 */
function nutritionPlanPdf({ client, coachName, date, plan, goals }) {
  const doc = newDoc({ Title: `Ernährungsplan – ${client.displayName}`, Author: coachName || 'StayOnTrack' });
  let y = header(doc, {
    eyebrow: 'Ernährungsplan',
    title: client.displayName,
    subtitle: `Stand ${fmtDate(date, { day: 'numeric', month: 'long', year: 'numeric' })}${coachName ? ` · von ${coachName}` : ''}`,
    right: fmtDate(date, { day: '2-digit', month: '2-digit', year: 'numeric' }),
  });
  const m = plan.macros || { protein: 0, carbs: 0, fat: 0 };
  const mg = plan.macroGoals || {};
  const range = goals && goals.caloriesMin ? `${nf(goals.caloriesMin)}–${nf(goals.caloriesMax)} kcal` : null;
  y = tiles(doc, y, [
    { label: 'Kalorien pro Tag', value: `${nf(plan.totalKcal)} kcal`, sub: range ? `Ziel ${range}` : 'Kein Kalorienziel' },
    { label: 'Eiweiß', value: `${nf(m.protein)} g`, sub: mg.protein ? `Ziel ${nf(mg.protein)} g` : `${nf((m.protein * 4 / Math.max(1, plan.totalKcal)) * 100)} % der Energie` },
    { label: 'Kohlenhydrate', value: `${nf(m.carbs)} g`, sub: mg.carbs ? `Ziel ${nf(mg.carbs)} g` : `${nf((m.carbs * 4 / Math.max(1, plan.totalKcal)) * 100)} % der Energie` },
    { label: 'Fett', value: `${nf(m.fat)} g`, sub: mg.fat ? `Ziel ${nf(mg.fat)} g` : `${nf((m.fat * 9 / Math.max(1, plan.totalKcal)) * 100)} % der Energie` },
  ], 4, 78);

  // energy split as one stacked bar
  const energy = m.protein * 4 + m.carbs * 4 + m.fat * 9;
  if (energy > 0) {
    y = sectionTitle(doc, 'Verteilung der Energie', y - 6);
    let bx = M;
    const parts = [['Eiweiß', m.protein * 4, C.protein], ['Kohlenhydrate', m.carbs * 4, C.carbs], ['Fett', m.fat * 9, C.fat]];
    doc.save().roundedRect(M, y, W, 10, 5).clip();
    for (const [, e, color] of parts) {
      const pw = (e / energy) * W;
      doc.rect(bx, y, pw, 10).fill(color);
      bx += pw;
    }
    doc.restore();
    y = legend(doc, y + 18, parts.map(([l, e, c]) => [`${l} ${nf((e / energy) * 100)} %`, c])) + 14;
  }

  // meals
  const cols = [
    { key: 'name', label: 'Lebensmittel', w: W - 296, align: 'left' },
    { key: 'amount', label: 'Menge', w: 64, align: 'right' },
    { key: 'kcal', label: 'kcal', w: 56, align: 'right' },
    { key: 'protein', label: 'Eiweiß', w: 58, align: 'right' },
    { key: 'carbs', label: 'Kohlenh.', w: 60, align: 'right' },
    { key: 'fat', label: 'Fett', w: 58, align: 'right' },
  ];
  const g = (v) => (v === null || v === undefined ? '–' : `${nf(v, v > 0 && v < 10 && v % 1 ? 1 : 0)} g`);
  for (const meal of plan.meals) {
    const rowH = 22;
    y = ensure(doc, y, 64 + rowH * Math.min(meal.items.length, 6));
    const mm = meal.macros || {};
    doc.font('SB').fontSize(14).fillColor(C.text).text(meal.name, M, y, { width: W - 160, lineBreak: false });
    doc.font('M').fontSize(10).fillColor(C.secondary)
      .text(`${nf(meal.kcalTotal)} kcal · E ${nf(mm.protein)} · K ${nf(mm.carbs)} · F ${nf(mm.fat)} g`, M, y + 3, { width: W, align: 'right', lineBreak: false });
    y += 24;
    // column header
    let x = M;
    for (const c of cols) {
      doc.font('M').fontSize(8).fillColor(C.tertiary).text(c.label.toUpperCase(), x + (c.align === 'left' ? 10 : 0), y, { width: c.w - 10, align: c.align, lineBreak: false, characterSpacing: 0.3 });
      x += c.w;
    }
    y += 14;
    meal.items.forEach((it, i) => {
      y = ensure(doc, y, rowH + 4);
      if (i % 2 === 0) doc.save().roundedRect(M, y - 5, W, rowH, 6).fill(C.fill).restore();
      const vals = {
        name: it.name, amount: `${nf(it.amount, it.amount % 1 ? 1 : 0)} ${it.unit}`, kcal: nf(it.kcalTotal),
        protein: g(it.protein), carbs: g(it.carbs), fat: g(it.fat),
      };
      x = M;
      for (const c of cols) {
        doc.font(c.key === 'name' ? 'M' : 'R').fontSize(9.5).fillColor(c.key === 'name' ? C.text : C.secondary)
          .text(vals[c.key], x + (c.align === 'left' ? 10 : 0), y, { width: c.w - 10, align: c.align, lineBreak: false, ellipsis: true });
        x += c.w;
      }
      y += rowH;
    });
    y += 18;
  }
  y = ensure(doc, y, 60);
  doc.font('R').fontSize(9).fillColor(C.tertiary)
    .text('Mengen beziehen sich auf das Rohgewicht, sofern nicht anders angegeben. Etwas passt nicht? In der App kannst du einzelne Lebensmittel oder ganze Mahlzeiten zum Tausch anfragen.', M, y, { width: W });
  return finish(doc);
}

// ---------------------------------------------------------------------------------------------------------
/**
 * data: { client: { displayName }, coachName, createdAt (ISO), message, comparison (weekstats.weekComparison),
 *   goals: { stepsGoal, sleepGoal, targetWeight, caloriesMin, caloriesMax }, highlights: [{ text }], changes: [string],
 *   weightDirection: -1 | 0 | 1 }
 */
function checkinPdf({ client, coachName, createdAt, message, comparison, goals, highlights = [], changes = [], weightDirection = 0 }) {
  const cur = comparison.current;
  const prev = comparison.previous;
  const d = comparison.delta;
  const span = `${fmtDate(cur.from, { day: 'numeric', month: 'long' })} – ${fmtDate(cur.to, { day: 'numeric', month: 'long', year: 'numeric' })}`;
  const doc = newDoc({ Title: `Wochen-Check-in – ${client.displayName}`, Author: coachName || 'StayOnTrack' });
  let y = header(doc, {
    eyebrow: 'Wochen-Check-in',
    title: client.displayName,
    subtitle: span,
    right: `Erstellt ${new Date(createdAt).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })}`,
  });

  // coach comment: a quiet quote block with an accent bar
  if (message) {
    doc.font('R').fontSize(11.5);
    const textH = doc.heightOfString(message, { width: W - 44, lineGap: 3 });
    const h = textH + 52;
    y = ensure(doc, y, h + 10);
    doc.save().roundedRect(M, y, W, h, 14).fill(C.fill).restore();
    doc.save().roundedRect(M, y, 4, h, 2).fill(C.coral).restore();
    doc.font('SB').fontSize(9).fillColor(C.secondary).text(`KOMMENTAR VON ${(coachName || 'deinem Coach').toUpperCase()}`, M + 22, y + 16, { characterSpacing: 0.5 });
    doc.font('R').fontSize(11.5).fillColor(C.text).text(message, M + 22, y + 34, { width: W - 44, lineGap: 3 });
    y += h + 24;
  }

  y = sectionTitle(doc, 'Diese Woche im Vergleich', y, 'zur Vorwoche');
  const wGood = d.weightAvg === null || !weightDirection || d.weightAvg === 0 ? undefined : Math.sign(d.weightAvg) === weightDirection;
  const up = (v) => (v === null || v === undefined || Math.abs(v) < 0.01 ? undefined : v > 0); // more is better; 0 stays neutral
  y = tiles(doc, y, [
    { label: 'Gewicht Ø', value: cur.weightAvg === null ? '–' : `${nf(cur.weightAvg, 1)} kg`, delta: signed(d.weightAvg, 1, ' kg'), good: wGood, sub: prev.weightAvg === null ? null : `Vorwoche ${nf(prev.weightAvg, 1)} kg` },
    { label: 'Schritte Ø', value: nf(cur.stepsAvg), delta: signed(d.stepsAvg, 0), good: up(d.stepsAvg), sub: goals.stepsGoal ? `Ziel an ${cur.stepsGoalDays ?? 0} von 7 Tagen` : null },
    { label: 'Schlaf Ø', value: fmtSleep(cur.sleepAvg), delta: d.sleepAvg === null ? null : `${d.sleepAvg >= 0 ? '+' : '−'}${fmtSleep(Math.abs(d.sleepAvg))}`, good: up(d.sleepAvg), sub: goals.sleepGoal ? `Ziel in ${cur.sleepGoalDays ?? 0} von 7 Nächten` : null },
    { label: 'Tage eingetragen', value: `${cur.daysLogged} / 7`, delta: signed(d.daysLogged, 0), good: up(d.daysLogged) },
    { label: 'Trainingstage', value: String(cur.trainingDays), delta: signed(d.trainingDays, 0), good: up(d.trainingDays) },
    { label: 'Kalorienziel eingehalten', value: cur.caloriesAnswered ? `${cur.caloriesOkDays} / ${cur.caloriesAnswered}` : '–', delta: signed(d.caloriesOkDays, 0), good: up(d.caloriesOkDays), sub: cur.caloriesReportedAvg ? `sonst Ø ${nf(cur.caloriesReportedAvg)} kcal` : null },
  ], 3, 84);

  if (highlights.length) {
    y = ensure(doc, y, 40 + highlights.length * 20);
    y = sectionTitle(doc, 'Das lief richtig gut', y);
    for (const h of highlights) {
      doc.save().circle(M + 6, y + 6, 5).fill(C.good).restore();
      doc.save().moveTo(M + 3.6, y + 6.2).lineTo(M + 5.4, y + 8).lineTo(M + 8.6, y + 4.2)
        .lineWidth(1.3).lineCap('round').lineJoin('round').strokeColor('#ffffff').stroke().restore();
      doc.font('R').fontSize(10.5).fillColor(C.text).text(h.text, M + 20, y, { width: W - 20 });
      y = doc.y + 8;
    }
    y += 14;
  }

  // charts: two weeks, last week grey, this week in colour
  const days = comparison.days;
  y = ensure(doc, y, 170);
  y = sectionTitle(doc, 'Schritte', y, 'letzte 14 Tage');
  y = barChart(doc, M, y, W, 78, { values: days.map((x) => ({ date: x.date, value: x.steps })), goal: goals.stepsGoal, format: (v) => nf(v) });
  y = legend(doc, y, [['Vorwoche', C.prev], ['Diese Woche', C.navy]]) + 14;

  y = ensure(doc, y, 150);
  y = sectionTitle(doc, 'Gewicht', y, 'kg');
  y = lineChart(doc, M + 40, y, W - 98, 78, { values: days.map((x) => ({ date: x.date, value: x.weight })), format: (v) => nf(v, 1) }) + 14;

  y = ensure(doc, y, 150);
  y = sectionTitle(doc, 'Schlaf', y, 'Stunden');
  y = barChart(doc, M, y, W, 68, { values: days.map((x) => ({ date: x.date, value: x.sleep })), goal: goals.sleepGoal, format: fmtSleep, color: '#4f9cbb' }) + 14;

  if (changes.length) {
    y = ensure(doc, y, 50 + changes.length * 22);
    y = sectionTitle(doc, 'Anpassungen für deinen Plan', y);
    for (const ch of changes) {
      doc.save().roundedRect(M, y - 5, W, 22, 6).fill(C.fill).restore();
      const [label, rest] = ch.includes(': ') ? [ch.slice(0, ch.indexOf(': ')), ch.slice(ch.indexOf(': ') + 2)] : ['', ch];
      const [from, to] = rest.split(' → ');
      let cx = M + 12;
      if (label) {
        doc.font('M').fontSize(10).fillColor(C.text).text(`${label}`, cx, y, { lineBreak: false });
        cx = M + 200;
      }
      if (to !== undefined) {
        doc.font('R').fontSize(10).fillColor(C.secondary).text(from, cx, y, { lineBreak: false });
        cx += doc.widthOfString(from) + 10;
        doc.save().moveTo(cx, y + 6).lineTo(cx + 14, y + 6).moveTo(cx + 10, y + 2.5).lineTo(cx + 14, y + 6).lineTo(cx + 10, y + 9.5)
          .lineWidth(1.1).lineCap('round').lineJoin('round').strokeColor(C.coral).stroke().restore();
        doc.font('SB').fontSize(10).fillColor(C.text).text(to, cx + 22, y, { lineBreak: false });
      } else {
        doc.font('R').fontSize(10).fillColor(C.text).text(rest, cx, y, { width: W - (cx - M) - 12, lineBreak: false });
      }
      y += 26;
    }
    doc.font('R').fontSize(9).fillColor(C.tertiary).text('Nimm die Anpassungen in der App an, damit sie für dich gelten.', M, y + 2, { width: W });
    y = doc.y + 22;
  }

  // the week day by day
  const week = days.slice(7);
  y = ensure(doc, y, 60 + week.length * 22);
  y = sectionTitle(doc, 'Tag für Tag', y);
  const cols = [
    { label: 'Tag', w: 110, align: 'left' }, { label: 'Gewicht', w: 76, align: 'right' }, { label: 'Schritte', w: 80, align: 'right' },
    { label: 'Schlaf', w: 70, align: 'right' }, { label: 'Training', w: 70, align: 'right' }, { label: 'Kalorien', w: W - 406, align: 'right' },
  ];
  let x = M;
  for (const c of cols) {
    doc.font('M').fontSize(8).fillColor(C.tertiary).text(c.label.toUpperCase(), x + (c.align === 'left' ? 10 : 0), y, { width: c.w - 10, align: c.align, lineBreak: false, characterSpacing: 0.3 });
    x += c.w;
  }
  y += 14;
  week.forEach((e, i) => {
    if (i % 2 === 0) doc.save().roundedRect(M, y - 5, W, 22, 6).fill(C.fill).restore();
    const kcal = e.caloriesOk === true ? 'im Ziel' : e.calories ? `${nf(e.calories)} kcal` : e.caloriesOk === false ? 'nicht im Ziel' : '–';
    const vals = [
      fmtDate(e.date, { weekday: 'short', day: '2-digit', month: '2-digit' }), e.weight === null ? '–' : `${nf(e.weight, 1)} kg`,
      e.steps === null ? '–' : nf(e.steps), fmtSleep(e.sleep), e.training === true ? 'ja' : e.training === false ? 'nein' : '–', kcal,
    ];
    x = M;
    cols.forEach((c, k) => {
      doc.font(k === 0 ? 'M' : 'R').fontSize(9.5).fillColor(k === 0 ? C.text : C.secondary)
        .text(vals[k], x + (c.align === 'left' ? 10 : 0), y, { width: c.w - 10, align: c.align, lineBreak: false });
      x += c.w;
    });
    y += 22;
  });
  return finish(doc);
}

module.exports = { nutritionPlanPdf, checkinPdf };
