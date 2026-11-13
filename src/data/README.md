# Produktdatenbank (Barcodes)

`off-dach.tsv.br` enthält rund 320.000 Lebensmittel aus Deutschland, Österreich und der Schweiz
mit Barcode, Name, Marke und Nährwerten pro 100 g/ml (kcal, Eiweiß, Kohlenhydrate, Fett),
Einheit, Portionsgröße und Beliebtheit (Anzahl Scans).

Quelle: [Open Food Facts](https://world.openfoodfacts.org), Datenstand November 2026,
lizenziert unter der [Open Database License (ODbL)](https://opendatacommons.org/licenses/odbl/1-0/);
einzelne Inhalte unter der [Database Contents License](https://opendatacommons.org/licenses/dbcl/1-0/).
Diese Datei ist eine abgeleitete Datenbank und steht unter derselben Lizenz (ODbL).

Gefiltert auf: Verkaufsland DE/AT/CH, nicht veraltet, gültiger EAN/UPC (8–14 Ziffern), Name vorhanden,
kcal, Eiweiß, Kohlenhydrate und Fett vorhanden und plausibel (Energie aus Makros weicht höchstens 35 % ab).

Format: Brotli-komprimiertes TSV, eine Zeile pro Produkt:
`code  name  marke  kcal  eiweiß  kohlenhydrate  fett  einheit(g|ml)  portion  scans`

Beim Serverstart wird daraus einmalig `products.db` im Datenordner gebaut (bei einer neuen Datei automatisch neu).
Neu erzeugen: `python3 scripts/build-products.py` (lädt den Open-Food-Facts-Export von Hugging Face, braucht `duckdb`).
Produkte, die hier fehlen, sucht der Server weiterhin live bei Open Food Facts.
