# Fitness Tracker (Coach & Klient)

Web-App, in der Klienten täglich **Gewicht, Schritte und Schlaf** eintragen und der Coach jederzeit **Einsicht in alle Einträge** hat.

## Funktionen

**Klient** (optimiert fürs Handy, lässt sich als App auf den Homescreen legen)
- Tageseintrag: Gewicht (kg), Schritte, Schlaf (Std./Min.), optionale Notiz
- Werte können über den Tag nachgetragen werden; vergangene Tage lassen sich bearbeiten oder löschen
- Übersicht: aktuelles Gewicht, Veränderung in 7 Tagen und insgesamt, Ø Schritte und Ø Schlaf der letzten 7 Tage, Serie
- Diagramme: Gewichtsverlauf mit 7-Tage-Durchschnitt, Schritte und Schlaf als Balken (Zeiträume 30 T / 90 T / 1 J / Alle)

**Coach**
- Übersicht aller Klienten: letzter Eintrag (farbig markiert, wenn jemand nicht einträgt), Gewicht und Veränderung, Ø Schritte und Ø Schlaf
- Detailansicht je Klient mit allen Diagrammen und Einträgen (nur lesen)
- Ziele festlegen (Zielgewicht, Schritte pro Tag, Schlaf pro Nacht); der Klient sieht sie in seiner Übersicht
- Klienten anlegen, umbenennen, Passwort neu vergeben, löschen
- CSV-Export (öffnet sich direkt in Excel)

Klienten sehen immer nur ihre eigenen Daten.

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

Die App braucht einen Server mit **dauerhaftem Speicher** für die Datei `tracker.db`. Ein reines Static Hosting wie GitHub Pages oder Netlify reicht nicht.

| Variable | Bedeutung |
|---|---|
| `PORT` | Port (Standard 3000) |
| `DATA_DIR` | Ordner für die Datenbank (Standard `./data`) |
| `COACH_USERNAME`, `COACH_PASSWORD`, `COACH_NAME` | Coach-Konto beim ersten Start |
| `NODE_ENV=production` oder `SECURE_COOKIES=true` | Login-Cookie nur über HTTPS (im Live-Betrieb setzen) |

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
