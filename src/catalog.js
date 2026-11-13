'use strict';

/**
 * Read-only product catalog for barcode lookups and brand-product search.
 * Built once from the bundled Open Food Facts extract (src/data/off-dach.tsv.br) into DATA_DIR/products.db,
 * and rebuilt automatically when the bundled file changes.
 */

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { DatabaseSync } = require('node:sqlite');

const SOURCE = path.join(__dirname, 'data', 'off-dach.tsv.br');
const SCHEMA = 2;

const sourceVersion = (file) => `${SCHEMA}:${fs.statSync(file).size}`;

/** Lines of the TSV (code, name, brand, kcal, protein, carbs, fat, unit, serving, scans) → SQLite with full-text search. */
function build(target, text) {
  const tmp = `${target}.building`;
  fs.rmSync(tmp, { force: true });
  const db = new DatabaseSync(tmp);
  db.exec(`
    PRAGMA journal_mode = OFF; PRAGMA synchronous = OFF;
    CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE products (
      id INTEGER PRIMARY KEY, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL, brand TEXT,
      kcal REAL NOT NULL, protein REAL, carbs REAL, fat REAL, unit TEXT NOT NULL, serving REAL, scans INTEGER NOT NULL DEFAULT 0
    );`);
  const ins = db.prepare('INSERT OR IGNORE INTO products (code, name, brand, kcal, protein, carbs, fat, unit, serving, scans) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  const n = (v) => (v === '' || v === undefined ? null : Number(v));
  db.exec('BEGIN');
  let start = 0;
  while (start < text.length) {
    let end = text.indexOf('\n', start);
    if (end < 0) end = text.length;
    const c = text.slice(start, end).split('\t');
    start = end + 1;
    if (c.length < 8 || !/^\d{8,14}$/.test(c[0]) || !c[1]) continue;
    ins.run(c[0], c[1], c[2] || null, Number(c[3]), n(c[4]), n(c[5]), n(c[6]), c[7] === 'ml' ? 'ml' : 'g', n(c[8]), Number(c[9]) || 0);
  }
  db.exec('COMMIT');
  // full-text search over name and brand ("ehrmann protein" finds "High Protein Pudding · Ehrmann")
  db.exec(`
    CREATE VIRTUAL TABLE products_fts USING fts5(name, brand, content='products', content_rowid='id', tokenize='unicode61 remove_diacritics 2');
    INSERT INTO products_fts (products_fts) VALUES ('rebuild');
    INSERT INTO products_fts (products_fts) VALUES ('optimize');`);
  const count = db.prepare('SELECT count(*) AS n FROM products').get().n;
  db.prepare('INSERT INTO meta VALUES (?, ?)').run('count', String(count));
  db.close();
  fs.renameSync(tmp, target);
  return count;
}

/** Opens (and if needed builds) the catalog in dataDir. Returns null when the source file is missing. */
function openCatalog(dataDir, { source = SOURCE, log = console.log } = {}) {
  if (!fs.existsSync(source)) return null;
  const file = path.join(dataDir, 'products.db');
  const version = sourceVersion(source);
  let db = null;
  try {
    if (fs.existsSync(file)) {
      db = new DatabaseSync(file, { readOnly: true });
      const v = db.prepare("SELECT value FROM meta WHERE key = 'version'").get();
      if (!v || v.value !== version) {
        db.close();
        db = null;
      }
    }
  } catch {
    if (db) db.close();
    db = null;
  }
  if (!db) {
    const t = Date.now();
    const count = build(file, zlib.brotliDecompressSync(fs.readFileSync(source)).toString('utf8'));
    const w = new DatabaseSync(file);
    w.prepare('INSERT OR REPLACE INTO meta VALUES (?, ?)').run('version', version);
    w.close();
    log(`Produktdatenbank gebaut: ${count} Produkte in ${((Date.now() - t) / 1000).toFixed(1)} s`);
    db = new DatabaseSync(file, { readOnly: true });
  }
  return catalogFrom(db);
}

function catalogFrom(db) {
  const byCode = db.prepare('SELECT * FROM products WHERE code = ?');
  const search = db.prepare(`SELECT p.* FROM products_fts JOIN products p ON p.id = products_fts.rowid
    WHERE products_fts MATCH ? ORDER BY p.scans DESC, length(p.name) LIMIT ?`);
  const count = Number((db.prepare("SELECT value FROM meta WHERE key = 'count'").get() || {}).value || 0);
  const row = (r) => r && {
    barcode: r.code, name: r.name, brand: r.brand, kcal: r.kcal, protein: r.protein, carbs: r.carbs, fat: r.fat,
    unit: r.unit, serving: r.serving === null ? null : `${r.serving} ${r.unit}`,
  };
  return {
    count,
    /** EAN-13 / EAN-8 / UPC-A (with or without the leading 0). */
    lookup(code) {
      const variants = [code];
      if (code.length === 12) variants.push(`0${code}`);
      if (code.length === 13 && code.startsWith('0')) variants.push(code.slice(1));
      for (const v of variants) {
        const r = byCode.get(v);
        if (r) return row(r);
      }
      return null;
    },
    /** Brand products by name and brand, most scanned first. */
    search(term, limit = 20) {
      const words = String(term).toLowerCase().match(/[\p{L}\p{N}]+/gu);
      if (!words) return [];
      const match = words.slice(0, 6).map((w) => `"${w}"*`).join(' ');
      try {
        return search.all(match, limit).map(row);
      } catch {
        return [];
      }
    },
  };
}

/** A small in-memory catalog (tests). Lines in the same TSV format. */
function catalogFromLines(dir, lines) {
  const file = path.join(dir, `catalog-${process.pid}-${Date.now()}.db`);
  build(file, lines.join('\n'));
  return catalogFrom(new DatabaseSync(file, { readOnly: true }));
}

module.exports = { openCatalog, catalogFrom, catalogFromLines };
