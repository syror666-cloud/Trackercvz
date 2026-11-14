'use strict';

/**
 * Data protection self-service for clients (GDPR Art. 15, 17, 20):
 *  - GET    /api/me/export            everything stored about the client as one JSON file (no secrets)
 *  - POST   /api/me/deletion-request  ask for the account to be deleted (the coach is notified and deletes it)
 *  - DELETE /api/me/deletion-request  withdraw that request
 */

const SECRET_COLUMNS = new Set(['password_hash', 'token_hash', 'refresh_token', 'p256dh', 'auth', 'verifier', 'state_hash', 'avatar', 'showcase']);
const clean = (row) => Object.fromEntries(Object.entries(row).filter(([k]) => !SECRET_COLUMNS.has(k)));

function privacyRoutes({ db, HttpError, readBody, textField, requireUser, notifier, publicUser }) {
  const all = (sql, ...args) => db.prepare(sql).all(...args).map(clean);
  const one = (sql, ...args) => {
    const r = db.prepare(sql).get(...args);
    return r ? clean(r) : null;
  };
  const q = {
    request: db.prepare("UPDATE users SET deletion_requested_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), deletion_reason = ? WHERE id = ?"),
    withdraw: db.prepare('UPDATE users SET deletion_requested_at = NULL, deletion_reason = NULL WHERE id = ?'),
    user: db.prepare('SELECT * FROM users WHERE id = ?'),
  };

  function exportOf(u) {
    const id = u.id;
    const name = (uid) => (db.prepare('SELECT display_name FROM users WHERE id = ?').get(uid) || {}).display_name || null;
    const workouts = all('SELECT * FROM workouts WHERE client_id = ? ORDER BY date', id).map((w) => ({
      ...w, sets: all('SELECT exercise_key, exercise_name, set_no, weight, reps FROM workout_sets WHERE workout_id = ? ORDER BY id', w.id),
    }));
    const meals = all('SELECT * FROM meals WHERE client_id = ? ORDER BY position', id).map((m) => ({
      ...m, items: all('SELECT name, amount, unit, kcal, protein, carbs, fat FROM meal_items WHERE meal_id = ? ORDER BY position', m.id),
    }));
    const profile = clean(q.user.get(id));
    profile.hasProfilePicture = Boolean(q.user.get(id).avatar);
    return {
      about: 'Alle Daten, die StayOnTrack über dein Konto speichert. Passwörter und Zugangsschlüssel sind nicht enthalten.',
      exportedAt: new Date().toISOString(),
      profile,
      goals: one('SELECT * FROM goals WHERE user_id = ?', id),
      goalHistory: all('SELECT * FROM goal_history WHERE user_id = ? ORDER BY id', id),
      macroGoals: one('SELECT * FROM macro_goals WHERE user_id = ?', id),
      entries: all('SELECT * FROM entries WHERE user_id = ? ORDER BY date', id),
      measurements: all(`SELECT v.date, m.name, m.unit, v.value FROM metric_values v JOIN metrics m ON m.id = v.metric_id
        WHERE v.user_id = ? ORDER BY v.date`, id),
      personalBests: all('SELECT * FROM prs WHERE user_id = ? ORDER BY date', id),
      foodDiary: all('SELECT * FROM food_log WHERE client_id = ? ORDER BY date, id', id),
      nutritionPlan: meals,
      nutritionPlanRequest: one('SELECT * FROM nutrition_requests WHERE client_id = ?', id),
      swapRequests: all('SELECT * FROM swap_requests WHERE client_id = ? ORDER BY id', id),
      trainingPlan: one('SELECT * FROM training_plans WHERE client_id = ?', id),
      workouts,
      checkins: all('SELECT * FROM checkins WHERE client_id = ? ORDER BY id', id),
      messages: all('SELECT * FROM messages WHERE client_id = ? ORDER BY id', id).map((m) => ({ ...m, from: name(m.sender_id) })),
      aiSummariesForYourCoach: all('SELECT kind, content, model, created_at FROM ai_results WHERE client_id = ?', id),
      fridge: all('SELECT flavor, cost, bought_at FROM fridge_items WHERE client_id = ? ORDER BY id', id),
      head2head: all('SELECT * FROM h2h_challenges WHERE challenger_id = ? OR opponent_id = ? ORDER BY id', id, id).map((c) => ({
        ...c, challenger: name(c.challenger_id), opponent: name(c.opponent_id),
      })),
      googleHealth: one('SELECT scopes, connected_at, last_sync_at, last_error FROM google_links WHERE user_id = ?', id),
      pushDevices: all('SELECT user_agent, created_at, last_success_at FROM push_subscriptions WHERE user_id = ?', id),
      pushConsent: one('SELECT * FROM push_consent WHERE user_id = ?', id),
      logins: all('SELECT created_at FROM logins WHERE user_id = ? ORDER BY id', id).map((l) => l.created_at),
      daysActive: all('SELECT date FROM activity_days WHERE user_id = ? ORDER BY date', id).map((d) => d.date),
    };
  }

  function requireClient(ctx) {
    const u = requireUser(ctx);
    if (u.role !== 'client') throw new HttpError(403, 'Nur für Klienten');
    return u;
  }

  return [
    ['GET', /^\/api\/me\/export$/, async (ctx) => {
      const u = requireClient(ctx);
      const body = Buffer.from(JSON.stringify(exportOf(u), null, 2));
      ctx.res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="stayontrack-daten-${u.username}-${new Date().toISOString().slice(0, 10)}.json"`,
        'Content-Length': body.length,
        'Cache-Control': 'no-store',
      });
      ctx.res.end(body);
      return undefined;
    }],

    ['POST', /^\/api\/me\/deletion-request$/, async (ctx) => {
      const u = requireClient(ctx);
      const reason = textField((await readBody(ctx.req)).reason, { name: 'Grund', max: 500 }) ?? null;
      const first = !u.deletion_requested_at;
      q.request.run(reason, u.id);
      if (first) {
        notifier.sendToUsers(notifier.coachIds(), {
          title: 'Löschung beantragt',
          body: `${u.display_name} möchte, dass das Konto gelöscht wird.`,
          url: `/#/client/${u.id}`,
        }).catch(() => {});
      }
      return { user: publicUser(q.user.get(u.id)) };
    }],

    ['DELETE', /^\/api\/me\/deletion-request$/, async (ctx) => {
      const u = requireClient(ctx);
      q.withdraw.run(u.id);
      return { user: publicUser(q.user.get(u.id)) };
    }],
  ];
}

module.exports = { privacyRoutes, SECRET_COLUMNS };
