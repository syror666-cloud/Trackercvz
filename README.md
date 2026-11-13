# StayOnTrack (Coach & Klient)

Web-App, in der Klienten täglich **Gewicht, Schritte und Schlaf** eintragen und der Coach jederzeit **Einsicht in alle Einträge** hat.

## Funktionen

**Klient** (optimiert fürs Handy, lässt sich als App auf den Homescreen legen)
- Große grüne „Gespeichert“-Bestätigung nach dem Speichern
- Konto (Profilbild-Menü oben rechts): Profilbild, Name, Benutzername und Passwort ändern
- Auf dem Handy: Navigation als Leiste unten, Pull to refresh (nach unten ziehen zum Aktualisieren)
- Begrüßung nach Tageszeit (Guten Morgen bis 11 Uhr, Guten Mittag bis 14 Uhr, Nachmittag, Abend, Nacht)
- Check-in mit „Highlights deiner Woche“: Gewicht im Wochenschnitt > 0,6 % in Zielrichtung, Schrittziel an mehr als 5 Tagen, Schlafziel in mindestens 5 Nächten (nur wenn etwas erreicht wurde)
- Tageseintrag: Gewicht (kg), Schritte, Schlaf (Std./Min.), Trainingstag ja/nein, Kalorienplan eingehalten ja/nein (bei Nein optional die gegessenen Kalorien), optionale Notiz
- Werte können über den Tag nachgetragen werden; vergangene Tage lassen sich bearbeiten oder löschen
- Übersicht: aktuelles Gewicht, Veränderung in 7 Tagen und insgesamt, Ø Schritte und Ø Schlaf der letzten 7 Tage, Serie
- Diagramme: Gewichtsverlauf mit 7-Tage-Durchschnitt, Schritte und Schlaf als Balken (Zeiträume 30 T / 90 T / 1 J / Alle)
- **Nachrichten:** eigener Chat mit dem Coach für Wünsche, Fragen und Vorschläge
- **Ernährungsplan anfragen:** ohne Plan kann der Klient seinen Coach um einen Plan bitten – mit kurzem Multiple-Choice-Fragebogen (Ernährungsform, was nicht geht, bevorzugte Proteinquellen, Mahlzeiten pro Tag, Budget, Kochzeit, Meal Prep, Anmerkung). Der Coach bekommt eine Push-Nachricht, eine Aufgabe im Dashboard und sieht die Antworten beim Klienten; mit der ersten Mahlzeit ist die Anfrage erledigt
- **Ernährungsplan** vom Coach mit Mengen, Kalorien und Makros (Eiweiß, Kohlenhydrate, Fett) pro Lebensmittel, Mahlzeit und Tag; einzelne Lebensmittel oder ganze Mahlzeiten zum Tausch anfragen (Coach entscheidet)
- **Hall of Fame** (Profilbild oben rechts → Konto → Hall of Fame): Medaillen in Bronze, Silber und Gold (1, 2 bzw. 3 Token wert) mit kleinen Animationen – z. B. 7/14/30 Tage in Folge getrackt, 100k/250k/750k Schritte, Schrittziel- und Schlafziel-Tage, Gewicht eingetragen, Kalorien eingehalten, Trainings, bewegte Tonnen, neue Bestleistungen, angenommene Check-ins. Noch nicht erreichte Stufen sind ausgegraut mit Ziel und Fortschritt in %; neu freigeschaltete werden gefeiert. Weitere Erfolge lassen sich in `src/achievements.js` ergänzen
- **Kühlschrank & Shop** (Hall of Fame): verdiente Medaillen sind die Währung – im Shop gibt es Monster-Ultra-Dosen in zwölf Sorten (1–3 Token), einen McDonald's Becher (legendär, 3 Token) und ein Vial Testosteron-Öl (mythisch, 5 Token). Gekaufte Dosen stehen im Kühlschrank; beim Öffnen gleitet man in einer 3D-Animation in den Pixel-Art-Kühlschrank hinein
- **Seltenheiten:** Gewöhnlich, Selten, Episch, Legendär, Mythisch – mit animiertem Edelstein über der Dose; im Kühlschrank stehen die seltensten oben links. Gekühlte Dosen mit abperlenden Tropfen; ein leerer Kühlschrank hat Spinnweben und zwei Fliegen
- **Einstellungen → Darstellung:** Sprache (Deutsch, Englisch, Spanisch, Italienisch), Erscheinungsbild (System, Hell, Dunkel) und **Liquid Glass** (gläserne Leisten und Menüs nach dem aktuellen iOS-Design) – pro Person gespeichert, gilt auf allen Geräten
- **Trainingsplan** (eigener Tab, auch in der Handy-Leiste): Trainingstage pro Woche wählen, dann einen Standard-Split (Ganzkörper, Upper/Lower, Push/Pull/Legs, Torso/Limbs, Upper/Lower + PPL, Arnold, Bro-Split) oder „Eigener Split“; Übungen per + ergänzen, Plan speichern. Im Training Gewicht und Wiederholungen pro Satz eintragen – beim nächsten Mal stehen die letzten Werte schon drin. „Trainingshistorie“ zeigt pro Übung den Verlauf des schwersten Satzes
- **Übungs-Anleitungen:** neben jeder Standard-Übung ein „i“ – öffnet Start- und Endfoto, Zielmuskeln, Ausführung in Schritten und einen Tipp. Vorlagen arbeiten mit 2–3 Sätzen und 6–8 bzw. 8–10 Wiederholungen. Fotos: [Free Exercise DB](https://github.com/yuhonas/free-exercise-db), gemeinfrei (Unlicense)
- **Check-in vom Coach** oben in der Übersicht: Feedback lesen, antworten oder vorgeschlagene Plananpassungen mit einem Klick annehmen. Check-in und Annahme laufen im Hintergrund; nur die Antwort des Klienten landet im Chat
- **Kalorien:** Zielkalorien als Range (z. B. 2.200–2.300 kcal) mit Diagramm: Range als Band, Mittelwert als Linie, pro Tag eingehalten/nicht eingehalten
- **Push-Benachrichtigungen** (nach Zustimmung; Chat-Nachrichten des Coaches erscheinen nur als „Du hast eine neue Nachricht von deinem Coach“, ohne Inhalt): Erinnerungen des Coaches und neue Chat-Nachrichten. Auf dem iPhone nur, wenn die Seite zum Home-Bildschirm hinzugefügt wurde (ab iOS 16.4)
- **Head2Head:** Klienten fordern sich gegenseitig heraus (Schritte, Trainingstage, bewegtes Gewicht, Dranbleiben, Gewicht verlieren in %, Schlafziel, Kalorienziel; 1, 2 oder 4 Wochen) und vergleichen ihren Verlauf. Freiwillig: Sichtbar ist nur, wer Head2Head einschaltet, und verglichen wird nur die Disziplin des Duells
- **PDF-Berichte:** Ernährungsplan und Wochen-Check-in als PDF (Download in der App; automatisch per E-Mail an bestätigte Adressen, Check-in mit Kennzahlen im Vergleich zur Vorwoche, Diagrammen und Coach-Kommentar; vom Klienten abbestellbar). Schrift: Inter (SIL OFL, `src/pdf-fonts/`)
- **Anmelden mit Benutzername oder E-Mail;** Passwort vergessen → Link per E-Mail (nur an bestätigte Adressen)
- **Ernährungstagebuch** mit Barcode-Scanner: Packung scannen (Kamera, eingebauter `BarcodeDetector` oder mitgeliefertes ZXing unter `public/vendor/`, Apache-2.0) oder Nummer eintippen, aus der Datenbank wählen oder selbst eintragen. Kalorien und Makros pro Tag gegen die Ziele; die Tageskalorien landen automatisch im Tracker. Produktdaten: rund 320.000 Produkte aus DE/AT/CH von [Open Food Facts](https://world.openfoodfacts.org) (ODbL) sind mitgeliefert (`src/data/`, beim ersten Start wird daraus `products.db` im Datenordner gebaut, ca. 50 MB, 2 Sekunden); fehlende Produkte werden online bei Open Food Facts gesucht, notfalls direkt vom Handy aus, und von Klienten eingetragene Produkte für den nächsten Scan gemerkt. Markenprodukte sind auch per Name suchbar. Die Kamera braucht HTTPS
- **Google Health:** Klienten verbinden ihr Google-Konto (Einstellungen → Google Health); Schritte (Tagessumme) und Schlafdauer (ohne Nickerchen) werden beim Verbinden für 14 Tage und danach alle 2 Stunden übernommen – aus Fitbit, Pixel Watch und Health Connect. Nur lesend, Refresh-Token verschlüsselt gespeichert, jederzeit trennbar
- **Apple Health:** vorerst deaktiviert (der Code ist noch da; `createApp({ health: true })` schaltet die Import-Schnittstelle wieder ein)

**Coach**
- Reiter **Nachrichten** mit allen Chats auf einer Seite (Liste mit Vorschau und ungelesenen Nachrichten, Chat daneben; am Handy Liste → Chat)
- Dashboard über den Klienten: ungelesene Nachrichten, Gewicht heute offen, offene Check-ins (nur Samstag/Sonntag), Tauschwünsche, nicht angenommene Plananpassungen, Klienten ohne Eintrag seit 2+ Tagen
- Übersicht aller Klienten: letzter Eintrag (farbig markiert, wenn jemand nicht einträgt), Gewicht und Veränderung, Ø Schritte und Ø Schlaf
- Detailansicht je Klient mit allen Diagrammen und Einträgen (nur lesen)
- Ziele festlegen (Zielgewicht, Schritte pro Tag, Schlaf pro Nacht); der Klient sieht sie in seiner Übersicht
- Klienten anlegen, umbenennen, Passwort neu vergeben, löschen
- CSV-Export (öffnet sich direkt in Excel)
- **Wöchentlicher Check-in:** alle Klienten in einer Reihe nacheinander abarbeiten; Wochenvergleich (letzte 7 Tage vs. Vorwoche) mit Gewicht, Schritten, Schlaf, Trainingstagen, Einhaltung des Kalorienplans, Tagesdetails und Diagrammen; Nachricht schreiben und Plan anpassen (Zielkalorien als Range, Schritte, Schlaf, Zielgewicht); der Klient nimmt Anpassungen per Klick an, der Plan wird dann automatisch aktualisiert
- **Plan:** Kalorien pro Tag, Schritte, Schlaf und Zielgewicht; jede Änderung wird im Verlauf gespeichert
- **Hall of Fame** pro Klient (Tab „Hall of Fame“): alle Medaillen und Fortschritte deines Klienten, dazu sein Kühlschrank
- **Darstellung** unter Konto: Sprache, Hell/Dunkel/System und Liquid Glass
- **Trainingsplan** pro Klient (Tab „Trainingsplan“): denselben Plan wie der Klient sehen, bearbeiten und die Trainingshistorie ansehen; der Klient bekommt einen Push, wenn du den Plan änderst
- **KI (optional, mit `ANTHROPIC_API_KEY`):** im Check-in auf Knopfdruck eine Zusammenfassung der Woche (nur auf Anfrage, wird gespeichert und nicht automatisch neu erstellt); bei einer Ernährungsplan-Anfrage ein Planentwurf aus Wünschen, Kalorienziel und Lebensmittel-Datenbank, den du prüfst, änderst und dann abschickst. Namen von Klienten werden nicht an die KI geschickt
- **Ernährungsplan** pro Klient: Mahlzeiten aus der Lebensmittel-Datenbank zusammenstellen, Tauschwünsche per Klick kcal-gleich übernehmen, selbst anpassen oder ablehnen (Push bei neuen Wünschen); Makroziele pro Tag festlegen; das Ernährungstagebuch des Klienten lesen
- **Kategorien** (nur für den Coach sichtbar): Diät, Reverse Diät, Aufbau, Maintenance – als farbige Markierung in Übersicht, Check-in und Admin-Tool
- **Zusatzmaße je Kategorie**, im Admin-Tool zuordenbar: Zahlenwerte wie Bauchumfang (Feld im Tageseintrag + Verlaufsdiagramm) und Kraft-PRs (Übung, Gewicht, Wiederholungen; Rekorde werden erkannt, Push an den Coach); beides auch im Check-in-Wochenvergleich
- **Admin-Tool:** Logins, App-Nutzung und Tage ohne Eintrag je Klient; automatische Gewichts-Erinnerung (täglich, Standard 18 Uhr, an alle ohne Gewicht von heute); automatische Push-Erinnerung nach X Tagen ohne Eintrag (täglich zu fester Uhrzeit, auch in der Push-Übersicht verlinkt); Lebensmittel-Datenbank mit rund 600 üblichen Lebensmitteln inkl. Fitness & Sporternährung (kcal und Makros pro 100 g/ml), eigene Lebensmittel anlegen und bearbeiten
- **Nachrichten:** ein Chat pro Klient; ungelesene Nachrichten werden in der Übersicht und in der Navigation angezeigt
- **Push-Benachrichtigungen:** einmalig (sofort oder geplant) und wiederkehrend (täglich oder an bestimmten Wochentagen), an alle oder ausgewählte Klienten; Übersicht, wer zugestimmt, abgelehnt oder noch nicht entschieden hat

Klienten sehen immer nur ihre eigenen Daten und ihren eigenen Chat.

Design: Farbschema Soft Blue (#B6DFED), Midnight Navy (#002941) und Coral (#FD6E6E) – Navy für Text und Hauptaktionen, Coral als Akzent, Soft Blue für hervorgehobene Flächen. Überschriften in Space Grotesk, Text in Inter (beide selbst gehostet, keine Verbindung zu Google Fonts). Dark Mode in Navy mit Coral, folgt automatisch der Geräteeinstellung.

## Lokal starten

Voraussetzung: **Node.js 22.5 oder neuer**. Es gibt keine weiteren Abhängigkeiten, die Datenbank ist das in Node eingebaute SQLite.

```bash
COACH_USERNAME=coach COACH_PASSWORD='ein-sicheres-passwort' npm start
# → http://localhost:3000
```

Beim ersten Start wird mit `COACH_USERNAME`/`COACH_PASSWORD` das Coach-Konto angelegt (optional `COACH_NAME` als Anzeigename). Alternativ:

```bash
npm run create-coach -- coach 'ein-sicheres-passwort' "Mein Name"
```

Danach meldest du dich als Coach an und legst unter **„+ Neuer Klient“** den Zugang für deinen Klienten an. Die Zugangsdaten kannst du kopieren und ihm schicken.

## Online stellen

**Schritt-für-Schritt-Anleitung für Render: siehe [HOSTING.md](HOSTING.md).**

Die App braucht einen Server mit **dauerhaftem Speicher** für die Datei `tracker.db`. Ein reines Static Hosting wie GitHub Pages oder Netlify reicht nicht.

| Variable | Bedeutung |
|---|---|
| `PORT` | Port (Standard 3000) |
| `DATA_DIR` | Ordner für die Datenbank (Standard `./data`) |
| `COACH_USERNAME`, `COACH_PASSWORD`, `COACH_NAME` | Coach-Konto beim ersten Start |
| `NODE_ENV=production` oder `SECURE_COOKIES=true` | Login-Cookie nur über HTTPS (im Live-Betrieb setzen) |
| `APP_TIMEZONE` | Zeitzone für geplante Push-Nachrichten und Health-Importe (Standard `Europe/Berlin`) |
| `VAPID_SUBJECT` | optional: Kontakt für Push-Dienste, z. B. `mailto:du@deine-domain.de` (sonst die Adresse der Seite) |
| `ANTHROPIC_API_KEY` | optional: schaltet die KI-Funktionen für den Coach ein (Check-in-Zusammenfassung, Ernährungsplan-Entwurf) |
| `AI_MODEL` | optional: Claude-Modell (Standard `claude-opus-5-5`; am günstigsten `claude-haiku-5-5`) |
| `AI_EFFORT` | optional: `low`, `medium` (Standard) oder `high` – wie gründlich die KI nachdenkt |
| `AI_AUTO_DRAFT` | `false` = bei einer Plan-Anfrage nicht automatisch einen KI-Entwurf erstellen |
| `AI_AUTO_DRAFT_MINUTES` | höchstens ein automatischer KI-Entwurf pro Klient in diesem Zeitraum (Standard `30`); dein Knopf „Neu erstellen“ ist nicht begrenzt |
| `MAIL_FROM` | Absender für E-Mails (Passwort zurücksetzen, Adresse bestätigen), z. B. `StayOnTrack <noreply@mail.stayontrack.cloud>` – die Domain muss bei Resend bestätigt sein. Admin → „E-Mail-Versand“ zeigt den Absender und schickt eine Test-Mail |
| `RESEND_API_KEY` | E-Mail über [Resend](https://resend.com) (HTTPS, funktioniert auch auf Renders Gratis-Plan, der SMTP-Ports sperrt) |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` | alternativ: eigener Mailserver (z. B. Brevo, IONOS, Strato, Gmail mit App-Passwort); Port 465 = TLS, 587 = STARTTLS |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | optional: Google Health (Schritte und Schlaf automatisch), siehe unten |
| `GOOGLE_TOKEN_KEY` | optional: eigener Schlüssel zum Verschlüsseln der Google-Tokens (sonst aus dem Clientschlüssel abgeleitet) |
| `LEGAL_NAME`, `LEGAL_ADDRESS`, `LEGAL_EMAIL`, `LEGAL_PHONE` | Betreiberangaben für `/datenschutz` und `/impressum` (Adresszeilen mit `|` trennen, z. B. `Musterweg 1|12345 Musterstadt`) |
| `APP_URL` | Adresse der App für Links in E-Mails, z. B. `https://stayontrack.onrender.com` (auf Render automatisch über `RENDER_EXTERNAL_URL`) |

**Google Health einrichten (Schritte und Schlaf automatisch):**
1. [console.cloud.google.com](https://console.cloud.google.com) → neues Projekt anlegen (z. B. „StayOnTrack“).
2. **APIs & Dienste → Bibliothek** → „Google Health API“ suchen → **Aktivieren**.
3. **Google Auth Platform → Branding:** App-Name „StayOnTrack“, Support-E-Mail, Logo optional, App-Domain `stayontrack.cloud`. **Zielgruppe:** „Extern“, Veröffentlichungsstatus **„In Produktion“** (im Testmodus laufen Verbindungen nach 7 Tagen ab).
4. **Datenzugriff:** die Bereiche `…/auth/googlehealth.activity_and_fitness.readonly` und `…/auth/googlehealth.sleep.readonly` hinzufügen.
5. **Clients → Client erstellen:** Typ „Webanwendung“, autorisierte Weiterleitungs-URI `https://<deine-app>/api/google/callback` (genau deine App-Adresse, z. B. die `onrender.com`-Adresse).
6. Client-ID und Clientschlüssel auf Render als `GOOGLE_CLIENT_ID` und `GOOGLE_CLIENT_SECRET` eintragen. Optional `GOOGLE_TOKEN_KEY` (beliebige lange Zufallszeichenkette) für die Verschlüsselung der gespeicherten Tokens.

Ohne Prüfung durch Google sehen Klienten beim Verbinden den Hinweis „Google hat diese App nicht überprüft“ (→ „Erweitert“ → „Weiter zu StayOnTrack“), und es können höchstens 100 Personen verbunden werden.

**E-Mail einrichten (für „Passwort vergessen“):** Ohne E-Mail-Versand können sich Klienten trotzdem mit ihrer E-Mail-Adresse anmelden; nur das Zurücksetzen per Mail ist dann aus. Am einfachsten: bei Resend ein Konto anlegen, die eigene Domain bestätigen, einen API-Key erzeugen und `RESEND_API_KEY` sowie `MAIL_FROM` (Adresse dieser Domain) setzen. Zurücksetzen geht nur an **bestätigte** Adressen; Links sind 60 Minuten gültig und nur einmal nutzbar.

**Mit Docker** (z. B. auf einem eigenen VPS, Railway, Fly.io oder Render mit Persistent Disk):

```bash
docker build -t fitness-tracker .
docker run -d -p 3000:3000 -v tracker-data:/data \
  -e COACH_USERNAME=coach -e COACH_PASSWORD='ein-sicheres-passwort' fitness-tracker
```

Wichtig:
- Das Volume bzw. die Disk muss auf `/data` (oder deinen `DATA_DIR`) gemountet sein, sonst gehen die Daten bei einem Neustart verloren.
- Betreib die App nur über **HTTPS**. Die genannten Plattformen machen das automatisch, auf einem eigenen Server z. B. mit Caddy oder nginx davor.
- Backup: Regelmäßig die Datei `tracker.db` sichern.

## Entwicklung

```bash
npm test
```

Aufbau: `server.js` startet den Server, `src/app.js` enthält die API und die Auslieferung der Seiten, `src/db.js` das Datenbankschema und das Passwort-Hashing (scrypt), `public/` das Frontend (ohne Build-Schritt).

**Bei jedem Update:** In `public/app.js` oben in `CHANGELOG` einen neuen Eintrag (neue `id`, Punkte für Klient und Coach) ganz nach vorne setzen. Jeder sieht beim nächsten App-Start einmal, was neu ist – wer mehrere Updates verpasst hat, sieht alle (die neuesten zuerst).
