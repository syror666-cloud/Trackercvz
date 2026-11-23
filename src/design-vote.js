'use strict';

/**
 * New look ("club": navy + studio beige) next to the existing one ("classic"), and a vote on which one stays.
 *  - Everyone sees one announcement; the choice of look itself is a personal preference (prefs.design).
 *  - Clients vote once (changeable) with an optional comment; the coach sees the result in the overview.
 *
 *  GET   /api/design-vote          client: own vote
 *  PUT   /api/design-vote          client: { choice: 'club' | 'classic', comment }
 *  GET   /api/design-votes         coach: counts and comments
 *  POST  /api/me/design-intro/seen  anyone: don't show the announcement again
 */

const CHOICES = ['club', 'classic'];

function designVoteRoutes({ db, HttpError, readBody, textField, requireUser, requireCoach, notifier }) {
  const q = {
    mine: db.prepare('SELECT choice, comment, updated_at FROM design_votes WHERE user_id = ?'),
    upsert: db.prepare(`INSERT INTO design_votes (user_id, choice, comment) VALUES (?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET choice = excluded.choice, comment = excluded.comment,
        updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')`),
    all: db.prepare(`SELECT v.choice, v.comment, v.updated_at, u.id, u.display_name FROM design_votes v
      JOIN users u ON u.id = v.user_id WHERE u.role = 'client' ORDER BY v.updated_at DESC, v.user_id DESC`),
    members: db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'client' AND archived_at IS NULL"),
    seen: db.prepare("UPDATE users SET design_intro_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = ? AND design_intro_at IS NULL"),
  };
  const requireClient = (ctx) => {
    const u = requireUser(ctx);
    if (u.role !== 'client') throw new HttpError(403, 'Nur für Klienten');
    return u;
  };
  const voteOut = (v) => (v ? { choice: v.choice, comment: v.comment || '', updatedAt: v.updated_at } : null);

  return [
    ['GET', /^\/api\/design-vote$/, async (ctx) => {
      const u = requireClient(ctx);
      return { vote: voteOut(q.mine.get(u.id)) };
    }],

    ['PUT', /^\/api\/design-vote$/, async (ctx) => {
      const u = requireClient(ctx);
      const body = await readBody(ctx.req);
      if (!CHOICES.includes(body.choice)) throw new HttpError(400, 'Bitte wähle ein Design');
      const comment = textField(body.comment, { name: 'Kommentar', max: 500 }) || null;
      const before = q.mine.get(u.id);
      q.upsert.run(u.id, body.choice, comment);
      // the coach hears about new comments, not about every tap
      if (comment && (!before || before.comment !== comment)) {
        notifier.sendToUsers(notifier.coachIds(), {
          title: `🎨 ${u.display_name}: ${body.choice === 'club' ? 'Neues Design' : 'Bisheriges Design'}`,
          body: comment.length > 120 ? `${comment.slice(0, 117)}…` : comment,
          url: '/#/',
        }).catch(() => {});
      }
      return { vote: voteOut(q.mine.get(u.id)) };
    }],

    ['GET', /^\/api\/design-votes$/, async (ctx) => {
      requireCoach(ctx);
      const rows = q.all.all();
      return {
        club: rows.filter((r) => r.choice === 'club').length,
        classic: rows.filter((r) => r.choice === 'classic').length,
        members: q.members.get().n,
        items: rows.map((r) => ({ clientId: r.id, displayName: r.display_name, choice: r.choice, comment: r.comment || '', updatedAt: r.updated_at })),
      };
    }],

    ['POST', /^\/api\/me\/design-intro\/seen$/, async (ctx) => {
      const u = requireUser(ctx);
      q.seen.run(u.id);
      return { ok: true };
    }],
  ];
}

module.exports = { designVoteRoutes, DESIGN_CHOICES: CHOICES };
