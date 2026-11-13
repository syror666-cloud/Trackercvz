'use strict';

// Food database: typical reference values per 100 g (or 100 ml), rounded – e.g. from common nutrient tables
// and package labels. The coach can correct or add foods in the admin tool.
// One line per food:  Name | kcal | protein | carbohydrates | fat | unit   (grouped by "# Category")
const DATA = `
# Beilagen & Getreide
Reis (roh)|350|7|78|0.6|g
Reis (gekocht)|130|2.7|28|0.3|g
Basmatireis (roh)|350|8|77|0.6|g
Basmatireis (gekocht)|125|2.8|27|0.3|g
Jasminreis (roh)|355|7|79|0.6|g
Vollkornreis (roh)|350|7.5|74|2.5|g
Vollkornreis (gekocht)|120|2.6|25|0.9|g
Milchreis (roh)|350|7|78|0.6|g
Wildreis (roh)|355|14|72|1|g
Nudeln (roh)|355|12|71|1.5|g
Nudeln (gekocht)|150|5|30|0.7|g
Vollkornnudeln (roh)|340|14|62|2.5|g
Vollkornnudeln (gekocht)|140|5.5|26|1|g
Eiernudeln (roh)|365|13|69|3|g
Glasnudeln (roh)|350|0.2|86|0.1|g
Reisnudeln (roh)|360|6|80|0.6|g
Linsennudeln (roh)|340|25|50|2|g
Kichererbsennudeln (roh)|345|22|52|5|g
Gnocchi|150|3.5|32|0.6|g
Spätzle (frisch)|190|7|36|2|g
Kartoffeln|75|2|16|0.1|g
Kartoffeln (gekocht)|72|1.9|15|0.1|g
Süßkartoffeln|86|1.6|20|0.1|g
Kartoffelpüree (zubereitet)|90|2|13|3.5|g
Pommes frites (Backofen)|170|2.8|26|6|g
Pommes frites (frittiert)|290|3.4|36|15|g
Kroketten (Backofen)|200|3|27|9|g
Haferflocken|370|13.5|59|7|g
Haferkleie|370|17|50|9|g
Instant-Haferbrei (natur)|375|12|62|7|g
Quinoa (roh)|365|14|64|6|g
Quinoa (gekocht)|120|4.4|21|1.9|g
Couscous (roh)|355|12|72|1.9|g
Couscous (gekocht)|112|3.8|23|0.2|g
Bulgur (roh)|345|12|69|1.5|g
Bulgur (gekocht)|85|3|17|0.2|g
Hirse (roh)|360|11|69|4|g
Buchweizen (roh)|345|13|71|3.4|g
Polenta / Maisgrieß (roh)|350|8|75|1.5|g
Grieß (Weichweizen)|340|10|69|0.8|g
Amaranth (roh)|370|14|65|7|g
Dinkelflocken|355|13|63|2.5|g
Weizenmehl Type 405|340|10|71|1|g
Dinkelmehl Type 630|345|12|69|1.5|g
Vollkornmehl|320|12|60|2|g
Mandelmehl (entölt)|380|50|9|11|g
Kokosmehl|340|19|21|11|g
Cornflakes|375|7|84|0.9|g
Müsli (ungesüßt)|360|10|60|7|g
Früchtemüsli|360|8|66|5|g
Knuspermüsli|440|8|65|16|g
Granola|460|10|62|19|g
Puffreis|380|7|84|1|g
Reiswaffeln|385|8|80|3|g
Maiswaffeln|380|8|80|2.5|g
Tortilla-Wrap|300|8|50|7|g
Vollkorn-Wrap|290|10|45|7|g
Low-Carb-Wrap|240|20|12|11|g

# Brot & Backwaren
Vollkornbrot|220|7.5|39|1.5|g
Roggenbrot|215|6|42|1.2|g
Roggenmischbrot|220|6.5|43|1.3|g
Weizenmischbrot|240|7.5|46|1.5|g
Dinkelbrot|240|9|44|2|g
Pumpernickel|185|5|36|1|g
Eiweißbrot|260|24|8|14|g
Sonnenblumenkernbrot|260|9|38|7|g
Toastbrot|260|8|48|3.5|g
Vollkorntoast|245|9|42|4|g
Weizenbrötchen|270|9|52|2|g
Vollkornbrötchen|240|9|42|3|g
Laugenbrezel|275|8|55|2|g
Laugenbrötchen|270|8|53|2.5|g
Baguette|260|9|52|1.5|g
Ciabatta|265|9|50|3|g
Fladenbrot|265|8|52|2|g
Bagel|260|10|50|1.5|g
Croissant|400|8|45|21|g
Knäckebrot|340|10|68|1.5|g
Zwieback|390|10|73|5|g
Burgerbrötchen|270|9|48|4.5|g
Hot-Dog-Brötchen|265|8|48|4|g
Pita-Brot|275|9|56|1.2|g
Naan|300|9|50|7|g
Pfannkuchen (zubereitet)|220|7|28|9|g
Waffel (zubereitet)|300|7|36|14|g
Rührkuchen|400|6|50|19|g
Käsekuchen|260|7|25|14|g
Apfelstrudel|260|3|35|11|g
Donut|420|6|48|23|g
Muffin (Schoko)|420|6|50|21|g
Butterkeks|440|7|73|12|g
Vollkornkeks|460|7|65|19|g

# Fleisch & Fisch
Hähnchenbrust (roh)|105|23|0|1.2|g
Hähnchenbrust (gebraten)|155|31|0|3.2|g
Hähnchenschenkel mit Haut (roh)|215|17|0|16|g
Hähnchenschenkel ohne Haut (roh)|120|20|0|4|g
Hähnchenflügel (roh)|200|18|0|14|g
Hähnchen-Geschnetzeltes (roh)|110|23|0|1.8|g
Putenbrust (roh)|105|24|0|1|g
Putenschnitzel (roh)|105|24|0|1|g
Putenhack (roh)|150|19|0|8|g
Putenkeule (roh)|130|20|0|5.5|g
Rinderhack 5 % Fett (roh)|120|21|0|5|g
Rinderhack 10 % Fett (roh)|165|20|0|10|g
Rinderhack 20 % Fett (roh)|250|17|0|20|g
Gemischtes Hack (roh)|260|18|0|21|g
Rindersteak (Hüfte, roh)|120|22|0|4|g
Rinderfilet (roh)|120|21|0|4|g
Entrecôte (roh)|190|20|0|12|g
Roastbeef (roh)|130|22|0|5|g
Rindergulasch (roh)|125|21|0|4.5|g
Kalbsschnitzel (roh)|105|22|0|1.8|g
Schweinefilet (roh)|105|22|0|2|g
Schweineschnitzel (roh)|110|22|0|2.5|g
Schweinenacken (roh)|200|17|0|15|g
Schweinebauch (roh)|420|12|0|41|g
Kotelett (roh)|190|20|0|12|g
Lammkeule (roh)|190|18|0|13|g
Hirschfleisch (roh)|110|22|0|2|g
Entenbrust mit Haut (roh)|230|18|0|17|g
Bacon / Frühstücksspeck|420|13|1|40|g
Lachs (roh)|200|20|0|13|g
Räucherlachs|180|22|0|10|g
Lachsfilet (TK)|180|20|0|11|g
Thunfisch (Dose, im eigenen Saft)|110|25|0|1|g
Thunfisch (Dose, in Öl)|200|24|0|11|g
Thunfischsteak (roh)|110|24|0|1|g
Seelachs (roh)|80|18|0|0.9|g
Kabeljau (roh)|80|18|0|0.7|g
Rotbarsch (roh)|105|18|0|3.6|g
Pangasius (roh)|90|15|0|3|g
Forelle (roh)|110|20|0|3|g
Makrele (roh)|190|19|0|12|g
Makrele (geräuchert)|230|21|0|16|g
Hering in Tomatensauce|190|13|4|13|g
Matjes|260|16|0|22|g
Sardinen in Öl|210|24|0|13|g
Fischstäbchen (zubereitet)|200|12|17|9|g
Garnelen (roh)|80|18|0|1|g
Tintenfisch (roh)|80|16|1|1|g
Muscheln (gegart)|100|15|4|2.5|g
Surimi|95|8|14|0.5|g

# Wurst & Aufschnitt
Putenaufschnitt|105|21|1|2|g
Hähnchenaufschnitt|105|20|1.5|2|g
Kochschinken|115|20|1|3.5|g
Lachsschinken|115|21|1|3|g
Rohschinken|250|25|0|17|g
Bresaola|155|32|0|2.5|g
Salami|420|23|1|36|g
Geflügelsalami|260|22|1|19|g
Mortadella|300|14|1|27|g
Leberwurst|330|14|1.5|30|g
Fleischwurst / Lyoner|280|12|1|25|g
Wiener Würstchen|270|13|1|24|g
Geflügelwürstchen|200|14|1.5|15|g
Bratwurst (roh)|290|14|1|26|g
Geflügelbratwurst|210|16|1|16|g
Cabanossi|450|25|1|39|g
Beef Jerky|300|45|12|5|g
Leberkäse|300|12|1|28|g

# Eier & Milchprodukte
Ei (ca. 60 g pro Stück)|155|13|0.7|11|g
Eiklar|50|11|0.7|0.2|g
Eigelb|330|16|0.4|29|g
Spiegelei|195|14|0.8|15|g
Rührei (mit Milch)|160|11|1.5|12|g
Magerquark|67|12|4|0.3|g
Speisequark 20 %|110|12|3.5|5|g
Speisequark 40 %|160|11|3|11|g
Skyr|63|11|4|0.2|g
Skyr mit Frucht|80|8|11|0.2|g
High-Protein-Pudding|75|10|6|1.5|g
High-Protein-Joghurt|60|10|4|0.3|g
Naturjoghurt 3,5 %|65|3.5|4.5|3.5|g
Naturjoghurt 1,5 %|50|3.5|4.5|1.5|g
Naturjoghurt 0,1 %|35|4|4.5|0.1|g
Griechischer Joghurt 10 %|120|4|4|10|g
Griechischer Joghurt 2 %|70|9|4|2|g
Fruchtjoghurt 3,5 %|100|3.3|14|3|g
Kefir|60|3.4|4|3.5|ml
Buttermilch|38|3.5|4|0.5|ml
Hüttenkäse|100|12|3|4.5|g
Hüttenkäse light|70|13|3|1|g
Mozzarella|250|18|1|19|g
Mozzarella light|165|20|1|9|g
Burrata|250|15|1|21|g
Gouda|360|25|0|28|g
Gouda light|280|31|0|17|g
Emmentaler|380|28|0|30|g
Edamer|330|26|0|25|g
Bergkäse|400|28|0|32|g
Parmesan|400|35|0|29|g
Feta|270|17|0.7|22|g
Feta light|200|20|1|13|g
Hirtenkäse|260|16|0.5|21|g
Halloumi|320|22|2|25|g
Camembert|300|21|0|24|g
Brie|340|20|0|28|g
Harzer Käse|115|28|0|0.5|g
Ricotta|140|9|3.5|10|g
Mascarpone|430|5|3.5|44|g
Frischkäse light|140|8|5|10|g
Frischkäse (Doppelrahmstufe)|250|5|3.5|24|g
Hirtenkäse light|180|20|1|11|g
Schmelzkäse-Scheiben|270|14|5|21|g
Milch 0,1 %|35|3.5|5|0.1|ml
Milch 1,5 %|47|3.4|4.9|1.5|ml
Milch 3,5 %|64|3.3|4.8|3.5|ml
Laktosefreie Milch 1,5 %|47|3.4|4.9|1.5|ml
Kakao (Milchgetränk)|80|3.5|11|2|ml
Sahne 30 %|290|2.4|3.4|30|ml
Saure Sahne 10 %|115|3|4|10|g
Schmand 24 %|240|2.8|3.5|24|g
Crème fraîche 30 %|290|2.4|3|30|g
Kochsahne 15 %|160|3|4|15|ml
Butterkäse|350|23|0|29|g

# Pflanzliche Proteine
Tofu (natur)|120|13|1.5|7|g
Räuchertofu|150|16|1.5|9|g
Seidentofu|55|5|2|3|g
Tempeh|195|19|9|11|g
Seitan|130|25|5|2|g
Sojaschnetzel (trocken)|340|50|14|1.5|g
Edamame (TK)|120|11|8|5|g
Linsen (roh)|330|24|50|1.5|g
Rote Linsen (roh)|335|25|51|1.5|g
Linsen (gekocht)|115|9|17|0.4|g
Kichererbsen (roh)|340|19|44|6|g
Kichererbsen (Dose, abgetropft)|120|7|16|2.5|g
Kidneybohnen (Dose, abgetropft)|105|7|15|0.5|g
Weiße Bohnen (Dose, abgetropft)|90|6.5|13|0.5|g
Schwarze Bohnen (Dose, abgetropft)|95|7|14|0.5|g
Baked Beans (Dose)|80|4.7|12|0.5|g
Erbsenprotein-Pulver|380|80|3|6|g
Veganes Proteinpulver (Mix)|370|72|9|5|g
Vegane Hack-Alternative|190|18|4|11|g
Veganer Burger-Patty|230|17|6|15|g
Hummus|270|7.5|14|20|g
Falafel (gebacken)|230|8|25|11|g
Hafermilch|45|0.5|7|1.5|ml
Hafermilch Barista|60|0.6|7|3|ml
Mandelmilch (ungesüßt)|15|0.5|0.3|1.2|ml
Sojamilch (ungesüßt)|35|3.3|0.5|2|ml
Reisdrink|50|0.1|10|1|ml
Sojajoghurt (natur)|50|4|2|2.5|g
Whey-Proteinpulver|380|75|8|5|g
Casein-Proteinpulver|360|75|6|2|g
Clear Whey|360|85|2|0.5|g

# Gemüse
Brokkoli|34|2.8|4|0.4|g
Zucchini|17|1.2|2|0.3|g
Paprika|30|1|5|0.3|g
Tomaten|18|0.9|2.6|0.2|g
Cherrytomaten|25|1|3.5|0.3|g
Gurke|15|0.6|2|0.1|g
Karotten|41|0.9|7|0.2|g
Spinat|23|2.9|0.6|0.4|g
Rahmspinat (TK)|65|2.8|3.5|4.5|g
Blumenkohl|25|2|2.5|0.3|g
Rosenkohl|43|3.4|5|0.3|g
Grünkohl|49|4.3|4|0.9|g
Weißkohl|25|1.4|4|0.2|g
Rotkohl|29|1.5|4.5|0.2|g
Rotkohl (Glas)|60|1|12|0.5|g
Sauerkraut|20|1.5|1|0.3|g
Kohlrabi|25|1.9|3.7|0.1|g
Champignons|22|3|0.6|0.3|g
Pilzmischung (TK)|25|2.5|1|0.3|g
Grüne Bohnen|31|2|5|0.2|g
Blattsalat|15|1.2|1.5|0.2|g
Rucola|25|2.6|2|0.7|g
Feldsalat|20|1.8|0.7|0.4|g
Eisbergsalat|14|0.9|2|0.2|g
Zwiebeln|40|1.2|7.5|0.1|g
Rote Zwiebeln|40|1.2|8|0.1|g
Frühlingszwiebeln|30|1.8|5|0.2|g
Knoblauch|150|6|29|0.5|g
Lauch / Porree|30|2.2|3.5|0.3|g
Sellerie (Knolle)|20|1.5|2.5|0.3|g
Staudensellerie|16|0.7|2.2|0.2|g
Aubergine|25|1.2|3|0.2|g
Kürbis (Hokkaido)|40|1.7|8|0.3|g
Butternut-Kürbis|45|1|11|0.1|g
Spargel (weiß)|18|2|2|0.1|g
Spargel (grün)|20|2.2|2|0.2|g
Rote Bete (vorgegart)|45|1.5|8.5|0.1|g
Radieschen|16|1|2|0.1|g
Pak Choi|13|1.5|1.2|0.2|g
Fenchel|25|1.2|3|0.2|g
Mangold|20|2|1.5|0.3|g
Erbsen (TK)|80|5.5|11|0.5|g
Zuckerschoten|40|3|6|0.2|g
Mais (Dose, abgetropft)|85|2.7|15|1.2|g
Passierte Tomaten|30|1.4|5|0.2|g
Tomatenmark|80|4.5|13|0.5|g
Gehackte Tomaten (Dose)|25|1.2|4|0.2|g
Getrocknete Tomaten (in Öl)|220|4|11|17|g
Oliven (grün)|145|1.2|1|15|g
Oliven (schwarz)|180|1.6|3|18|g
Gewürzgurken|20|0.6|3|0.2|g
Gemüsemischung (TK)|45|2.5|6|0.4|g
Wokgemüse (TK)|35|2|5|0.3|g
Ingwer|80|1.8|16|0.8|g

# Obst
Apfel|52|0.3|11|0.2|g
Banane|90|1.1|20|0.3|g
Birne|55|0.4|12|0.1|g
Heidelbeeren|57|0.7|11|0.3|g
Erdbeeren|32|0.7|5.5|0.3|g
Himbeeren|52|1.2|5|0.7|g
Brombeeren|43|1.4|5|0.5|g
Johannisbeeren|45|1.1|7|0.2|g
Beerenmischung (TK)|45|1|7|0.4|g
Kirschen|60|1|13|0.3|g
Orange|47|0.9|9|0.1|g
Mandarine|45|0.7|10|0.3|g
Grapefruit|40|0.7|8|0.1|g
Zitrone|35|0.7|3|0.6|g
Weintrauben|70|0.7|16|0.2|g
Ananas|50|0.5|12|0.1|g
Mango|60|0.8|13|0.4|g
Kiwi|61|1.1|11|0.5|g
Pfirsich|40|0.8|9|0.1|g
Nektarine|45|1|10|0.3|g
Aprikose|45|0.9|9|0.1|g
Pflaume|47|0.6|10|0.2|g
Wassermelone|30|0.6|7|0.2|g
Honigmelone|55|0.9|12|0.1|g
Granatapfel|80|1.7|17|1.2|g
Papaya|40|0.5|9|0.1|g
Feigen (frisch)|65|1.3|13|0.4|g
Datteln (getrocknet)|290|2|65|0.4|g
Rosinen|300|2.5|68|0.5|g
Getrocknete Aprikosen|250|3.5|53|0.5|g
Getrocknete Cranberries|330|0.1|80|1.4|g
Apfelmus (ungesüßt)|55|0.3|12|0.1|g
Kokosnuss (frisch)|355|3.3|6|33|g
Obstsalat|55|0.6|12|0.2|g

# Fette, Nüsse & Samen
Olivenöl|884|0|0|100|g
Rapsöl|884|0|0|100|g
Sonnenblumenöl|884|0|0|100|g
Kokosöl|890|0|0|99|g
Leinöl|884|0|0|100|g
Butter|740|0.7|0.6|83|g
Halbfettbutter|370|3|2|39|g
Margarine|720|0.2|0.5|80|g
Ghee|880|0|0|99.5|g
Erdnussbutter|590|25|14|50|g
Mandelmus|620|21|7|55|g
Cashewmus|610|19|25|48|g
Tahin / Sesammus|600|17|11|54|g
Mandeln|600|21|6|52|g
Walnüsse|655|15|7|65|g
Haselnüsse|630|15|10|61|g
Cashewkerne|575|18|30|44|g
Erdnüsse (geröstet, gesalzen)|600|25|12|50|g
Pistazien|570|20|18|45|g
Macadamia|720|8|5|76|g
Paranüsse|660|14|4|67|g
Pekannüsse|690|9|4|72|g
Studentenfutter|470|13|38|30|g
Avocado|160|2|1.5|15|g
Chiasamen|490|17|8|31|g
Leinsamen|535|18|2|42|g
Sonnenblumenkerne|580|21|12|49|g
Kürbiskerne|560|30|11|46|g
Sesam|580|18|10|50|g
Hanfsamen (geschält)|580|31|5|49|g
Kokosraspeln|660|6|7|62|g

# Süßes & Snacks
Honig|305|0.4|76|0|g
Zucker|400|0|100|0|g
Ahornsirup|260|0|67|0.1|g
Agavendicksaft|310|0|76|0|g
Konfitüre|250|0.4|60|0.1|g
Nuss-Nougat-Creme|540|6|57|31|g
Zartbitterschokolade 70 %|580|9|34|42|g
Zartbitterschokolade 85 %|600|11|20|50|g
Vollmilchschokolade|540|7|56|31|g
Weiße Schokolade|550|6|58|33|g
Schokoriegel (Karamell)|480|4.5|65|22|g
Proteinriegel|350|33|30|12|g
Müsliriegel|420|6|65|14|g
Fruchtgummi|340|6|77|0.2|g
Lakritz|350|3|78|0.5|g
Kekse (Schoko)|500|6|62|25|g
Chips (Kartoffel)|540|6|50|34|g
Tortilla-Chips|500|7|60|25|g
Salzstangen|380|10|78|2|g
Popcorn (gesalzen)|480|9|57|23|g
Popcorn (Luft, ohne Fett)|380|12|74|4|g
Speiseeis (Vanille)|210|3.5|24|11|g
Protein-Eis|130|10|14|4|g
Sorbet|130|0.3|32|0|g
Pudding (Schoko, zubereitet)|110|3.3|17|3|g
Milchschnitte|420|8|36|27|g
Gummibärchen (zuckerfrei)|230|5|72|0.3|g
Reiswaffeln mit Schokolade|480|7|62|22|g

# Getränke
Wasser|0|0|0|0|ml
Kaffee (schwarz)|2|0.1|0|0|ml
Cappuccino|35|2|3|1.8|ml
Latte Macchiato|45|2.4|3.5|2.4|ml
Tee (ungesüßt)|1|0|0.2|0|ml
Orangensaft|45|0.7|10|0.2|ml
Apfelsaft|45|0.1|11|0.1|ml
Apfelschorle|24|0.1|5.5|0|ml
Multivitaminsaft|50|0.3|11|0.1|ml
Smoothie (Frucht)|55|0.6|12|0.2|ml
Cola|42|0|10.6|0|ml
Cola zero|0.3|0|0|0|ml
Limonade|40|0|10|0|ml
Eistee|30|0|7.5|0|ml
Energy Drink|45|0|11|0|ml
Energy Drink (zuckerfrei)|3|0|0.5|0|ml
Iso-Getränk|25|0|6|0|ml
Proteinshake (fertig)|60|10|3.5|0.8|ml
Bier|43|0.5|3.1|0|ml
Bier alkoholfrei|25|0.3|5.5|0|ml
Radler|35|0.3|6|0|ml
Weißwein|80|0.1|2.6|0|ml
Rotwein|85|0.1|2.6|0|ml
Sekt|85|0.1|5|0|ml
Gin|260|0|0|0|ml
Vodka|230|0|0|0|ml

# Saucen, Würzen & Aufstriche
Ketchup|110|1.2|25|0.2|g
Ketchup (zuckerreduziert)|45|1.5|8|0.2|g
Mayonnaise|720|1|1.5|79|g
Mayonnaise light|300|0.5|9|29|g
Senf|80|5.5|6|4|g
Süßer Senf|120|4|20|3|g
BBQ-Sauce|150|1|35|0.5|g
Sojasauce|55|8|5|0.1|ml
Teriyakisauce|100|4|19|0.1|ml
Sweet-Chili-Sauce|200|0.4|48|0.3|g
Sriracha|95|2|19|1|g
Pesto (Basilikum)|450|5|5|46|g
Tomatensauce (Glas)|50|1.5|8|1.3|g
Bolognese-Sauce (Glas)|80|5|5|4|g
Currysauce|110|1.5|18|3.5|g
Hollandaise|500|1.5|4|53|g
Tzatziki|110|4|4|8|g
Guacamole|150|1.8|5|14|g
Salatdressing (Joghurt)|140|1.5|8|11|ml
Balsamico-Essig|90|0.5|17|0|ml
Salatcreme|300|1|15|26|g
Gemüsebrühe (zubereitet)|5|0.2|0.6|0.2|ml
Hühnerbrühe (zubereitet)|7|0.6|0.5|0.3|ml
Kakaopulver (entölt)|360|23|11|21|g
Zimt|250|4|55|1.2|g
Erythrit|0|0|100|0|g
Xylit|240|0|100|0|g

# Fertiggerichte & Fast Food
Pizza Margherita (TK)|240|9|30|9|g
Pizza Salami (TK)|260|10|28|12|g
Lasagne (TK)|140|7|13|6.5|g
Döner Kebab (im Brot)|215|11|21|10|g
Dürüm|210|10|23|9|g
Hamburger|250|12|29|9|g
Cheeseburger|265|13|29|11|g
Chicken Nuggets|270|15|17|16|g
Currywurst mit Sauce|220|9|9|17|g
Bratkartoffeln|150|2.5|18|7.5|g
Wiener Schnitzel (paniert)|230|19|11|12|g
Frikadelle|250|15|8|18|g
Sushi (Maki)|150|4|30|1|g
Ramen (Instant, zubereitet)|90|2.2|12|3.5|g
Gyros (Fleisch)|220|18|2|16|g
Chili con Carne|105|7.5|9|4|g
Gulaschsuppe|70|5|4|3.5|ml
Linseneintopf|80|5|10|2|g
Kartoffelsalat (Mayonnaise)|190|2|13|14|g
Nudelsalat|190|4|20|10|g
Caesar Salad (mit Dressing)|160|8|6|12|g
Overnight Oats (zubereitet)|150|6|20|5|g
Porridge mit Milch|110|4.5|16|3|g
Proteinpancakes (zubereitet)|180|17|18|4|g

# Sonstiges
Kokosmilch|195|2|3|20|ml
Kokosmilch light|80|0.8|2|7.5|ml
Gelatine|340|85|0|0|g
Kreatin|0|0|0|0|g
`;

const foods = [];
let category = 'Sonstiges';
for (const raw of DATA.split('\n')) {
  const line = raw.trim();
  if (!line) continue;
  if (line.startsWith('#')) {
    category = line.slice(1).trim();
    continue;
  }
  const [name, kcal, protein, carbs, fat, unit] = line.split('|');
  foods.push([name, Number(kcal), unit, category, Number(protein), Number(carbs), Number(fat)]);
}

// [name, kcal, unit, category, protein, carbs, fat] – the first four keep the format older code expects
module.exports = foods;
