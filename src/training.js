'use strict';

// Training plan (shared by client and coach), logged workouts and per-exercise history.

const { SPLITS, CUSTOM, buildPlan, EXERCISES, splitInfo } = require('./training-templates');

/** Exercises are matched by name across plan edits: "Bankdrücken " and "bankdrücken" are the same lift. */
const exerciseKey = (name) => name.trim().toLowerCase().replace(/\s+/g, ' ');

function trainingRoutes({ db, notifier, HttpError, readBody, textField, numberField, requireUser, targetClient, isValidDate, maxAllowedDate }) {
  const q = {
    plan: db.prepare('SELECT * FROM training_plans WHERE client_id = ?'),
    upsertPlan: db.prepare(
      `INSERT INTO training_plans (client_id, split, days_per_week, data, updated_by) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(client_id) DO UPDATE SET split = excluded.split, days_per_week = excluded.days_per_week,
         data = excluded.data, updated_by = excluded.updated_by, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')`
    ),
    deletePlan: db.prepare('DELETE FROM training_plans WHERE client_id = ?'),
    user: db.prepare('SELECT id, display_name, role FROM users WHERE id = ?'),
    workout: db.prepare('SELECT id FROM workouts WHERE client_id = ? AND date = ? AND day_id = ?'),
    insertWorkout: db.prepare('INSERT INTO workouts (client_id, date, day_id, day_name) VALUES (?, ?, ?, ?)'),
    renameWorkout: db.prepare('UPDATE workouts SET day_name = ? WHERE id = ?'),
    deleteWorkout: db.prepare('DELETE FROM workouts WHERE id = ?'),
    clearSets: db.prepare('DELETE FROM workout_sets WHERE workout_id = ? AND exercise_key = ?'),
    insertSet: db.prepare(
      'INSERT INTO workout_sets (workout_id, exercise_key, exercise_name, set_no, weight, reps) VALUES (?, ?, ?, ?, ?, ?)'
    ),
    countSets: db.prepare('SELECT COUNT(*) AS n FROM workout_sets WHERE workout_id = ?'),
    allSets: db.prepare(
      `SELECT s.exercise_key, s.exercise_name, s.set_no, s.weight, s.reps, w.id AS workout_id, w.date, w.day_name
       FROM workout_sets s JOIN workouts w ON w.id = s.workout_id
       WHERE w.client_id = ? ORDER BY w.date, w.id, s.set_no`
    ),
    recentWorkouts: db.prepare(
      `SELECT w.id, w.date, w.day_id, w.day_name, COUNT(s.id) AS sets
       FROM workouts w LEFT JOIN workout_sets s ON s.workout_id = w.id
       WHERE w.client_id = ? GROUP BY w.id ORDER BY w.date DESC, w.id DESC LIMIT 10`
    ),
  };

  // ---- validation ----
  function parsePlan(body) {
    const split = typeof body.split === 'string' && [...SPLITS, CUSTOM].some((s) => s.key === body.split) ? body.split : null;
    if (!split) throw new HttpError(400, 'Unbekannter Split');
    if (!Array.isArray(body.days) || body.days.length < 1 || body.days.length > 7) {
      throw new HttpError(400, 'Ein Plan hat 1 bis 7 Trainingstage');
    }
    const days = body.days.map((d, i) => {
      if (!d || typeof d !== 'object') throw new HttpError(400, 'Ungültiger Trainingstag');
      const name = textField(d.name, { name: `Tag ${i + 1}`, max: 40 }) || `Tag ${i + 1}`;
      const list = Array.isArray(d.exercises) ? d.exercises : [];
      if (list.length > 20) throw new HttpError(400, `${name}: maximal 20 Übungen`);
      const exercises = list
        .map((e) => ({
          id: typeof e.id === 'string' && /^[\w-]{1,40}$/.test(e.id) ? e.id : `e${Math.random().toString(36).slice(2, 10)}`,
          name: textField(e.name, { name: 'Übung', max: 60 }),
          sets: numberField(e.sets ?? 3, { name: 'Sätze', min: 1, max: 10, integer: true }) ?? 3,
          reps: textField(String(e.reps ?? ''), { name: 'Wiederholungen', max: 12 }) || '',
          note: textField(e.note ?? '', { name: 'Notiz', max: 120 }) || '',
        }))
        .filter((e) => e.name);
      return { id: typeof d.id === 'string' && /^[\w-]{1,40}$/.test(d.id) ? d.id : `d${i}${Date.now().toString(36)}`, name, exercises };
    });
    if (new Set(days.map((d) => d.id)).size !== days.length) throw new HttpError(400, 'Doppelte Trainingstage');
    return { split, days };
  }

  /** Sets of the most recent workout per exercise – shown as starting values in the next session. */
  function lastValues(clientId) {
    const last = {};
    for (const s of q.allSets.all(clientId)) {
      const cur = last[s.exercise_key];
      if (!cur || cur.workoutId !== s.workout_id) {
        if (cur && cur.date > s.date) continue;
        last[s.exercise_key] = { workoutId: s.workout_id, date: s.date, sets: [] };
      }
      last[s.exercise_key].sets.push({ weight: s.weight, reps: s.reps });
    }
    for (const k in last) delete last[k].workoutId;
    return last;
  }

  function planOf(clientId) {
    const row = q.plan.get(clientId);
    const editor = row && row.updated_by ? q.user.get(row.updated_by) : null;
    return {
      plan: row
        ? {
            split: row.split,
            splitName: ([...SPLITS, CUSTOM].find((s) => s.key === row.split) || CUSTOM).name,
            daysPerWeek: row.days_per_week,
            days: JSON.parse(row.data),
            updatedAt: row.updated_at,
            updatedBy: editor ? { name: editor.display_name, role: editor.role } : null,
          }
        : null,
      splits: splitInfo(),
      exercises: EXERCISES,
      last: lastValues(clientId),
      recent: q.recentWorkouts.all(clientId).map((w) => ({ id: w.id, date: w.date, dayId: w.day_id, dayName: w.day_name, sets: w.sets })),
    };
  }

  function notifyOther(actor, client, title, body) {
    const toClient = actor.role === 'coach';
    const ids = toClient ? [client.id] : notifier.coachIds();
    if (!ids.length) return;
    notifier
      .sendToUsers(ids, { title, body, url: toClient ? '/#/training' : `/#/client/${client.id}/training` })
      .catch(() => {});
  }

  // Rest timer: if the app is in the background when the break ends, a push says so. The app cancels it when it
  // is open and rings itself; the push leaves 2 s later to give it the time.
  const restTimers = new Map(); // userId -> timeout
  const clearRest = (userId) => {
    clearTimeout(restTimers.get(userId));
    restTimers.delete(userId);
  };

  return [
    ['POST', /^\/api\/rest-timer$/, async (ctx) => {
      const u = requireUser(ctx);
      const seconds = numberField((await readBody(ctx.req)).seconds, { name: 'Pause', min: 5, max: 900, integer: true });
      if (!seconds) throw new HttpError(400, 'Pause fehlt');
      clearRest(u.id);
      const t = setTimeout(() => {
        restTimers.delete(u.id);
        notifier.sendToUsers([u.id], { title: '⏱ Pause vorbei', body: 'Weiter geht’s mit dem nächsten Satz 💪', url: '/#/training' }).catch(() => {});
      }, (seconds + 2) * 1000);
      if (t.unref) t.unref();
      restTimers.set(u.id, t);
      return { ok: true, endsAt: new Date(Date.now() + seconds * 1000).toISOString() };
    }],
    ['DELETE', /^\/api\/rest-timer$/, async (ctx) => {
      clearRest(requireUser(ctx).id);
      return { ok: true };
    }],
    ['GET', /^\/api\/training$/, async (ctx) => planOf(targetClient(ctx).id)],

    // Default plan of a split (not saved until the plan is saved)
    ['GET', /^\/api\/training\/template$/, async (ctx) => {
      requireUser(ctx);
      const split = ctx.url.searchParams.get('split');
      const days = Number(ctx.url.searchParams.get('days'));
      if (![...SPLITS, CUSTOM].some((s) => s.key === split)) throw new HttpError(400, 'Unbekannter Split');
      if (!Number.isInteger(days) || days < 1 || days > 7) throw new HttpError(400, 'Trainingstage: 1 bis 7');
      return { days: buildPlan(split, days) };
    }],

    ['PUT', /^\/api\/training$/, async (ctx) => {
      const actor = requireUser(ctx);
      const client = targetClient(ctx);
      const { split, days } = parsePlan(await readBody(ctx.req));
      const isNew = !q.plan.get(client.id);
      q.upsertPlan.run(client.id, split, days.length, JSON.stringify(days), actor.id);
      if (actor.role === 'coach') {
        notifyOther(actor, client, '🏋️ Trainingsplan aktualisiert', 'Dein Coach hat deinen Trainingsplan angepasst.');
      } else if (isNew) {
        notifyOther(actor, client, `🏋️ Neuer Trainingsplan von ${client.display_name}`, `${days.length} Trainingstage`);
      }
      return planOf(client.id);
    }],

    ['DELETE', /^\/api\/training$/, async (ctx) => {
      const client = targetClient(ctx);
      q.deletePlan.run(client.id);
      return planOf(client.id);
    }],

    // Log one training day: { date, dayId, dayName, exercises: [{ name, sets: [{ weight, reps }] }] }
    ['POST', /^\/api\/training\/workouts$/, async (ctx) => {
      const client = targetClient(ctx);
      const body = await readBody(ctx.req);
      const date = body.date;
      if (!isValidDate(date) || date > maxAllowedDate()) throw new HttpError(400, 'Ungültiges Datum');
      const dayId = typeof body.dayId === 'string' && /^[\w-]{1,40}$/.test(body.dayId) ? body.dayId : null;
      if (!dayId) throw new HttpError(400, 'Trainingstag fehlt');
      const dayName = textField(body.dayName, { name: 'Trainingstag', max: 40 }) || 'Training';
      if (!Array.isArray(body.exercises) || body.exercises.length > 20) throw new HttpError(400, 'Ungültige Übungen');
      const parsed = body.exercises.map((e) => {
        const name = textField(e && e.name, { name: 'Übung', max: 60 });
        if (!name) throw new HttpError(400, 'Übung ohne Namen');
        const sets = (Array.isArray(e.sets) ? e.sets : []).slice(0, 12).map((s) => ({
          weight: numberField(s && s.weight, { name: `${name}: Gewicht`, min: 0, max: 1000 }) ?? null,
          reps: numberField(s && s.reps, { name: `${name}: Wiederholungen`, min: 0, max: 200, integer: true }) ?? null,
        }));
        return { name, key: exerciseKey(name), sets: sets.filter((s) => s.weight !== null || s.reps !== null) };
      });
      const durationMin = numberField(body.durationMin, { name: 'Dauer', min: 1, max: 600, integer: true }) ?? null;
      const existing = q.workout.get(client.id, date, dayId);
      const exclude = existing ? existing.id : -1;
      // before saving: best weight per exercise so far, and the last session of this training day
      const bestBefore = new Map(parsed.map((e) => [e.key, db.prepare(
        'SELECT MAX(s.weight) AS best FROM workout_sets s JOIN workouts w ON w.id = s.workout_id WHERE w.client_id = ? AND s.exercise_key = ? AND w.id <> ?'
      ).get(client.id, e.key, exclude).best]));
      const prevSession = db.prepare('SELECT id FROM workouts WHERE client_id = ? AND day_id = ? AND id <> ? AND date <= ? ORDER BY date DESC, id DESC LIMIT 1').get(client.id, dayId, exclude, date);
      const prevVolume = prevSession
        ? db.prepare('SELECT COALESCE(SUM(weight * reps), 0) AS v FROM workout_sets WHERE workout_id = ? AND weight IS NOT NULL AND reps IS NOT NULL').get(prevSession.id).v
        : null;
      let id;
      db.exec('BEGIN');
      try {
        id = existing ? existing.id : Number(q.insertWorkout.run(client.id, date, dayId, dayName).lastInsertRowid);
        if (existing) q.renameWorkout.run(dayName, id);
        for (const e of parsed) {
          q.clearSets.run(id, e.key);
          e.sets.forEach((s, i) => q.insertSet.run(id, e.key, e.name, i + 1, s.weight, s.reps));
        }
        if (durationMin !== null) db.prepare('UPDATE workouts SET duration_min = ? WHERE id = ?').run(durationMin, id);
        if (!q.countSets.get(id).n) q.deleteWorkout.run(id);
        db.exec('COMMIT');
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
      // the summary for the end-of-workout screen and the share picture
      const allSets = parsed.flatMap((e) => e.sets);
      const volume = Math.round(allSets.reduce((a, s) => a + (s.weight !== null && s.reps !== null ? s.weight * s.reps : 0), 0));
      const prs = parsed.map((e) => {
        const top = Math.max(...e.sets.map((s) => (s.weight === null ? -1 : s.weight)), -1);
        const before = bestBefore.get(e.key);
        return before !== null && before !== undefined && top > before ? { name: e.name, weight: top, previous: before } : null;
      }).filter(Boolean);
      const number = db.prepare('SELECT COUNT(*) AS n FROM workouts WHERE client_id = ? AND (date < ? OR (date = ? AND id <= ?))').get(client.id, date, date, id).n;
      return {
        ...planOf(client.id),
        summary: {
          date, dayName, durationMin, volume, prevVolume: prevVolume === null ? null : Math.round(prevVolume),
          sets: allSets.length, reps: allSets.reduce((a, s) => a + (s.reps || 0), 0),
          exercises: parsed.filter((e) => e.sets.length).length, prs, number,
        },
      };
    }],

    // Per exercise: one point per session with the heaviest set (and its reps)
    ['GET', /^\/api\/training\/history$/, async (ctx) => {
      const client = targetClient(ctx);
      const byKey = new Map();
      for (const s of q.allSets.all(client.id)) {
        if (!byKey.has(s.exercise_key)) byKey.set(s.exercise_key, { key: s.exercise_key, name: s.exercise_name, sessions: [] });
        const ex = byKey.get(s.exercise_key);
        ex.name = s.exercise_name;
        let sess = ex.sessions[ex.sessions.length - 1];
        if (!sess || sess.workoutId !== s.workout_id) {
          sess = { workoutId: s.workout_id, date: s.date, dayName: s.day_name, sets: [] };
          ex.sessions.push(sess);
        }
        sess.sets.push({ weight: s.weight, reps: s.reps });
      }
      const exercises = [...byKey.values()].map((ex) => {
        // several workouts on one day collapse into the best one
        const perDay = new Map();
        for (const s of ex.sessions) {
          const top = s.sets.reduce((b, x) => ((x.weight ?? -1) > (b.weight ?? -1) ? x : b), { weight: null, reps: null });
          const volume = s.sets.reduce((a, x) => a + (x.weight || 0) * (x.reps || 0), 0);
          const prev = perDay.get(s.date);
          if (!prev || (top.weight ?? -1) > (prev.topWeight ?? -1)) {
            perDay.set(s.date, { date: s.date, dayName: s.dayName, topWeight: top.weight, topReps: top.reps, volume, sets: s.sets });
          }
        }
        const sessions = [...perDay.values()].sort((a, b) => a.date.localeCompare(b.date));
        const weights = sessions.map((s) => s.topWeight).filter((w) => w !== null);
        return { key: ex.key, name: ex.name, sessions, best: weights.length ? Math.max(...weights) : null };
      });
      exercises.sort((a, b) => b.sessions.length - a.sessions.length || a.name.localeCompare(b.name, 'de'));
      return { exercises };
    }],
  ];
}

module.exports = { trainingRoutes, exerciseKey };
