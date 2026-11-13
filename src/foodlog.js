'use strict';

/**
 * Food diary: what a client actually ate, per day and meal, with kcal and macros.
 * Foods come from the database, from a scanned barcode (Open Food Facts, cached) or are typed in.
 * The day's total is written to the tracker entry's calorie field so the rest of the app sees it.
 */

const MEALS = ['fruehstueck', 'mittag', 'abend', 'snack'];
const OFF_FIELDS = 'product_name,product_name_de,brands,nutriments,serving_size,quantity';
const CACHE_DAYS = 30;

/** Default lookup against Open Food Facts. Returns null when the product is unknown. */
async function offLookup(code) {
  const res = await fetch(`https://world.openfoodfacts.org/api/v2/product/${code}.json?fields=${OFF_FIELDS}`, {
    headers: { 'User-Agent': 'StayOnTrack/1.0 (fitness coaching app)' },
    signal: AbortSignal.timeout(7000),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Open Food Facts antwortet mit ${res.status}`);
  const data = await res.json();
  if (!data || data.status !== 1 || !data.product) return null;
  return data.product;
}

const round1 = (v) => Math.round(v * 10) / 10;
const numOrNull = (v) => {
  const n = typeof v === 'string' ? Number(v.replace(',', '.')) : v;
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : null;
};

/** Turns an Open Food Facts product into our per-100 g/ml shape. */
function productFromOff(p) {
  const n = p.nutriments || {};
  let kcal = numOrNull(n['energy-kcal_100g']);
  if (kcal === null && numOrNull(n['energy_100g']) !== null) kcal = n['energy_100g'] / 4.184; // kJ → kcal
  const name = String(p.product_name_de || p.product_name || '').trim().slice(0, 80);
  const quantity = String(p.quantity || '').toLowerCase();
  const unit = /\d\s*(ml|cl|l)\b/.test(quantity) ? 'ml' : 'g';
  return {
    name: name || null,
    brand: String(p.brands || '').split(',')[0].trim().slice(0, 60) || null,
    kcal: kcal === null ? null : Math.round(kcal),
    protein: numOrNull(n.proteins_100g) === null ? null : round1(n.proteins_100g),
    carbs: numOrNull(n.carbohydrates_100g) === null ? null : round1(n.carbohydrates_100g),
    fat: numOrNull(n.fat_100g) === null ? null : round1(n.fat_100g),
    unit,
    serving: String(p.serving_size || '').slice(0, 40) || null,
  };
}

function foodlogRoutes({ db, HttpError, readBody, textField, numberField, requireUser, targetClient, isValidDate, maxAllowedDate, reconcileFor, barcodeLookup = offLookup }) {
  const q = {
    day: db.prepare('SELECT * FROM food_log WHERE client_id = ? AND date = ? ORDER BY id'),
    one: db.prepare('SELECT * FROM food_log WHERE id = ?'),
    insert: db.prepare(`INSERT INTO food_log (client_id, date, meal, name, brand, barcode, food_id, amount, unit, kcal, protein, carbs, fat)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
    update: db.prepare('UPDATE food_log SET meal = ?, amount = ? WHERE id = ?'),
    remove: db.prepare('DELETE FROM food_log WHERE id = ?'),
    food: db.prepare('SELECT * FROM foods WHERE id = ?'),
    cached: db.prepare('SELECT * FROM barcode_products WHERE barcode = ?'),
    cache: db.prepare(`INSERT INTO barcode_products (barcode, found, name, brand, kcal, protein, carbs, fat, unit, serving, fetched_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(barcode) DO UPDATE SET found = excluded.found, name = excluded.name, brand = excluded.brand, kcal = excluded.kcal,
        protein = excluded.protein, carbs = excluded.carbs, fat = excluded.fat, unit = excluded.unit, serving = excluded.serving, fetched_at = excluded.fetched_at`),
    goals: db.prepare('SELECT calories_goal, calories_min, calories_max FROM goals WHERE user_id = ?'),
    macroGoals: db.prepare('SELECT protein, carbs, fat FROM macro_goals WHERE user_id = ?'),
    entry: db.prepare('SELECT * FROM entries WHERE user_id = ? AND date = ?'),
    setCalories: db.prepare(`INSERT INTO entries (user_id, date, calories, calories_ok) VALUES (?, ?, ?, NULL)
      ON CONFLICT(user_id, date) DO UPDATE SET calories = excluded.calories, calories_ok = NULL, updated_at = datetime('now')`),
    clearCalories: db.prepare("UPDATE entries SET calories = NULL, updated_at = datetime('now') WHERE user_id = ? AND date = ?"),
    dropEmpty: db.prepare(`DELETE FROM entries WHERE user_id = ? AND date = ? AND weight IS NULL AND steps IS NULL AND sleep IS NULL
      AND note IS NULL AND calories IS NULL AND calories_ok IS NULL AND training IS NULL`),
  };

  const itemTotal = (r, key) => (r[key] === null ? null : round1((r.amount * r[key]) / 100));
  const row = (r) => ({
    id: r.id, date: r.date, meal: r.meal, name: r.name, brand: r.brand, barcode: r.barcode, foodId: r.food_id,
    amount: r.amount, unit: r.unit, per100: { kcal: r.kcal, protein: r.protein, carbs: r.carbs, fat: r.fat },
    kcal: Math.round((r.amount * r.kcal) / 100), protein: itemTotal(r, 'protein'), carbs: itemTotal(r, 'carbs'), fat: itemTotal(r, 'fat'),
  });

  function dayOf(clientId, date) {
    const items = q.day.all(clientId, date).map(row);
    const totals = { kcal: 0, protein: 0, carbs: 0, fat: 0 };
    for (const i of items) for (const k of Object.keys(totals)) totals[k] += i[k] || 0;
    for (const k of Object.keys(totals)) totals[k] = k === 'kcal' ? Math.round(totals[k]) : Math.round(totals[k]);
    const g = q.goals.get(clientId) || {};
    const m = q.macroGoals.get(clientId) || {};
    return {
      date, items, totals,
      targets: {
        kcal: g.calories_goal ?? null, kcalMin: g.calories_min ?? null, kcalMax: g.calories_max ?? null,
        protein: m.protein ?? null, carbs: m.carbs ?? null, fat: m.fat ?? null,
      },
    };
  }

  /** Keeps the tracker's calorie field in step with the diary. */
  function syncCalories(clientId, date) {
    const items = q.day.all(clientId, date);
    if (items.length) {
      q.setCalories.run(clientId, date, Math.round(items.reduce((a, r) => a + (r.amount * r.kcal) / 100, 0)));
    } else if (q.entry.get(clientId, date)) {
      q.clearCalories.run(clientId, date);
      q.dropEmpty.run(clientId, date);
    }
    return reconcileFor ? reconcileFor(clientId) : [];
  }

  function requireClient(ctx) {
    const u = requireUser(ctx);
    if (u.role !== 'client') throw new HttpError(403, 'Nur Klienten führen ein Ernährungstagebuch');
    return u;
  }
  function checkDate(date) {
    if (!isValidDate(date)) throw new HttpError(400, 'Ungültiges Datum');
    if (date > maxAllowedDate()) throw new HttpError(400, 'Einträge in der Zukunft sind nicht möglich');
  }
  function ownItem(ctx, id) {
    const u = requireClient(ctx);
    const r = q.one.get(id);
    if (!r || r.client_id !== u.id) throw new HttpError(404, 'Eintrag nicht gefunden');
    return { u, r };
  }
  const mealOf = (v, fallback) => {
    if (v === undefined) return fallback;
    if (!MEALS.includes(v)) throw new HttpError(400, 'Unbekannte Mahlzeit');
    return v;
  };
  const amountSpec = { name: 'Menge', min: 1, max: 5000 };
  const per100 = (label, max) => ({ name: `${label} pro 100`, min: 0, max });

  function cachedProduct(r) {
    return r.found
      ? { found: true, barcode: r.barcode, name: r.name, brand: r.brand, kcal: r.kcal, protein: r.protein, carbs: r.carbs, fat: r.fat, unit: r.unit, serving: r.serving }
      : { found: false, barcode: r.barcode };
  }

  async function lookup(code) {
    const c = q.cached.get(code);
    const fresh = c && Date.now() - Date.parse(`${c.fetched_at.replace(' ', 'T')}Z`) < CACHE_DAYS * 864e5;
    if (c && fresh) return cachedProduct(c);
    let p;
    try {
      p = await barcodeLookup(code);
    } catch {
      if (c) return cachedProduct(c);
      throw new HttpError(502, 'Die Produktdatenbank ist gerade nicht erreichbar. Versuch es gleich nochmal oder trag die Werte selbst ein.');
    }
    const prod = p ? productFromOff(p) : null;
    const ok = Boolean(prod && prod.name && prod.kcal !== null);
    q.cache.run(code, ok ? 1 : 0, prod?.name ?? null, prod?.brand ?? null, prod?.kcal ?? null, prod?.protein ?? null,
      prod?.carbs ?? null, prod?.fat ?? null, prod?.unit ?? 'g', prod?.serving ?? null);
    return cachedProduct(q.cached.get(code));
  }

  return [
    ['GET', /^\/api\/foodlog$/, async (ctx) => {
      const c = targetClient(ctx);
      const date = ctx.url.searchParams.get('date');
      if (!isValidDate(date)) throw new HttpError(400, 'Ungültiges Datum');
      return dayOf(c.id, date);
    }],

    ['POST', /^\/api\/foodlog$/, async (ctx) => {
      const u = requireClient(ctx);
      const b = await readBody(ctx.req);
      checkDate(b.date);
      const meal = mealOf(b.meal, null);
      if (!meal) throw new HttpError(400, 'Mahlzeit fehlt');
      const amount = numberField(b.amount, amountSpec);
      if (amount === undefined || amount === null) throw new HttpError(400, 'Menge fehlt');
      let f;
      if (b.foodId !== undefined && b.foodId !== null) {
        const food = q.food.get(Number(b.foodId));
        if (!food) throw new HttpError(404, 'Lebensmittel nicht gefunden');
        f = { name: food.name, brand: null, barcode: null, foodId: food.id, unit: food.unit, kcal: food.kcal, protein: food.protein, carbs: food.carbs, fat: food.fat };
      } else {
        // scanned or typed in: values per 100 g/ml come from the client (prefilled from the barcode lookup, editable)
        const name = textField(b.name, { name: 'Name', max: 80 });
        if (!name) throw new HttpError(400, 'Name fehlt');
        const kcal = numberField(b.kcal, per100('Kalorien', 1000));
        if (kcal === undefined || kcal === null) throw new HttpError(400, 'Kalorien fehlen');
        const barcode = b.barcode === undefined || b.barcode === null || b.barcode === '' ? null : String(b.barcode);
        if (barcode !== null && !/^\d{8,14}$/.test(barcode)) throw new HttpError(400, 'Ungültiger Barcode');
        const unit = b.unit === 'ml' ? 'ml' : 'g';
        const macro = (k, label) => numberField(b[k], per100(label, 100)) ?? null;
        f = {
          name, brand: textField(b.brand, { name: 'Marke', max: 60 }) ?? null, barcode, foodId: null, unit, kcal,
          protein: macro('protein', 'Eiweiß'), carbs: macro('carbs', 'Kohlenhydrate'), fat: macro('fat', 'Fett'),
        };
      }
      const id = Number(q.insert.run(u.id, b.date, meal, f.name, f.brand, f.barcode, f.foodId, amount, f.unit, f.kcal, f.protein, f.carbs, f.fat).lastInsertRowid);
      const revoked = syncCalories(u.id, b.date);
      return { item: row(q.one.get(id)), day: dayOf(u.id, b.date), revoked };
    }],

    ['PATCH', /^\/api\/foodlog\/(\d+)$/, async (ctx, [, id]) => {
      const { u, r } = ownItem(ctx, Number(id));
      const b = await readBody(ctx.req);
      const amount = numberField(b.amount, amountSpec) ?? r.amount;
      q.update.run(mealOf(b.meal, r.meal), amount, r.id);
      const revoked = syncCalories(u.id, r.date);
      return { item: row(q.one.get(r.id)), day: dayOf(u.id, r.date), revoked };
    }],

    ['DELETE', /^\/api\/foodlog\/(\d+)$/, async (ctx, [, id]) => {
      const { u, r } = ownItem(ctx, Number(id));
      q.remove.run(r.id);
      const revoked = syncCalories(u.id, r.date);
      return { day: dayOf(u.id, r.date), revoked };
    }],

    /** Recently eaten foods, for one-tap adding. */
    ['GET', /^\/api\/foodlog\/recent$/, async (ctx) => {
      const u = requireClient(ctx);
      const rows = db.prepare(`SELECT name, brand, barcode, food_id, unit, kcal, protein, carbs, fat, amount, MAX(id) AS last
        FROM food_log WHERE client_id = ? GROUP BY name, COALESCE(brand, '') ORDER BY last DESC LIMIT 12`).all(u.id);
      return {
        recent: rows.map((r) => ({
          name: r.name, brand: r.brand, barcode: r.barcode, foodId: r.food_id, unit: r.unit, amount: r.amount,
          kcal: r.kcal, protein: r.protein, carbs: r.carbs, fat: r.fat,
        })),
      };
    }],

    ['GET', /^\/api\/barcode\/(\d{8,14})$/, async (ctx, [, code]) => {
      requireUser(ctx);
      return { product: await lookup(code) };
    }],
  ];
}

module.exports = { foodlogRoutes, productFromOff, MEALS };
