'use strict';

// Hall of Fame shop: medals are worth tokens (bronze 1, silver 2, gold 3); bought cans go into the client's fridge.

/** Rarity, rarest last. The fridge sorts cans by rarity, rarest top left. */
const RARITIES = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic', 'cosmic'];

/** Items for the fridge. kind: can (default), cup, vial, tub, shaker, bar, bottle or pouch – each has its own pixel art.
 * Colours: body, darker shade, label band, accent. Brand names only as names – the pixel art is generic, no logos. */
const FLAVORS = [
  { key: 'white', name: 'Ultra White', price: 1, rarity: 'common', colors: ['#f4f7f9', '#c9d3da', '#ffffff', '#9fb0bc'] },
  { key: 'rosa', name: 'Ultra Rosá', price: 1, rarity: 'common', colors: ['#f7b6cf', '#d9849f', '#ffe3ee', '#e05589'] },
  { key: 'blue', name: 'Ultra Blue', price: 1, rarity: 'common', colors: ['#3a8ee8', '#245fa8', '#bfe0ff', '#0b3a73'] },
  { key: 'red', name: 'Ultra Red', price: 2, rarity: 'rare', colors: ['#e2463f', '#a82a24', '#ffd0cc', '#6e1410'] },
  { key: 'paradise', name: 'Ultra Paradise', price: 2, rarity: 'rare', colors: ['#7ed957', '#4c9e2e', '#e2ffd2', '#2c6a16'] },
  { key: 'fiesta', name: 'Ultra Fiesta Mango', price: 2, rarity: 'rare', colors: ['#52c7d9', '#2f8ea0', '#fff1a6', '#f5a623'] },
  { key: 'violet', name: 'Ultra Violet', price: 2, rarity: 'rare', colors: ['#8e5bd8', '#5f3a9e', '#e6d6ff', '#3d2170'] },
  { key: 'sunrise', name: 'Ultra Sunrise', price: 2, rarity: 'rare', colors: ['#ff9a3c', '#d06a17', '#ffe2c2', '#a3460a'] },
  { key: 'watermelon', name: 'Ultra Watermelon', price: 3, rarity: 'epic', colors: ['#3fb6a8', '#24857a', '#ffd3db', '#ef5a6f'] },
  { key: 'peachy', name: 'Ultra Peachy Keen', price: 3, rarity: 'epic', colors: ['#ffc3a0', '#e38f68', '#fff0e6', '#d4614a'] },
  { key: 'gold', name: 'Ultra Gold', price: 3, rarity: 'legendary', colors: ['#f2c230', '#b8860b', '#fff4c2', '#7a5800'] },
  { key: 'black', name: 'Ultra Black', price: 3, rarity: 'legendary', colors: ['#2b2f33', '#14171a', '#5a6168', '#c8102e'] },
  { key: 'mcd_cup', name: "McDonald's Becher", kind: 'cup', price: 3, rarity: 'legendary', colors: ['#da291c', '#a81f15', '#ffc72c', '#ffffff'] },
  { key: 'testo_vial', name: 'Testosteron-Öl (Vial)', kind: 'vial', price: 5, rarity: 'mythic', colors: ['#d9a23a', '#a8741c', '#f4f6f8', '#c8102e'] },
  // gym bag & supplements
  { key: 'creatine', name: 'Kreatin Monohydrat', kind: 'tub', price: 1, rarity: 'common', colors: ['#f4f6f8', '#c9d3da', '#2b2f33', '#8fa1ad'] },
  { key: 'esn_shaker', name: 'ESN Shaker', kind: 'shaker', price: 1, rarity: 'common', colors: ['#1c1f22', '#0d0f11', '#e9edf0', '#c8102e'] },
  { key: 'esn_bar', name: 'ESN Designer Bar', kind: 'bar', price: 1, rarity: 'uncommon', colors: ['#2b2f33', '#14171a', '#c7905a', '#f2c230'] },
  { key: 'esn_isoclear', name: 'ESN Isoclear', kind: 'tub', price: 2, rarity: 'uncommon', colors: ['#e8f4fb', '#b9d3e2', '#1c1f22', '#4fc3f7'] },
  { key: 'more_zero', name: 'MORE Zero Sirup', kind: 'bottle', price: 2, rarity: 'uncommon', colors: ['#f7b6cf', '#d9849f', '#ffffff', '#1c1f22'] },
  { key: 'esn_flexpresso', name: 'ESN Flexpresso', price: 2, rarity: 'rare', colors: ['#6b4a35', '#4a3122', '#f2e3d0', '#1c1f22'] },
  { key: 'clear_bottle', name: 'Clear-Whey-Drink', kind: 'bottle', price: 2, rarity: 'rare', colors: ['#bfe9ff', '#7cc4e4', '#ffffff', '#3a8ee8'] },
  { key: 'esn_designer_whey', name: 'ESN Designer Whey', kind: 'tub', price: 3, rarity: 'epic', colors: ['#1c1f22', '#0d0f11', '#f4f6f8', '#e2463f'] },
  { key: 'esn_crank', name: 'ESN Crank Pre-Workout', kind: 'tub', price: 4, rarity: 'legendary', colors: ['#1c1f22', '#0d0f11', '#c6ff3a', '#ff2fb3'] },
  { key: 'more_matcha', name: 'MORE Matcha', kind: 'pouch', price: 4, rarity: 'legendary', colors: ['#7fb34a', '#5a8a2c', '#f5f1e6', '#2f4f1a'] },
  { key: 'gold_shaker', name: 'Goldener Shaker', kind: 'shaker', price: 5, rarity: 'mythic', colors: ['#f2c230', '#b8860b', '#fff4c2', '#7a5800'] },
  // cosmic: the rarest of all
  { key: 'ultra_cosmos', name: 'Ultra Cosmos', price: 7, rarity: 'cosmic', colors: ['#2a1a6e', '#160c45', '#7b6cff', '#ff6ad5'] },
  { key: 'galaxy_shaker', name: 'Galaxy Shaker', kind: 'shaker', price: 8, rarity: 'cosmic', colors: ['#1a1450', '#0b0830', '#9d8bff', '#5ef2ff'] },
];

