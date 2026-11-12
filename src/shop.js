'use strict';

// Hall of Fame shop: medals are worth tokens (bronze 1, silver 2, gold 3); bought cans go into the client's fridge.

/** Rarity, rarest last. The fridge sorts cans by rarity, rarest top left. */
const RARITIES = ['common', 'rare', 'epic', 'legendary'];

/** Can colours: body, darker shade, label band, accent. Prices 1–3 tokens. */
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
];

function shopRoutes({ db, HttpError, readBody, requireUser, targetClient, achievements }) {
  const q = {
    items: db.prepare('SELECT * FROM fridge_items WHERE client_id = ? ORDER BY id'),
    spent: db.prepare('SELECT COALESCE(SUM(cost), 0) AS n FROM fridge_items WHERE client_id = ?'),
    insert: db.prepare('INSERT INTO fridge_items (client_id, flavor, cost) VALUES (?, ?, ?)'),
  };

  function stateOf(clientId) {
    const earned = achievements.evaluate(clientId).summary.tokens;
    const spent = q.spent.get(clientId).n;
    return {
      flavors: FLAVORS,
      rarities: RARITIES,
      balance: { earned, spent, available: Math.max(0, earned - spent) },
      items: q.items.all(clientId).map((i) => ({ id: i.id, flavor: i.flavor, cost: i.cost, boughtAt: i.bought_at })),
    };
  }

  return [
    ['GET', /^\/api\/shop$/, async (ctx) => stateOf(targetClient(ctx).id)],
    ['POST', /^\/api\/shop\/buy$/, async (ctx) => {
      const u = requireUser(ctx);
      if (u.role !== 'client') throw new HttpError(403, 'Nur Klienten können im Shop kaufen');
      const { flavor } = await readBody(ctx.req);
      const f = FLAVORS.find((x) => x.key === flavor);
      if (!f) throw new HttpError(400, 'Diese Sorte gibt es nicht');
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
  ];
}

module.exports = { shopRoutes, FLAVORS, RARITIES };
