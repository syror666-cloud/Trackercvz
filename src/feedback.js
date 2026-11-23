'use strict';

/**
 * Wishes & ideas from the members.
 *  - Clients see a thank-you screen once (with their own numbers) and can send a wish or idea; later from "Mehr".
 *  - Every message lands as a to-do in the coach portal (push, and Telegram if linked) until marked done.
 *
 *  POST  /api/feedback              client: { body }
 *  GET   /api/feedback              coach: open and recently done
 *  PATCH /api/feedback/:id          coach: { done }
 *  GET   /api/thanks                client: numbers for the thank-you screen
 *  POST  /api/thanks/seen           client: don't show the thank-you screen again
 */

const MAX_PER_DAY = 5;

function feedbackRoutes({ db, HttpError, readBody, textField, requireUser, requireCoach, notifier }) {
  const q = {
    insert: db.prepare('INSERT INTO feedback (client_id, body) VALUES (?, ?)'),
    byId: db.prepare('SELECT * FROM feedback WHERE id = ?'),
    today: db.prepare("SELECT COUNT(*) AS n FROM feedback WHERE client_id = ? AND created_at >= strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-1 day')"),
    list: db.prepare(`SELECT f.*, u.display_name, u.avatar IS NOT NULL AS has_avatar, u.avatar_updated FROM feedback f
      JOIN users u ON u.id = f.client_id
      WHERE f.done_at IS NULL OR f.done_at >= strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-30 days')
      ORDER BY f.done_at IS NOT NULL, f.id DESC LIMIT 200`),
    setDone: db.prepare("UPDATE feedback SET done_at = CASE WHEN ? THEN strftime('%Y-%m-%dT%H:%M:%SZ', 'now') ELSE NULL END WHERE id = ?"),
    seen: db.prepare("UPDATE users SET thanks_seen_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = ?"),
    mine: db.prepare(`SELECT
        (SELECT COUNT(*) FROM entries WHERE user_id = ?) AS days,
        (SELECT COUNT(*) FROM workouts WHERE client_id = ?) AS workouts,
        (SELECT COUNT(*) FROM food_log WHERE client_id = ?) AS foods`),
    all: db.prepare(`SELECT
        (SELECT COUNT(*) FROM users WHERE role = 'client') AS members,
        (SELECT COUNT(*) FROM entries) AS days,
        (SELECT COUNT(*) FROM workouts) AS workouts`),
  };

  const row = (f) => ({
    id: f.id, clientId: f.client_id, displayName: f.display_name, body: f.body, createdAt: f.created_at, doneAt: f.done_at,
    avatar: f.has_avatar ? `/api/avatar/${f.client_id}?v=${encodeURIComponent(f.avatar_updated || '1')}` : null,
  });
  const requireClient = (ctx) => {
    const u = requireUser(ctx);
    if (u.role !== 'client') throw new HttpError(403, 'Nur für Klienten');
    return u;
  };

  return [
    ['POST', /^\/api\/feedback$/, async (ctx) => {
      const u = requireClient(ctx);
      const body = textField((await readBody(ctx.req)).body, { name: 'Nachricht', max: 2000 });
      if (!body) throw new HttpError(400, 'Bitte schreib kurz deinen Wunsch oder deine Idee');
      if (q.today.get(u.id).n >= MAX_PER_DAY) throw new HttpError(429, 'Danke! Für heute ist genug angekommen – morgen gern mehr.');
      const id = Number(q.insert.run(u.id, body).lastInsertRowid);
      q.seen.run(u.id);
      notifier.sendToUsers(notifier.coachIds(), {
        title: `💡 Wunsch von ${u.display_name}`,
        body: body.length > 120 ? `${body.slice(0, 117)}…` : body,
        url: '/#/',
      }).catch(() => {});
      ctx.res.statusCode = 201;
      return { feedback: { id, body } };
    }],

    ['GET', /^\/api\/feedback$/, async (ctx) => {
      requireCoach(ctx);
      const items = q.list.all().map(row);
      return { items, open: items.filter((i) => !i.doneAt).length };
    }],

    ['PATCH', /^\/api\/feedback\/(\d+)$/, async (ctx, [, id]) => {
      requireCoach(ctx);
      const f = q.byId.get(Number(id));
      if (!f) throw new HttpError(404, 'Nicht gefunden');
      const { done } = await readBody(ctx.req);
      if (typeof done !== 'boolean') throw new HttpError(400, 'Ungültiger Wert');
      q.setDone.run(done ? 1 : 0, f.id);
      return { ok: true };
    }],

    ['GET', /^\/api\/thanks$/, async (ctx) => {
      const u = requireClient(ctx);
      const m = q.mine.get(u.id, u.id, u.id);
      const a = q.all.get();
      return { mine: { days: m.days, workouts: m.workouts, foods: m.foods }, community: { members: a.members, days: a.days, workouts: a.workouts } };
    }],

    ['POST', /^\/api\/thanks\/seen$/, async (ctx) => {
      const u = requireClient(ctx);
      q.seen.run(u.id);
      return { ok: true };
    }],
  ];
}

module.exports = { feedbackRoutes };
