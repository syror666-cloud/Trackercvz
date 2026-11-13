'use strict';

// Nutrition plan (coach-defined), food database and client swap requests.

const kcalOf = (item) => Math.round((item.amount * item.kcal) / 100);
/** Amount of `newKcal` per 100 that has the same calories as `kcal` (rounded to 5 g/ml). */
const sameKcalAmount = (kcal, newKcalPer100) =>
  newKcalPer100 > 0 ? Math.max(5, Math.round(kcal / newKcalPer100 * 100 / 5) * 5) : 100;

function nutritionRoutes({ db, notifier, HttpError, readBody, textField, numberField, requireUser, requireCoach, targetClient }) {
  const q = {
    searchFoods: db.prepare(
      `SELECT * FROM foods WHERE name LIKE ? ESCAPE '\\' ORDER BY
         CASE WHEN name LIKE ? ESCAPE '\\' THEN 0 ELSE 1 END, name COLLATE NOCASE LIMIT ?`
    ),
    allFoods: db.prepare('SELECT * FROM foods ORDER BY category, name COLLATE NOCASE'),
    food: db.prepare('SELECT * FROM foods WHERE id = ?'),
    foodByName: db.prepare('SELECT * FROM foods WHERE name = ?'),
    insertFood: db.prepare('INSERT INTO foods (name, kcal, unit, category, protein, carbs, fat, is_custom) VALUES (?, ?, ?, ?, ?, ?, ?, 1)'),
    updateFood: db.prepare('UPDATE foods SET name = ?, kcal = ?, unit = ?, category = ?, protein = ?, carbs = ?, fat = ? WHERE id = ?'),
    deleteFood: db.prepare('DELETE FROM foods WHERE id = ?'),

    meals: db.prepare('SELECT * FROM meals WHERE client_id = ? ORDER BY position, id'),
    meal: db.prepare('SELECT * FROM meals WHERE id = ?'),
    maxMealPos: db.prepare('SELECT COALESCE(MAX(position), -1) AS p FROM meals WHERE client_id = ?'),
    insertMeal: db.prepare('INSERT INTO meals (client_id, name, position) VALUES (?, ?, ?)'),
    renameMeal: db.prepare('UPDATE meals SET name = ? WHERE id = ?'),
    setMealPos: db.prepare('UPDATE meals SET position = ? WHERE id = ?'),
    deleteMeal: db.prepare('DELETE FROM meals WHERE id = ?'),
    items: db.prepare('SELECT * FROM meal_items WHERE meal_id = ? ORDER BY position, id'),
    item: db.prepare(
      'SELECT i.*, m.client_id, m.name AS meal_name FROM meal_items i JOIN meals m ON m.id = i.meal_id WHERE i.id = ?'
    ),
    maxItemPos: db.prepare('SELECT COALESCE(MAX(position), -1) AS p FROM meal_items WHERE meal_id = ?'),
    insertItem: db.prepare(
      'INSERT INTO meal_items (meal_id, food_id, name, kcal, unit, amount, position, protein, carbs, fat) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ),
    updateItem: db.prepare('UPDATE meal_items SET food_id = ?, name = ?, kcal = ?, unit = ?, amount = ?, protein = ?, carbs = ?, fat = ? WHERE id = ?'),
    deleteItem: db.prepare('DELETE FROM meal_items WHERE id = ?'),

    requestsOf: db.prepare(
      `SELECT r.*, f.name AS wanted_name, f.kcal AS wanted_kcal, f.unit AS wanted_unit
       FROM swap_requests r LEFT JOIN foods f ON f.id = r.wanted_food_id
       WHERE r.client_id = ? ORDER BY CASE r.status WHEN 'open' THEN 0 ELSE 1 END, r.id DESC LIMIT 50`
    ),
    request: db.prepare('SELECT * FROM swap_requests WHERE id = ?'),
    openForItem: db.prepare("SELECT 1 FROM swap_requests WHERE item_id = ? AND status = 'open'"),
    openForMeal: db.prepare("SELECT 1 FROM swap_requests WHERE meal_id = ? AND type = 'meal' AND status = 'open'"),
    insertRequest: db.prepare(
      'INSERT INTO swap_requests (client_id, type, meal_id, item_id, subject, wish, wanted_food_id) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ),
    resolveRequest: db.prepare(
      "UPDATE swap_requests SET status = ?, coach_note = ?, resolved_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = ?"
    ),
    deleteRequest: db.prepare('DELETE FROM swap_requests WHERE id = ?'),
    clientName: db.prepare('SELECT display_name FROM users WHERE id = ?'),
    macroGoals: db.prepare('SELECT * FROM macro_goals WHERE user_id = ?'),
    setMacroGoals: db.prepare(
      'INSERT INTO macro_goals (user_id, protein, carbs, fat) VALUES (?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET protein = excluded.protein, carbs = excluded.carbs, fat = excluded.fat'
    ),
  };

  const foodRow = (f) => ({
    id: f.id, name: f.name, kcal: f.kcal, unit: f.unit, category: f.category, custom: Boolean(f.is_custom),
    protein: f.protein ?? null, carbs: f.carbs ?? null, fat: f.fat ?? null,
  });
  const macroSpec = (name) => ({ name: `${name} pro 100`, min: 0, max: 100 });

  function parseFood(body, existing = {}) {
    const name = textField(body.name, { name: 'Name', max: 80 }) ?? existing.name;
    if (!name) throw new HttpError(400, 'Bitte einen Namen angeben');
    const kcal = numberField(body.kcal, { name: 'kcal pro 100', min: 0, max: 1000 }) ?? existing.kcal;
    if (kcal === undefined || kcal === null) throw new HttpError(400, 'Bitte kcal pro 100 g angeben');
    const unit = body.unit === undefined ? existing.unit || 'g' : body.unit;
    if (!['g', 'ml'].includes(unit)) throw new HttpError(400, 'Einheit: g oder ml');
    const category = textField(body.category, { name: 'Kategorie', max: 40 }) ?? existing.category ?? 'Eigene';
    const macro = (key, label) => {
      const v = numberField(body[key], macroSpec(label));
      return v === undefined ? existing[key] ?? null : v;
    };
    return { name, kcal, unit, category, protein: macro('protein', 'Eiweiß'), carbs: macro('carbs', 'Kohlenhydrate'), fat: macro('fat', 'Fett') };
  }

  /** Grams of a macro in an item (null when the food has no macro values). */
  const macroOf = (i, key) => (i[key] === null || i[key] === undefined ? null : Math.round(((i.amount * i[key]) / 100) * 10) / 10);
  const sumMacros = (list) => {
    const t = { protein: 0, carbs: 0, fat: 0, complete: true };
    for (const x of list) {
      for (const k of ['protein', 'carbs', 'fat']) {
        if (x[k] === null || x[k] === undefined) t.complete = false;
        else t[k] += x[k];
      }
      if (x.complete === false) t.complete = false;
    }
    for (const k of ['protein', 'carbs', 'fat']) t[k] = Math.round(t[k]);
    return t;
  };

  function planOf(clientId) {
    const meals = q.meals.all(clientId).map((m) => {
      const items = q.items.all(m.id).map((i) => ({
        id: i.id, foodId: i.food_id, name: i.name, kcal: i.kcal, unit: i.unit, amount: i.amount, kcalTotal: kcalOf(i),
        protein: macroOf(i, 'protein'), carbs: macroOf(i, 'carbs'), fat: macroOf(i, 'fat'),
        per100: { protein: i.protein ?? null, carbs: i.carbs ?? null, fat: i.fat ?? null },
      }));
      return { id: m.id, name: m.name, items, kcalTotal: items.reduce((a, i) => a + i.kcalTotal, 0), macros: sumMacros(items) };
    });
    const requests = q.requestsOf.all(clientId).map((r) => ({
      id: r.id,
      type: r.type,
      mealId: r.meal_id,
      itemId: r.item_id,
      subject: r.subject,
      wish: r.wish,
      wantedFood: r.wanted_food_id ? { id: r.wanted_food_id, name: r.wanted_name, kcal: r.wanted_kcal, unit: r.wanted_unit } : null,
      status: r.status,
      coachNote: r.coach_note,
      createdAt: r.created_at,
      resolvedAt: r.resolved_at,
    }));
    return {
      meals, totalKcal: meals.reduce((a, m) => a + m.kcalTotal, 0), requests,
      macros: sumMacros(meals.map((m) => m.macros)),
      macroGoals: macroGoalsOf(clientId),
    };
  }

  function ownMeal(ctx, id) {
    requireCoach(ctx);
    const m = q.meal.get(Number(id));
    if (!m) throw new HttpError(404, 'Mahlzeit nicht gefunden');
    return m;
  }
  function ownItem(ctx, id) {
    requireCoach(ctx);
    const i = q.item.get(Number(id));
    if (!i) throw new HttpError(404, 'Lebensmittel nicht gefunden');
    return i;
  }

  /** Food for a plan item: from the database (foodId) or entered by hand (name + kcal). */
  function resolveFood(body) {
    if (body.foodId !== undefined && body.foodId !== null) {
      const f = q.food.get(Number(body.foodId));
      if (!f) throw new HttpError(404, 'Lebensmittel nicht in der Datenbank');
      return { foodId: f.id, name: f.name, kcal: f.kcal, unit: f.unit, protein: f.protein, carbs: f.carbs, fat: f.fat };
    }
    const f = parseFood(body);
    return { foodId: null, ...f };
  }

  const amountSpec = { name: 'Menge', min: 1, max: 5000 };

  /** Daily macro targets in grams (null = no target). */
  function macroGoalsOf(clientId) {
    const g = q.macroGoals.get(clientId);
    return { protein: g ? g.protein : null, carbs: g ? g.carbs : null, fat: g ? g.fat : null };
  }

  return [
    // ---- Macro targets (coach sets them, the client sees them) ----
    ['GET', /^\/api\/macro-goals$/, async (ctx) => ({ macroGoals: macroGoalsOf(targetClient(ctx).id) })],
    ['PUT', /^\/api\/macro-goals$/, async (ctx) => {
      requireCoach(ctx);
      const c = targetClient(ctx);
      const b = await readBody(ctx.req);
      const g = (k, label) => numberField(b[k], { name: label, min: 0, max: 1000 }) ?? null;
      q.setMacroGoals.run(c.id, g('protein', 'Eiweiß'), g('carbs', 'Kohlenhydrate'), g('fat', 'Fett'));
      return { macroGoals: macroGoalsOf(c.id) };
    }],

    // ---- Food database ----
    ['GET', /^\/api\/foods$/, async (ctx) => {
      requireUser(ctx);
      const term = (ctx.url.searchParams.get('q') || '').trim().slice(0, 60);
      if (!term) return { foods: q.allFoods.all().map(foodRow) };
      const esc = term.replace(/[\\%_]/g, (c) => `\\${c}`);
      return { foods: q.searchFoods.all(`%${esc}%`, `${esc}%`, 30).map(foodRow) };
    }],

    ['POST', /^\/api\/foods$/, async (ctx) => {
      requireCoach(ctx);
      const f = parseFood(await readBody(ctx.req));
      if (q.foodByName.get(f.name)) throw new HttpError(409, 'Dieses Lebensmittel gibt es schon');
      const id = Number(q.insertFood.run(f.name, f.kcal, f.unit, f.category, f.protein, f.carbs, f.fat).lastInsertRowid);
      ctx.res.statusCode = 201;
      return { food: foodRow(q.food.get(id)) };
    }],

    ['PATCH', /^\/api\/foods\/(\d+)$/, async (ctx, [, id]) => {
      requireCoach(ctx);
      const existing = q.food.get(Number(id));
      if (!existing) throw new HttpError(404, 'Nicht gefunden');
      const f = parseFood(await readBody(ctx.req), existing);
      const clash = q.foodByName.get(f.name);
      if (clash && clash.id !== existing.id) throw new HttpError(409, 'Dieses Lebensmittel gibt es schon');
      q.updateFood.run(f.name, f.kcal, f.unit, f.category, f.protein, f.carbs, f.fat, existing.id);
      return { food: foodRow(q.food.get(existing.id)) };
    }],

    ['DELETE', /^\/api\/foods\/(\d+)$/, async (ctx, [, id]) => {
      requireCoach(ctx);
      q.deleteFood.run(Number(id));
      return { ok: true };
    }],

    // ---- Plan ----
    ['GET', /^\/api\/nutrition$/, async (ctx) => planOf(targetClient(ctx).id)],

    ['POST', /^\/api\/nutrition\/meals$/, async (ctx) => {
      requireCoach(ctx);
      const c = targetClient(ctx);
      const name = textField((await readBody(ctx.req)).name, { name: 'Name', max: 60 });
      if (!name) throw new HttpError(400, 'Bitte einen Namen für die Mahlzeit angeben');
      q.insertMeal.run(c.id, name, q.maxMealPos.get(c.id).p + 1);
      // the first meal answers an open plan request
      db.prepare("UPDATE nutrition_requests SET status = 'done' WHERE client_id = ? AND status = 'open'").run(c.id);
      ctx.res.statusCode = 201;
      return planOf(c.id);
    }],

    ['PATCH', /^\/api\/nutrition\/meals\/(\d+)$/, async (ctx, [, id]) => {
      const m = ownMeal(ctx, id);
      const body = await readBody(ctx.req);
      if (body.name !== undefined) {
        const name = textField(body.name, { name: 'Name', max: 60 });
        if (!name) throw new HttpError(400, 'Name darf nicht leer sein');
        q.renameMeal.run(name, m.id);
      }
      if (body.move === -1 || body.move === 1) {
        const meals = q.meals.all(m.client_id);
        const idx = meals.findIndex((x) => x.id === m.id);
        const other = meals[idx + body.move];
        if (other) {
          meals.forEach((x, i) => q.setMealPos.run(i, x.id));
          q.setMealPos.run(idx + body.move, m.id);
          q.setMealPos.run(idx, other.id);
        }
      }
      return planOf(m.client_id);
    }],

    ['DELETE', /^\/api\/nutrition\/meals\/(\d+)$/, async (ctx, [, id]) => {
      const m = ownMeal(ctx, id);
      q.deleteMeal.run(m.id);
      return planOf(m.client_id);
    }],

    ['POST', /^\/api\/nutrition\/meals\/(\d+)\/items$/, async (ctx, [, id]) => {
      const m = ownMeal(ctx, id);
      const body = await readBody(ctx.req);
      const f = resolveFood(body);
      const amount = numberField(body.amount, amountSpec);
      if (!amount) throw new HttpError(400, 'Bitte eine Menge angeben');
      q.insertItem.run(m.id, f.foodId, f.name, f.kcal, f.unit, amount, q.maxItemPos.get(m.id).p + 1, f.protein ?? null, f.carbs ?? null, f.fat ?? null);
      ctx.res.statusCode = 201;
      return planOf(m.client_id);
    }],

    ['PATCH', /^\/api\/nutrition\/items\/(\d+)$/, async (ctx, [, id]) => {
      const i = ownItem(ctx, id);
      const body = await readBody(ctx.req);
      let f = { foodId: i.food_id, name: i.name, kcal: i.kcal, unit: i.unit, protein: i.protein, carbs: i.carbs, fat: i.fat };
      if (body.foodId !== undefined || body.name !== undefined) f = resolveFood(body);
      const amount = numberField(body.amount, amountSpec) ?? i.amount;
      q.updateItem.run(f.foodId, f.name, f.kcal, f.unit, amount, f.protein ?? null, f.carbs ?? null, f.fat ?? null, i.id);
      return planOf(i.client_id);
    }],

    ['DELETE', /^\/api\/nutrition\/items\/(\d+)$/, async (ctx, [, id]) => {
      const i = ownItem(ctx, id);
      q.deleteItem.run(i.id);
      return planOf(i.client_id);
    }],

    // ---- Swap requests (client asks, coach decides) ----
    ['POST', /^\/api\/nutrition\/requests$/, async (ctx) => {
      const u = requireUser(ctx);
      if (u.role !== 'client') throw new HttpError(403, 'Nur Klienten können Tauschwünsche senden');
      const body = await readBody(ctx.req);
      const wish = textField(body.wish, { name: 'Wunsch', max: 500 });
      let subject;
      let mealId;
      let itemId = null;
      let wantedFoodId = null;
      if (body.type === 'item') {
        const i = q.item.get(Number(body.itemId));
        if (!i || i.client_id !== u.id) throw new HttpError(404, 'Lebensmittel nicht gefunden');
        if (q.openForItem.get(i.id)) throw new HttpError(409, 'Für dieses Lebensmittel läuft schon eine Anfrage');
        if (body.wantedFoodId !== undefined && body.wantedFoodId !== null) {
          if (!q.food.get(Number(body.wantedFoodId))) throw new HttpError(404, 'Wunsch-Lebensmittel nicht gefunden');
          wantedFoodId = Number(body.wantedFoodId);
        }
        if (!wish && !wantedFoodId) throw new HttpError(400, 'Wogegen möchtest du tauschen?');
        subject = `${i.name} (${i.amount} ${i.unit}) · ${i.meal_name}`;
        mealId = i.meal_id;
        itemId = i.id;
      } else if (body.type === 'meal') {
        const m = q.meal.get(Number(body.mealId));
        if (!m || m.client_id !== u.id) throw new HttpError(404, 'Mahlzeit nicht gefunden');
        if (q.openForMeal.get(m.id)) throw new HttpError(409, 'Für diese Mahlzeit läuft schon eine Anfrage');
        if (!wish) throw new HttpError(400, 'Was möchtest du stattdessen essen?');
        subject = `Ganze Mahlzeit: ${m.name}`;
        mealId = m.id;
      } else {
        throw new HttpError(400, 'Ungültige Anfrage');
      }
      q.insertRequest.run(u.id, body.type, mealId, itemId, subject, wish ?? null, wantedFoodId);
      const wanted = wantedFoodId ? q.food.get(wantedFoodId).name : wish;
      notifier
        .sendToUsers(notifier.coachIds(), {
          title: `🍽 Tauschwunsch von ${u.display_name}`,
          body: `${subject.split(' · ')[0]} → ${wanted}`,
          url: `/#/client/${u.id}/nutrition`,
        })
        .catch((err) => console.error(err));
      ctx.res.statusCode = 201;
      return planOf(u.id);
    }],

    ['DELETE', /^\/api\/nutrition\/requests\/(\d+)$/, async (ctx, [, id]) => {
      const u = requireUser(ctx);
      const r = q.request.get(Number(id));
      if (!r || u.role !== 'client' || r.client_id !== u.id) throw new HttpError(404, 'Anfrage nicht gefunden');
      if (r.status !== 'open') throw new HttpError(409, 'Die Anfrage ist schon bearbeitet');
      q.deleteRequest.run(r.id);
      return planOf(u.id);
    }],

    ['POST', /^\/api\/nutrition\/requests\/(\d+)\/resolve$/, async (ctx, [, id]) => {
      requireCoach(ctx);
      const r = q.request.get(Number(id));
      if (!r) throw new HttpError(404, 'Anfrage nicht gefunden');
      if (r.status !== 'open') throw new HttpError(409, 'Die Anfrage ist schon bearbeitet');
      const body = await readBody(ctx.req);
      if (!['done', 'declined'].includes(body.status)) throw new HttpError(400, 'Ungültiger Status');
      const note = textField(body.note, { name: 'Notiz', max: 500 });

      // One click: swap the food and keep the calories the same.
      if (body.status === 'done' && body.apply === true) {
        const i = r.item_id ? q.item.get(r.item_id) : null;
        const f = r.wanted_food_id ? q.food.get(r.wanted_food_id) : null;
        if (!i || !f) throw new HttpError(400, 'Automatischer Tausch nicht möglich – bitte den Plan von Hand anpassen');
        q.updateItem.run(f.id, f.name, f.kcal, f.unit, sameKcalAmount(kcalOf(i), f.kcal), f.protein ?? null, f.carbs ?? null, f.fat ?? null, i.id);
      }
      q.resolveRequest.run(body.status, note ?? null, r.id);
      notifier
        .sendToUsers([r.client_id], {
          title: body.status === 'done' ? 'Dein Ernährungsplan wurde angepasst ✓' : 'Antwort auf deinen Tauschwunsch',
          body: `${r.subject.split(' · ')[0]}${note ? ` – ${note}` : body.status === 'done' ? ' wurde getauscht.' : ' bleibt im Plan.'}`,
          url: '/#/nutrition',
        })
        .catch((err) => console.error(err));
      return planOf(r.client_id);
    }],
  ];
}

module.exports = { nutritionRoutes, sameKcalAmount };
