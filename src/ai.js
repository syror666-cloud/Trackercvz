'use strict';

// AI helpers for the coach (Claude API via the official Anthropic SDK):
//  - check-in summary: generated only when the coach asks for it, then stored (no automatic refresh)
//  - nutrition plan draft: built from the client's preferences, the plan targets and the food database;
//    the coach reviews and edits it, and only then sends it to the client.
// Switched on by setting ANTHROPIC_API_KEY. AI_MODEL picks the model (default claude-opus-5-5,
// e.g. AI_MODEL=claude-haiku-5-5 for the cheapest option). Client names are never sent to the API.

const Anthropic = require('@anthropic-ai/sdk');
const { weekComparison } = require('./weekstats');
const { QUESTIONS } = require('./nutrition-request');

const DEFAULT_MODEL = 'claude-opus-5-5';
// Models that support the server-side refusal fallback (on a decline the API retries on another model)
const FALLBACK_MODELS = ['claude-opus-5-5', 'claude-opus-5', 'claude-sonnet-5-5', 'claude-fable-5-2', 'claude-fable-5-1'];

const SUMMARY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['overview', 'positives', 'concerns', 'suggestions', 'lookCloser'],
  properties: {
    overview: { type: 'string', description: '2–3 Sätze: wie lief die Woche insgesamt' },
    positives: { type: 'array', items: { type: 'string' }, description: 'Was gut lief (max. 4 kurze Punkte)' },
    concerns: { type: 'array', items: { type: 'string' }, description: 'Auffälligkeiten oder Probleme (max. 4)' },
    suggestions: { type: 'array', items: { type: 'string' }, description: 'Konkrete Vorschläge für den Check-in (max. 4)' },
    lookCloser: { type: 'array', items: { type: 'string' }, description: 'Wo der Coach genauer in die Daten schauen sollte (max. 3)' },
  },
};

// Meal types in the order of the day. The model has to say which type each meal is, which keeps
// e.g. a warm main course out of breakfast; the plan is sorted by this order.
const MEAL_TYPES = ['fruehstueck', 'snack_vormittag', 'mittagessen', 'snack_nachmittag', 'pre_workout', 'post_workout', 'abendessen', 'spaetmahlzeit'];

// Rules for the nutrition draft. The coach can change them in the admin tool (stored in settings).
const DEFAULT_GUIDELINES = [
  'Frühstück: typische Frühstückszutaten – z. B. Haferflocken oder Müsli, Brot oder Brötchen, Eier, Skyr, Quark oder Joghurt, Obst, etwas Aufstrich. Kein warmes Hauptgericht: kein Reis, keine Kartoffeln oder Nudeln, kein Fleisch oder Fisch mit Gemüsebeilage.',
  'Mittagessen: vollwertige Hauptmahlzeit aus einer Proteinquelle (Fleisch, Fisch, Eier, Tofu, Hülsenfrüchte), einer Beilage (Reis, Kartoffeln, Nudeln oder Brot) und Gemüse.',
  'Abendessen: Hauptmahlzeit wie mittags oder eine kalte Variante (z. B. Brot mit Belag, Salat mit Eiern oder Hähnchen).',
  'Snacks: klein und unkompliziert – z. B. Obst, Skyr, Quark oder Joghurt, eine Handvoll Nüsse, Proteinshake, Reiswaffeln. Keine kompletten Mahlzeiten.',
  'Vor dem Training leicht verdaulich (Kohlenhydrate, wenig Fett), danach Protein plus Kohlenhydrate.',
  'Pro Mahlzeit 2–5 Lebensmittel in alltagstauglichen Portionen; Mahlzeiten in der Reihenfolge des Tages und mit passenden Namen.',
].join('\n');

const DRAFT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['meals', 'notes'],
  properties: {
    meals: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['type', 'name', 'items'],
        properties: {
          type: { type: 'string', enum: MEAL_TYPES, description: 'Art der Mahlzeit – bestimmt, welche Lebensmittel passen' },
          name: { type: 'string', description: 'Deutscher Name, z. B. Frühstück, Mittagessen, Snack' },
          items: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['foodId', 'amount'],
              properties: { foodId: { type: 'integer' }, amount: { type: 'number' } },
            },
          },
        },
      },
    },
    notes: { type: 'string', description: 'Kurze Begründung für den Coach (2–4 Sätze)' },
  },
};