function shopRoutes({ db, HttpError, readBody, requireUser, targetClient, achievements }) {
  const q = {
    items: db.prepare('SELECT * FROM fridge_items WHERE client_id = ? ORDER BY id'),
    spent: db.prepare('SELECT COALESCE(SUM(cost), 0) AS n FROM fridge_items WHERE client_id = ?'),
    insert: db.prepare('INSERT INTO fridge_items (client_id, flavor, cost) VALUES (?, ?, ?)'),
    newest: db.prepare('SELECT * FROM fridge_items WHERE client_id = ? ORDER BY id DESC LIMIT 1'),
    remove: db.prepare('DELETE FROM fridge_items WHERE id = ?'),
    clear: db.prepare('DELETE FROM fridge_items WHERE client_id = ?'),
    owns: db.prepare('SELECT 1 FROM fridge_items WHERE client_id = ? AND flavor = ? LIMIT 1'),
  };

  /**
   * Tokens come from medals, and medals can disappear again (e.g. an entry of 100 000 steps is corrected).
   * Whatever was bought with tokens that no longer exist goes back: the newest purchases first, until the
   * spent tokens are covered by the earned ones again. Returns the items taken back.
   */
  function reconcile(clientId, earned) {
    const revoked = [];
    let spent = q.spent.get(clientId).n;
    while (spent > earned) {
      const item = q.newest.get(clientId);
      if (!item) break;
      q.remove.run(item.id);
      spent -= item.cost;
      const f = FLAVORS.find((x) => x.key === item.flavor);
      revoked.push({ flavor: item.flavor, name: f ? f.name : item.flavor, cost: item.cost });
    }
    return revoked;
  }

  function stateOf(clientId) {
    const earned = achievements.evaluate(clientId).summary.tokens;
    const revoked = reconcile(clientId, earned);
    const spent = q.spent.get(clientId).n;
    return {
      revoked,
      flavors: FLAVORS,
      rarities: RARITIES,
      balance: { earned, spent, available: Math.max(0, earned - spent) },
      items: q.items.all(clientId).map((i) => ({ id: i.id, flavor: i.flavor, cost: i.cost, boughtAt: i.bought_at })),
    };
  }

  /**
   * A coach's own test fridge: everything is free, nothing is ever taken back. Only for the coach's own
   * account – a coach looking at a client (?userId=) always gets that client's real fridge.
   */
  function coachTestState(coachId) {
    return {
      revoked: [],
      free: true,
      flavors: FLAVORS,
      rarities: RARITIES,
      balance: { earned: 0, spent: 0, available: 0 },
      items: q.items.all(coachId).map((i) => ({ id: i.id, flavor: i.flavor, cost: 0, boughtAt: i.bought_at })),
    };
  }
  const ownCoachFridge = (ctx) => {
    const u = requireUser(ctx);
    return u.role === 'coach' && !ctx.url.searchParams.has('userId') ? u : null;
  };

  /** After a client's data changed: take back purchases that are no longer covered. */
  function reconcileFor(clientId) {
    return reconcile(clientId, achievements.evaluate(clientId).summary.tokens);
  }

  const routes = [
    ['GET', /^\/api\/shop$/, async (ctx) => {
      const coach = ownCoachFridge(ctx);
      return coach ? coachTestState(coach.id) : stateOf(targetClient(ctx).id);
    }],
    ['POST', /^\/api\/shop\/buy$/, async (ctx) => {
      const u = requireUser(ctx);
      const { flavor } = await readBody(ctx.req);
      const f = FLAVORS.find((x) => x.key === flavor);
      if (!f) throw new HttpError(400, 'Diese Sorte gibt es nicht');
      // every item exists once per fridge: after buying it, it is sold out for this person
      if (q.owns.get(u.id, f.key)) throw new HttpError(409, `${f.name} ist ausverkauft – steht schon in deinem Kühlschrank.`);
      if (u.role === 'coach') {
        // coach test fridge: free, always into the coach's own fridge (never a client's)
        q.insert.run(u.id, f.key, 0);
        ctx.res.statusCode = 201;
        return coachTestState(u.id);
      }
      if (u.role !== 'client') throw new HttpError(403, 'Nur Klienten können im Shop kaufen');
      // check and insert in one transaction so two quick taps cannot overspend
      db.exec('BEGIN IMMEDIATE');
      try {
        const { available } = stateOf(u.id).balance;
        if (available < f.price) throw new HttpError(409, `Dafür brauchst du ${f.price} Token – du hast ${available}.`);
        q.insert.run(u.id, f.key, f.price);
        db.exec('COMMIT');
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
      ctx.res.statusCode = 201;
      return stateOf(u.id);
    }],
    // Coach only: empty the own test fridge to see the empty state (cobwebs, flies) again.
    ['DELETE', /^\/api\/shop\/items$/, async (ctx) => {
      const u = requireUser(ctx);
      if (u.role !== 'coach') throw new HttpError(403, 'Nur für Coaches');
      q.clear.run(u.id);
      return coachTestState(u.id);
    }],
  ];

  return { routes, reconcileFor };
}

module.exports = { shopRoutes, FLAVORS, RARITIES };
