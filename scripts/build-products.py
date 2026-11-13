#!/usr/bin/env python3
"""Builds src/data/off-dach.tsv.br from the Open Food Facts export (ODbL).

Reads the official Parquet export on Hugging Face remotely (only the needed columns, ~3 minutes),
keeps products sold in Germany, Austria or Switzerland with complete and plausible nutrition values,
and writes the compact, Brotli-compressed TSV the server loads at start.

Needs: pip install duckdb ; node (for Brotli). Usage: python3 scripts/build-products.py
"""
import os, re, subprocess, sys, tempfile

import duckdb

URL = 'https://huggingface.co/datasets/openfoodfacts/product-database/resolve/main/food.parquet'
OUT = os.path.join(os.path.dirname(__file__), '..', 'src', 'data', 'off-dach.tsv.br')

con = duckdb.connect()
con.execute("INSTALL httpfs; LOAD httpfs; SET unsafe_disable_etag_checks = true; SET http_retries = 8;")
rows = con.execute(f"""
WITH raw AS (
  SELECT code, brands, quantity, serving_size, coalesce(unique_scans_n, 0) AS scans,
    coalesce(list_filter(product_name, lambda x: x.lang = 'de')[1].text,
             list_filter(product_name, lambda x: x.lang = 'main')[1].text, product_name[1].text) AS name,
    list_filter(nutriments, lambda x: x.name = 'energy-kcal')[1]."100g" AS kcal,
    list_filter(nutriments, lambda x: x.name = 'energy')[1]."100g" AS kj,
    list_filter(nutriments, lambda x: x.name = 'proteins')[1]."100g" AS p,
    list_filter(nutriments, lambda x: x.name = 'carbohydrates')[1]."100g" AS c,
    list_filter(nutriments, lambda x: x.name = 'fat')[1]."100g" AS f
  FROM read_parquet('{URL}')
  WHERE (list_contains(countries_tags, 'en:germany') OR list_contains(countries_tags, 'en:austria')
         OR list_contains(countries_tags, 'en:switzerland')) AND coalesce(obsolete, false) = false
), clean AS (
  SELECT code, trim(name) AS name, trim(split_part(brands, ',', 1)) AS brand, quantity, serving_size, scans,
    round(coalesce(kcal, kj / 4.184)) AS kcal, round(p, 1) AS p, round(c, 1) AS c, round(f, 1) AS f
  FROM raw
  WHERE regexp_matches(code, '^[0-9]{{8,14}}$') AND length(trim(coalesce(name, ''))) > 1
    AND coalesce(kcal, kj / 4.184) BETWEEN 0 AND 950 AND p BETWEEN 0 AND 100 AND c BETWEEN 0 AND 100
    AND f BETWEEN 0 AND 100 AND p + c + f <= 105
)
SELECT * FROM clean WHERE abs(p * 4 + c * 4 + f * 9 - kcal) <= greatest(40, kcal * 0.35)
ORDER BY scans DESC, code
""").fetchall()


def text(s, n):
    return re.sub(r'\s{2,}', ' ', re.sub(r'[\t\r\n]+', ' ', s or '')).strip()[:n]


def num(x):
    x = round(float(x), 1)
    return str(int(x)) if x == int(x) else str(x)


lines, seen = [], set()
for code, name, brand, qty, serving, scans, kcal, p, c, f in rows:
    code = code.lstrip('0') if len(code) > 13 else code
    if code in seen:
        continue
    seen.add(code)
    unit = 'ml' if re.search(r'\d\s*(ml|cl|l)\b', (qty or '').lower()) else 'g'
    m = re.search(r'(\d+(?:[.,]\d+)?)\s*(g|ml)\b', (serving or '').lower())
    sv = num(float(m.group(1).replace(',', '.'))) if m and 0 < float(m.group(1).replace(',', '.')) <= 2000 else ''
    lines.append('\t'.join([code, text(name, 80), text(brand, 40), num(kcal), num(p), num(c), num(f), unit, sv, str(scans or 0)]))

with tempfile.NamedTemporaryFile('wb', suffix='.tsv', delete=False) as tmp:
    tmp.write(('\n'.join(lines) + '\n').encode())
subprocess.run(['node', '-e', """
const z = require('zlib'), fs = require('fs');
const raw = fs.readFileSync(process.argv[1]);
fs.writeFileSync(process.argv[2], z.brotliCompressSync(raw, { params: {
  [z.constants.BROTLI_PARAM_QUALITY]: 11, [z.constants.BROTLI_PARAM_LGWIN]: 24, [z.constants.BROTLI_PARAM_SIZE_HINT]: raw.length } }));
""", tmp.name, OUT], check=True)
os.unlink(tmp.name)
print(f'{len(lines)} Produkte → {OUT}', file=sys.stderr)
