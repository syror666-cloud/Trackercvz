'use strict';

// "Please make me a nutrition plan": a client without a plan answers a short multiple-choice
// questionnaire; the coach gets a push and sees the answers next to the (empty) plan.

const QUESTIONS = [
  { key: 'diet', label: 'Wie ernährst du dich?', type: 'single', required: true, options: [
    ['omni', 'Ich esse alles'], ['pesce', 'Pescetarisch'], ['vegetarian', 'Vegetarisch'], ['vegan', 'Vegan'],
  ] },
  { key: 'avoid', label: 'Was geht nicht?', hint: 'Allergien, Unverträglichkeiten oder einfach „mag ich nicht“', type: 'multi', other: true, options: [
    ['lactose', 'Laktose'], ['gluten', 'Gluten'], ['nuts', 'Nüsse'], ['eggs', 'Eier'], ['seafood', 'Fisch & Meeresfrüchte'],
    ['pork', 'Schweinefleisch'], ['soy', 'Soja'], ['spicy', 'Scharfes'],
  ] },
  { key: 'protein', label: 'Welche Proteinquellen magst du am liebsten?', hint: 'Mehrere möglich', type: 'multi', options: [
    ['beef', 'Rind'], ['chicken', 'Hähnchen'], ['turkey', 'Pute'], ['pork', 'Schwein'], ['fish', 'Fisch'], ['eggs', 'Eier'],
    ['dairy', 'Skyr, Quark & Co.'], ['legumes', 'Hülsenfrüchte'], ['tofu', 'Tofu & Tempeh'], ['shake', 'Proteinshake'],
  ] },
  { key: 'meals', label: 'Wie viele Mahlzeiten am Tag passen in deinen Alltag?', type: 'single', required: true, options: [
    ['2', '2'], ['3', '3'], ['4', '4'], ['5', '5 oder mehr'],
  ] },
  { key: 'budget', label: 'Soll auf das Budget geachtet werden?', type: 'single', required: true, options: [
    ['low', 'Ja, möglichst günstig'], ['normal', 'Normal'], ['none', 'Egal – Qualität zählt'],
  ] },
  { key: 'cooking', label: 'Wie viel Zeit hast du zum Kochen?', type: 'single', required: true, options: [
    ['quick', 'Schnell & einfach (max. 15 Min.)'], ['normal', 'Normal (ca. 30 Min.)'], ['loves', 'Ich koche gerne'],
  ] },
  { key: 'prep', label: 'Vorkochen (Meal Prep)?', type: 'single', options: [
    ['yes', 'Ja, gerne'], ['sometimes', 'Manchmal'], ['no', 'Lieber nicht'],
  ] },
];

function parseAnswers(body, HttpError, textField) {
  const answers = {};
  const input = body && typeof body.answers === 'object' && body.answers ? body.answers : {};
  for (const q of QUESTIONS) {
    const allowed = q.options.map(([k]) => k);
    const v = input[q.key];
    if (q.type === 'single') {
      if (v === undefined || v === null || v === '') {
        if (q.required) throw new HttpError(400, `Bitte beantworten: ${q.label}`);
        continue;
      }
      if (!allowed.includes(v)) throw new HttpError(400, `Ungültige Antwort: ${q.label}`);
      answers[q.key] = v;
    } else {
      const list = Array.isArray(v) ? [...new Set(v)] : [];
      if (list.some((x) => !allowed.includes(x))) throw new HttpError(400, `Ungültige Antwort: ${q.label}`);
      answers[q.key] = list;
    }
  }
  answers.avoidOther = textField(body.avoidOther ?? '', { name: 'Sonstiges', max: 120 }) || '';
  answers.note = textField(body.note ?? '', { name: 'Anmerkung', max: 500 }) || '';
  return answers;
}

function nutritionRequestRoutes({ db, notifier, HttpError, readBody, textField, requireUser, requireCoach, targetClient }) {
  const q = {
    get: db.prepare('SELECT * FROM nutrition_requests WHERE client_id = ?'),
    upsert: db.prepare(
      `INSERT INTO nutrition_requests (client_id, answers) VALUES (?, ?)
       ON CONFLICT(client_id) DO UPDATE SET answers = excluded.answers, status = 'open',
         updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')`
    ),
    done: db.prepare("UPDATE nutrition_requests SET status = 'done', updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE client_id = ?"),
    hasPlan: db.prepare('SELECT 1 FROM meals WHERE client_id = ? LIMIT 1'),
  };
  const view = (clientId) => {
    const r = q.get.get(clientId);
    return {
      questions: QUESTIONS,
      request: r ? { answers: JSON.parse(r.answers), status: r.status, createdAt: r.created_at, updatedAt: r.updated_at } : null,
    };
  };

  return [
    ['GET', /^\/api\/nutrition\/request$/, async (ctx) => view(targetClient(ctx).id)],

    ['PUT', /^\/api\/nutrition\/request$/, async (ctx) => {
      const u = requireUser(ctx);
      if (u.role !== 'client') throw new HttpError(403, 'Nur Klienten können einen Plan anfragen');
      if (q.hasPlan.get(u.id)) throw new HttpError(409, 'Du hast schon einen Ernährungsplan');
      const answers = parseAnswers(await readBody(ctx.req), HttpError, textField);
      const before = q.get.get(u.id);
      q.upsert.run(u.id, JSON.stringify(answers));
      notifier
        .sendToUsers(notifier.coachIds(), {
          title: before && before.status === 'open' ? `🍽 Plan-Anfrage aktualisiert: ${u.display_name}` : `🍽 ${u.display_name} wünscht sich einen Ernährungsplan`,
          body: 'Die Vorlieben findest du beim Klienten unter „Ernährungsplan“.',
          url: `/#/client/${u.id}/nutrition`,
        })
        .catch(() => {});
      return view(u.id);
    }],

    ['POST', /^\/api\/nutrition\/request\/done$/, async (ctx) => {
      requireCoach(ctx);
      const c = targetClient(ctx);
      q.done.run(c.id);
      return view(c.id);
    }],
  ];
}

module.exports = { nutritionRequestRoutes, QUESTIONS, parseAnswers };