function aiRoutes({ db, notifier, HttpError, readBody, requireCoach, targetClient, localDate, aiClient }) {
  // aiClient: an Anthropic client injected by tests; otherwise one is created from ANTHROPIC_API_KEY
  const enabled = () => Boolean(aiClient || process.env.ANTHROPIC_API_KEY);
  const model = () => process.env.AI_MODEL || DEFAULT_MODEL;
  let client = null;
  const api = () => aiClient || (client ||= new Anthropic()); // reads ANTHROPIC_API_KEY

  const q = {
    entries: db.prepare('SELECT * FROM entries WHERE user_id = ? AND date >= ? ORDER BY date'),
    goals: db.prepare('SELECT * FROM goals WHERE user_id = ?'),
    user: db.prepare('SELECT category FROM users WHERE id = ?'),
    workouts: db.prepare(
      `SELECT w.date, w.day_name, COUNT(s.id) AS sets, SUM(COALESCE(s.weight, 0) * COALESCE(s.reps, 0)) AS volume
       FROM workouts w LEFT JOIN workout_sets s ON s.workout_id = w.id
       WHERE w.client_id = ? AND w.date >= ? GROUP BY w.id ORDER BY w.date`
    ),
    lastCheckin: db.prepare('SELECT message, status, created_at, proposal FROM checkins WHERE client_id = ? ORDER BY id DESC LIMIT 1'),
    request: db.prepare('SELECT * FROM nutrition_requests WHERE client_id = ?'),
    foods: db.prepare('SELECT id, name, kcal, unit, category FROM foods ORDER BY category, name'),
    food: db.prepare('SELECT * FROM foods WHERE id = ?'),
    hasPlan: db.prepare('SELECT 1 FROM meals WHERE client_id = ? LIMIT 1'),
    getSetting: db.prepare('SELECT value FROM settings WHERE key = ?'),
    setSetting: db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'),
    delSetting: db.prepare('DELETE FROM settings WHERE key = ?'),
    getSummary: db.prepare("SELECT * FROM ai_results WHERE client_id = ? AND kind = 'checkin'"),
    getDraft: db.prepare("SELECT * FROM ai_results WHERE client_id = ? AND kind = 'nutrition'"),
    save: db.prepare(
      `INSERT INTO ai_results (client_id, kind, content, model) VALUES (?, ?, ?, ?)
       ON CONFLICT(client_id, kind) DO UPDATE SET content = excluded.content, model = excluded.model,
         created_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')`
    ),
    drop: db.prepare('DELETE FROM ai_results WHERE client_id = ? AND kind = ?'),
    maxMealPos: db.prepare('SELECT COALESCE(MAX(position), -1) AS p FROM meals WHERE client_id = ?'),
    insertMeal: db.prepare('INSERT INTO meals (client_id, name, position) VALUES (?, ?, ?)'),
    insertItem: db.prepare('INSERT INTO meal_items (meal_id, food_id, name, kcal, unit, amount, position) VALUES (?, ?, ?, ?, ?, ?, ?)'),
    requestDone: db.prepare("UPDATE nutrition_requests SET status = 'done' WHERE client_id = ?"),
  };

  /** One structured request to Claude; returns the parsed JSON object. */
  async function ask(system, user, schema, maxTokens) {
    if (!enabled()) throw new HttpError(503, 'KI ist nicht eingerichtet (ANTHROPIC_API_KEY fehlt)');
    const m = model();
    const params = {
      model: m,
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: user }],
      output_config: { effort: process.env.AI_EFFORT || 'medium', format: { type: 'json_schema', schema } },
    };
    let res;
    try {
      res = FALLBACK_MODELS.includes(m)
        ? await api().beta.messages.create({ ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' })
        : await api().messages.create(params);
    } catch (err) {
      if (err instanceof Anthropic.AuthenticationError) throw new HttpError(502, 'KI: API-Schlüssel ungültig');
      if (err instanceof Anthropic.RateLimitError) throw new HttpError(503, 'KI ist gerade ausgelastet – bitte gleich nochmal versuchen');
      if (err instanceof Anthropic.BadRequestError) throw new HttpError(502, `KI-Anfrage abgelehnt: ${err.message}`);
      if (err instanceof Anthropic.APIError) throw new HttpError(502, 'KI ist gerade nicht erreichbar');
      throw err;
    }
    if (res.stop_reason === 'refusal') throw new HttpError(502, 'Die KI hat diese Anfrage abgelehnt');
    if (res.stop_reason === 'max_tokens') throw new HttpError(502, 'Die KI-Antwort war zu lang – bitte nochmal versuchen');
    const text = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
    try {
      return { data: JSON.parse(text), model: res.model };
    } catch {
      throw new HttpError(502, 'Die KI-Antwort war unvollständig – bitte nochmal versuchen');
    }
  }

  // ---------- check-in summary ----------
  function clientData(clientId) {
    const today = localDate(Date.now(), notifier.timezone);
    const since = new Date(Date.parse(`${today}T00:00:00Z`) - 27 * 86400000).toISOString().slice(0, 10);
    const entries = q.entries.all(clientId, since);
    const g = q.goals.get(clientId) || {};
    const goals = {
      targetWeight: g.target_weight ?? null, stepsGoal: g.steps_goal ?? null, sleepGoal: g.sleep_goal ?? null,
      caloriesMin: g.calories_min ?? null, caloriesMax: g.calories_max ?? null,
    };
    const week = weekComparison(entries, today, goals);
    const last = q.lastCheckin.get(clientId);
    return {
      today,
      category: (q.user.get(clientId) || {}).category || null,
      goals,
      thisWeek: week.current,
      previousWeek: week.previous,
      last14Days: week.days,
      weightLast28Days: entries.filter((e) => e.weight !== null).map((e) => ({ date: e.date, weight: e.weight })),
      workoutsLast28Days: q.workouts.all(clientId, since).map((w) => ({ date: w.date, day: w.day_name, sets: w.sets, volumeKg: Math.round(w.volume || 0) })),
      lastCheckin: last ? { date: last.created_at.slice(0, 10), status: last.status, message: last.message, proposal: JSON.parse(last.proposal || '{}') } : null,
    };
  }

  const summaryView = (row) => (row ? { ...JSON.parse(row.content), createdAt: row.created_at, model: row.model } : null);

  // ---------- nutrition draft ----------
  const guidelines = () => (q.getSetting.get('ai_guidelines') || {}).value || DEFAULT_GUIDELINES;

  function resolveDraft(draft) {
    const meals = [];
    const order = (m) => (MEAL_TYPES.includes(m.type) ? MEAL_TYPES.indexOf(m.type) : MEAL_TYPES.length);
    const sorted = (draft.meals || []).slice(0, 8).map((m, i) => ({ m, i })).sort((a, b) => order(a.m) - order(b.m) || a.i - b.i).map((x) => x.m);
    for (const m of sorted) {
      const items = [];
      for (const it of (m.items || []).slice(0, 12)) {
        const f = q.food.get(Number(it.foodId));
        const amount = Math.round(Number(it.amount));
        if (!f || !(amount > 0) || amount > 2000) continue; // unknown foods or odd amounts are dropped
        items.push({ foodId: f.id, name: f.name, unit: f.unit, kcal: f.kcal, amount, kcalTotal: Math.round((amount * f.kcal) / 100) });
      }
      const name = String(m.name || '').trim().slice(0, 60) || `Mahlzeit ${meals.length + 1}`;
      if (items.length) meals.push({ type: MEAL_TYPES.includes(m.type) ? m.type : null, name, items, kcalTotal: items.reduce((a, i) => a + i.kcalTotal, 0) });
    }
    return { meals, notes: String(draft.notes || '').slice(0, 800), kcalTotal: meals.reduce((a, m) => a + m.kcalTotal, 0) };
  }

  async function makeDraft(clientId, hint = '') {
    const g = q.goals.get(clientId) || {};
    const r = q.request.get(clientId);
    const answers = r ? JSON.parse(r.answers) : null;
    const label = (qq, v) => (qq.options.find(([k]) => k === v) || [v, v])[1];
    const prefs = answers
      ? QUESTIONS.map((qq) => {
        const v = qq.type === 'single' ? (answers[qq.key] ? label(qq, answers[qq.key]) : '–') : (answers[qq.key] || []).map((x) => label(qq, x)).join(', ') || '–';
        return `${qq.label} ${v}${qq.key === 'avoid' && answers.avoidOther ? `, ${answers.avoidOther}` : ''}`;
      }).join('\n') + (answers.note ? `\nAnmerkung: ${answers.note}` : '')
      : 'Keine Angaben.';
    const target = g.calories_min && g.calories_max
      ? `${g.calories_min}–${g.calories_max} kcal pro Tag (Ziel: Mitte der Range)`
      : 'keine Vorgabe – plane für ein moderates Kaloriendefizit eines durchschnittlichen Erwachsenen (ca. 2000 kcal)';
    const foods = q.foods.all().map((f) => `${f.id}|${f.name}|${f.kcal} kcal/100${f.unit}|${f.category}`).join('\n');
    const system =
      'Du hilfst einem Fitness- und Ernährungscoach, einen Tages-Ernährungsplan für einen Klienten zu entwerfen. ' +
      'Der Coach prüft und ändert den Entwurf, bevor der Klient ihn sieht. Verwende ausschließlich Lebensmittel aus der ' +
      'Datenbank (foodId = erste Spalte); Mengen in Gramm bzw. ml. Halte dich strikt an das Kalorienziel (±5 %) ' +
      'und an alles, was der Klient nicht essen kann oder will. Achte auf ausreichend Protein (ca. 1,8–2 g pro kg ' +
      'Körpergewicht, falls bekannt), alltagstaugliche Mahlzeiten mit deutschen Namen und die gewünschte Mahlzeitenzahl. ' +
      'Jede Mahlzeit muss zu ihrer Tageszeit passen: Wähle für jede Mahlzeit zuerst den Typ und dann nur Lebensmittel, ' +
      'die man zu dieser Mahlzeit typischerweise isst.\n\nVorgaben des Coaches (unbedingt einhalten, sie haben Vorrang):\n' + guidelines();
    const user = `Kalorienziel: ${target}\nKategorie: ${(q.user.get(clientId) || {}).category || 'keine'}\n\nVorlieben des Klienten:\n${prefs}` +
      (hint ? `\n\nZusätzlicher Hinweis des Coaches für diesen Entwurf: ${hint}` : '') +
      `\n\nLebensmittel-Datenbank (id|Name|kcal|Kategorie):\n${foods}`;
    const { data, model: used } = await ask(system, user, DRAFT_SCHEMA, 8000);
    const draft = resolveDraft(data);
    if (!draft.meals.length) throw new HttpError(502, 'Die KI hat keinen brauchbaren Entwurf geliefert – bitte nochmal versuchen');
    q.save.run(clientId, 'nutrition', JSON.stringify(draft), used);
    return draft;
  }

  const draftView = (row) => (row ? { ...JSON.parse(row.content), createdAt: row.created_at, model: row.model } : null);

  /** Called when a client sends a plan request: prepare a draft in the background (AI_AUTO_DRAFT=false turns it off). */
  // A client can save the plan request as often as they like; automatic (paid) drafts are limited to one per
  // client every AUTO_DRAFT_INTERVAL_MS, and never run while one is still in progress. The coach's own
  // "Neu erstellen" button is not limited.
  const AUTO_DRAFT_INTERVAL_MS = Number(process.env.AI_AUTO_DRAFT_MINUTES || 30) * 60 * 1000;
  const lastAutoDraft = new Map(); // clientId -> start time of the last automatic draft
  const runningDrafts = new Set();

  function autoDraft(clientId, clientName) {
    if (!enabled() || process.env.AI_AUTO_DRAFT === 'false' || q.hasPlan.get(clientId)) return;
    const now = Date.now();
    if (runningDrafts.has(clientId) || now - (lastAutoDraft.get(clientId) || 0) < AUTO_DRAFT_INTERVAL_MS) return;
    const existing = q.getDraft.get(clientId);
    if (existing && now - Date.parse(existing.created_at) < AUTO_DRAFT_INTERVAL_MS) return;
    lastAutoDraft.set(clientId, now);
    runningDrafts.add(clientId);
    makeDraft(clientId)
      .then(() => notifier.sendToUsers(notifier.coachIds(), {
        title: '🤖 KI-Entwurf bereit', body: `Ernährungsplan-Entwurf für ${clientName} – bitte prüfen.`, url: `/#/client/${clientId}/nutrition`,
      }))
      .catch((err) => console.error('KI-Entwurf fehlgeschlagen:', err.message))
      .finally(() => runningDrafts.delete(clientId));
  }

  const routes = [
    ['GET', /^\/api\/ai\/status$/, async (ctx) => {
      requireCoach(ctx);
      return { enabled: enabled(), model: model() };
    }],

    // The coach's rules for nutrition drafts (admin tool). Empty text = back to the defaults.
    ['GET', /^\/api\/ai\/guidelines$/, async (ctx) => {
      requireCoach(ctx);
      return { guidelines: guidelines(), defaults: DEFAULT_GUIDELINES, custom: Boolean(q.getSetting.get('ai_guidelines')) };
    }],
    ['PUT', /^\/api\/ai\/guidelines$/, async (ctx) => {
      requireCoach(ctx);
      const { guidelines: text } = await readBody(ctx.req);
      if (typeof text !== 'string' || text.length > 4000) throw new HttpError(400, 'Vorgaben: maximal 4000 Zeichen');
      if (!text.trim() || text.trim() === DEFAULT_GUIDELINES) q.delSetting.run('ai_guidelines');
      else q.setSetting.run('ai_guidelines', text.trim());
      return { guidelines: guidelines(), defaults: DEFAULT_GUIDELINES, custom: Boolean(q.getSetting.get('ai_guidelines')) };
    }],

    ['GET', /^\/api\/ai\/checkin-summary$/, async (ctx) => {
      requireCoach(ctx);
      return { enabled: enabled(), summary: summaryView(q.getSummary.get(targetClient(ctx).id)) };
    }],
    // only on request – the stored summary is not refreshed automatically
    ['POST', /^\/api\/ai\/checkin-summary$/, async (ctx) => {
      requireCoach(ctx);
      const c = targetClient(ctx);
      const system =
        'Du bist Assistent eines Fitness- und Ernährungscoaches. Fasse die Daten eines Klienten für den wöchentlichen ' +
        'Check-in auf Deutsch zusammen, knapp und konkret, mit Zahlen. Nur aus den Daten schließen, nichts erfinden, ' +
        'keine medizinischen Diagnosen. Leere Felder (null) bedeuten: nicht eingetragen.';
      const { data, model: used } = await ask(system, `Daten (JSON):\n${JSON.stringify(clientData(c.id))}`, SUMMARY_SCHEMA, 4000);
      q.save.run(c.id, 'checkin', JSON.stringify(data), used);
      return { enabled: true, summary: summaryView(q.getSummary.get(c.id)) };
    }],

    ['GET', /^\/api\/ai\/nutrition-draft$/, async (ctx) => {
      requireCoach(ctx);
      return { enabled: enabled(), draft: draftView(q.getDraft.get(targetClient(ctx).id)) };
    }],
    ['POST', /^\/api\/ai\/nutrition-draft$/, async (ctx) => {
      requireCoach(ctx);
      const c = targetClient(ctx);
      const body = await readBody(ctx.req).catch(() => ({}));
      const hint = typeof body.hint === 'string' ? body.hint.trim().slice(0, 300) : '';
      await makeDraft(c.id, hint);
      return { enabled: true, draft: draftView(q.getDraft.get(c.id)) };
    }],
    ['DELETE', /^\/api\/ai\/nutrition-draft$/, async (ctx) => {
      requireCoach(ctx);
      q.drop.run(targetClient(ctx).id, 'nutrition');
      return { enabled: enabled(), draft: null };
    }],
    // The coach approved (and possibly edited) the draft: it becomes the client's plan.
    ['POST', /^\/api\/ai\/nutrition-draft\/apply$/, async (ctx) => {
      requireCoach(ctx);
      const c = targetClient(ctx);
      if (q.hasPlan.get(c.id)) throw new HttpError(409, 'Der Klient hat schon einen Plan – den Entwurf bitte von Hand übernehmen');
      const body = await readBody(ctx.req);
      const draft = resolveDraft({ meals: Array.isArray(body.meals) ? body.meals : [], notes: '' });
      if (!draft.meals.length) throw new HttpError(400, 'Der Entwurf ist leer');
      db.exec('BEGIN');
      try {
        draft.meals.forEach((m) => {
          const mealId = Number(q.insertMeal.run(c.id, m.name, q.maxMealPos.get(c.id).p + 1).lastInsertRowid);
          m.items.forEach((it, ii) => q.insertItem.run(mealId, it.foodId, it.name, it.kcal, it.unit, it.amount, ii));
        });
        q.requestDone.run(c.id);
        q.drop.run(c.id, 'nutrition');
        db.exec('COMMIT');
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
      notifier.sendToUsers([c.id], { title: '🍽 Dein Ernährungsplan ist da', body: 'Dein Coach hat dir deinen Plan erstellt.', url: '/#/nutrition' }).catch(() => {});
      return { ok: true, meals: draft.meals.length };
    }],
  ];

  return { routes, autoDraft };
}

module.exports = { aiRoutes, SUMMARY_SCHEMA, DRAFT_SCHEMA, DEFAULT_GUIDELINES, MEAL_TYPES };
