'use strict';

// Client categories (coach-only) and the extra measurements each category tracks.

const CATEGORIES = {
  diet: 'Diät',
  reverse: 'Reverse Diät',
  build: 'Aufbau',
  maintenance: 'Maintenance',
};

const DAY_MS = 86400000;
const addDays = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);

function metricsModule({ db, notifier, HttpError, readBody, textField, numberField, requireUser, requireCoach, targetClient, isValidDate, maxAllowedDate, localDate }) {
  const q = {
    all: db.prepare('SELECT * FROM metrics ORDER BY id'),
    one: db.prepare('SELECT * FROM metrics WHERE id = ?'),
    insert: db.prepare('INSERT INTO metrics (name, unit, kind, categories) VALUES (?, ?, ?, ?)'),
    update: db.prepare('UPDATE metrics SET name = ?, unit = ?, categories = ?, active = ? WHERE id = ?'),
    remove: db.prepare('DELETE FROM metrics WHERE id = ?'),
    values: db.prepare('SELECT * FROM metric_values WHERE user_id = ? AND metric_id = ? ORDER BY date'),
    upsertValue: db.prepare(
      `INSERT INTO metric_values (user_id, metric_id, date, value) VALUES (?, ?, ?, ?)
       ON CONFLICT (user_id, metric_id, date) DO UPDATE SET value = excluded.value`
    ),
    deleteValue: db.prepare('DELETE FROM metric_values WHERE user_id = ? AND metric_id = ? AND date = ?'),
    prs: db.prepare('SELECT * FROM prs WHERE user_id = ? AND metric_id = ? ORDER BY date, id'),
    pr: db.prepare('SELECT * FROM prs WHERE id = ?'),
    insertPr: db.prepare('INSERT INTO prs (user_id, metric_id, date, exercise, weight, reps) VALUES (?, ?, ?, ?, ?, ?)'),
    deletePr: db.prepare('DELETE FROM prs WHERE id = ?'),
    categoryCounts: db.prepare("SELECT category, COUNT(*) AS n FROM users WHERE role = 'client' GROUP BY category"),
  };

  const defRow = (m) => ({
    id: m.id,
    name: m.name,
    unit: m.unit,
    kind: m.kind,
    categories: JSON.parse(m.categories),
    active: Boolean(m.active),
  });

  /** Metrics that apply to a client right now (by category). */
  function metricsFor(client) {
    if (!client.category) return [];
    return q.all.all().map(defRow).filter((m) => m.active && m.categories.includes(client.category));
  }

  function requireMetricFor(client, metricId, kind) {
    const m = metricsFor(client).find((x) => x.id === Number(metricId));
    if (!m || m.kind !== kind) throw new HttpError(403, 'Dieses Maß ist für dich nicht freigeschaltet');
    return m;
  }

  /** Best lift per exercise: heavier wins; same weight → more reps wins. */
  function annotatePrs(rows) {
    const best = new Map();
    return rows.map((r) => {
      const key = r.exercise.toLowerCase();
      const prev = best.get(key);
      const isRecord = !prev || r.weight > prev.weight || (r.weight === prev.weight && r.reps > prev.reps);
      if (isRecord) best.set(key, r);
      return { id: r.id, date: r.date, exercise: r.exercise, weight: r.weight, reps: r.reps, isRecord, previous: prev ? { weight: prev.weight, reps: prev.reps } : null };
    });
  }

  function measurementsOf(client) {
    return metricsFor(client).map((m) => ({
      ...m,
      values: m.kind === 'number' ? q.values.all(client.id, m.id).map((v) => ({ date: v.date, value: v.value })) : undefined,
      prs: m.kind === 'pr' ? annotatePrs(q.prs.all(client.id, m.id)) : undefined,
    }));
  }

  /** Week comparison for the check-in: last value per week for numbers, new PRs for PR metrics. */
  function reviewFor(client, today) {
    const curFrom = addDays(today, -6);
    const prevFrom = addDays(today, -13);
    const prevTo = addDays(today, -7);
    return measurementsOf(client).map((m) => {
      if (m.kind === 'number') {
        const last = (from, to) => [...m.values].reverse().find((v) => v.date >= from && v.date <= to) || null;
        const cur = last(curFrom, today);
        const prev = last(prevFrom, prevTo);
        return { id: m.id, name: m.name, unit: m.unit, kind: m.kind, current: cur, previous: prev, delta: cur && prev ? Math.round((cur.value - prev.value) * 10) / 10 : null };
      }
      return { id: m.id, name: m.name, unit: m.unit, kind: m.kind, prsThisWeek: m.prs.filter((p) => p.date >= curFrom && p.date <= today), records: m.prs.filter((p) => p.isRecord && p.date >= curFrom) };
    });
  }

  function parseCategories(value) {
    if (!Array.isArray(value) || value.some((c) => !(c in CATEGORIES))) throw new HttpError(400, 'Ungültige Kategorien');
    return [...new Set(value)];
  }

  function validDate(date) {
    if (!isValidDate(date) || date > maxAllowedDate()) throw new HttpError(400, 'Ungültiges Datum');
    return date;
  }

  const routes = [
    // ---- Admin: definitions ----
    ['GET', /^\/api\/metrics$/, async (ctx) => {
      requireCoach(ctx);
      const counts = {};
      for (const r of q.categoryCounts.all()) counts[r.category || 'none'] = r.n;
      return { categories: CATEGORIES, counts, metrics: q.all.all().map(defRow) };
    }],

    ['POST', /^\/api\/metrics$/, async (ctx) => {
      requireCoach(ctx);
      const b = await readBody(ctx.req);
      const name = textField(b.name, { name: 'Name', max: 40 });
      if (!name) throw new HttpError(400, 'Bitte einen Namen angeben');
      const unit = textField(b.unit, { name: 'Einheit', max: 12 }) ?? '';
      const kind = b.kind === 'pr' ? 'pr' : 'number';
      const id = Number(q.insert.run(name, kind === 'pr' ? 'kg' : unit, kind, JSON.stringify(parseCategories(b.categories || []))).lastInsertRowid);
      ctx.res.statusCode = 201;
      return { metric: defRow(q.one.get(id)) };
    }],

    ['PATCH', /^\/api\/metrics\/(\d+)$/, async (ctx, [, id]) => {
      requireCoach(ctx);
      const m = q.one.get(Number(id));
      if (!m) throw new HttpError(404, 'Nicht gefunden');
      const b = await readBody(ctx.req);
      const name = b.name !== undefined ? textField(b.name, { name: 'Name', max: 40 }) : m.name;
      if (!name) throw new HttpError(400, 'Name darf nicht leer sein');
      const unit = b.unit !== undefined ? textField(b.unit, { name: 'Einheit', max: 12 }) ?? '' : m.unit;
      const cats = b.categories !== undefined ? JSON.stringify(parseCategories(b.categories)) : m.categories;
      const active = b.active !== undefined ? (b.active ? 1 : 0) : m.active;
      q.update.run(name, unit, cats, active, m.id);
      return { metric: defRow(q.one.get(m.id)) };
    }],

    ['DELETE', /^\/api\/metrics\/(\d+)$/, async (ctx, [, id]) => {
      requireCoach(ctx);
      q.remove.run(Number(id));
      return { ok: true };
    }],

    // ---- Client data (client: own, coach: ?userId=) ----
    ['GET', /^\/api\/measurements$/, async (ctx) => ({ metrics: measurementsOf(targetClient(ctx)) })],

    ['PUT', /^\/api\/measurements\/(\d+)\/(\d{4}-\d{2}-\d{2})$/, async (ctx, [, metricId, date]) => {
      const u = requireUser(ctx);
      if (u.role !== 'client') throw new HttpError(403, 'Nur Klienten können Werte eintragen');
      const m = requireMetricFor(u, metricId, 'number');
      validDate(date);
      const value = numberField((await readBody(ctx.req)).value, { name: m.name, min: 0, max: 10000 });
      if (value === null || value === undefined) q.deleteValue.run(u.id, m.id, date);
      else q.upsertValue.run(u.id, m.id, date, value);
      return { metrics: measurementsOf(u) };
    }],

    ['POST', /^\/api\/prs$/, async (ctx) => {
      const u = requireUser(ctx);
      if (u.role !== 'client') throw new HttpError(403, 'Nur Klienten können PRs eintragen');
      const b = await readBody(ctx.req);
      const m = requireMetricFor(u, b.metricId, 'pr');
      const date = validDate(b.date || localDate(Date.now(), notifier.timezone));
      const exercise = textField(b.exercise, { name: 'Übung', max: 60 });
      if (!exercise) throw new HttpError(400, 'Bitte die Übung angeben');
      const weight = numberField(b.weight, { name: 'Gewicht', min: 0, max: 1000 });
      const reps = numberField(b.reps, { name: 'Wiederholungen', min: 1, max: 100, integer: true });
      if (weight === null || weight === undefined || !reps) throw new HttpError(400, 'Bitte Gewicht und Wiederholungen angeben');
      const id = Number(q.insertPr.run(u.id, m.id, date, exercise, weight, reps).lastInsertRowid);
      const metrics = measurementsOf(u);
      const saved = metrics.find((x) => x.id === m.id).prs.find((p) => p.id === id);
      if (saved.isRecord && saved.previous) {
        notifier
          .sendToUsers(notifier.coachIds(), {
            title: `💪 Neuer PR von ${u.display_name}`,
            body: `${exercise}: ${weight} kg × ${reps} (vorher ${saved.previous.weight} kg × ${saved.previous.reps})`,
            url: `/#/client/${u.id}`,
          })
          .catch((err) => console.error(err));
      }
      ctx.res.statusCode = 201;
      return { metrics, saved };
    }],

    ['DELETE', /^\/api\/prs\/(\d+)$/, async (ctx, [, id]) => {
      const u = requireUser(ctx);
      const p = q.pr.get(Number(id));
      if (!p || u.role !== 'client' || p.user_id !== u.id) throw new HttpError(404, 'Nicht gefunden');
      q.deletePr.run(p.id);
      return { metrics: measurementsOf(u) };
    }],
  ];

  return { routes, reviewFor, CATEGORIES };
}

module.exports = { metricsModule, CATEGORIES };
