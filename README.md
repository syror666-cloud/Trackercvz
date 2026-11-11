# Thabstracker (Coach & Klient)

Web-App, in der Klienten täglich **Gewicht, Schritte und Schlaf** eintragen und der Coach jederzeit **Einsicht in alle Einträge** hat.

## Funktionen

**Klient** (optimiert fürs Handy, lässt sich als App auf den Homescreen legen)
- Tageseintrag: Gewicht (kg), Schritte, Schlaf (Std./Min.), Trainingstag ja/nein, Kalorienplan eingehalten ja/nein (bei Nein optional die gegessenen Kalorien), optionale Notiz
- Werte können über den Tag nachgetragen werden; vergangene Tage lassen sich bearbeiten oder löschen
- Übersicht: aktuelles Gewicht, Veränderung in 7 Tagen und insgesamt, Ø Schritte und Ø Schlaf der letzten 7 Tage, Serie
- Diagramme: Gewichtsverlauf mit 7-Tage-Durchschnitt, Schritte und Schlaf als Balken (Zeiträume 30 T / 90 T / 1 J / Alle)
- **Nachrichten:** eigener Chat mit dem Coach für Wünsche, Fragen und Vorschläge
- **Ernährungsplan** vom Coach mit Mengen und Kalorien; einzelne Lebensmittel oder ganze Mahlzeiten zum Tausch anfragen (Coach entscheidet)
- **Check-in vom Coach** oben in der Übersicht: Feedback lesen, antworten oder vorgeschlagene Plananpassungen mit einem Klick annehmen. Check-in und Annahme laufen im Hintergrund; nur die Antwort des Klienten landet im Chat
- **Kalorien:** Zielkalorien als Range (z. B. 2.200–2.300 kcal) mit Diagramm: Range als Band, Mittelwert als Linie, pro Tag eingehalten/nicht eingehalten
- **Push-Benachrichtigungen** (nach Zustimmung): Erinnerungen des Coaches und neue Chat-Nachrichten. Auf dem iPhone nur, wenn die Seite zum Home-Bildschirm hinzugefügt wurde (ab iOS 16.4)
- **Apple Health:** automatische Übertragung von Schritten (optional Gewicht) über einen Kurzbefehl der Apple-App „Kurzbefehle“ mit persönlichem Schlüssel (Anleitung direkt in der App unter „Einstellungen“)

**Coach**
- Übersicht aller Klienten: letzter Eintrag (farbig markiert, wenn jemand nicht einträgt), Gewicht und Veränderung, Ø Schritte und Ø Schlaf
- Detailansicht je Klient mit allen Diagrammen und Einträgen (nur lesen)
- Ziele festlegen (Zielgewicht, Schritte pro Tag, Schlaf pro Nacht); der Klient sieht sie in seiner Übersicht
- Klienten anlegen, umbenennen, Passwort neu vergeben, löschen
- CSV-Export (öffnet sich direkt in Excel)
- **Wöchentlicher Check-in:** alle Klienten in einer Reihe nacheinander abarbeiten; Wochenvergleich (letzte 7 Tage vs. Vorwoche) mit Gewicht, Schritten, Schlaf, Trainingstagen, Einhaltung des Kalorienplans, Tagesdetails und Diagrammen; Nachricht schreiben und Plan anpassen (Zielkalorien als Range, Schritte, Schlaf, Zielgewicht); der Klient nimmt Anpassungen per Klick an, der Plan wird dann automatisch aktualisiert
- **Plan:** Kalorien pro Tag, Schritte, Schlaf und Zielgewicht; jede Änderung wird im Verlauf gespeichert
- **Ernährungsplan** pro Klient: Mahlzeiten aus der Lebensmittel-Datenbank zusammenstellen, Tauschwünsche per Klick kcal-gleich übernehmen, selbst anpassen oder ablehnen (Push bei neuen Wünschen)
- **Admin-Tool:** Logins, App-Nutzung und Tage ohne Eintrag je Klient; automatische Push-Erinnerung nach X Tagen ohne Eintrag (täglich zu fester Uhrzeit, auch in der Push-Übersicht verlinkt); Lebensmittel-Datenbank mit ca. 100 üblichen Lebensmitteln (kcal pro 100 g/ml), eigene Lebensmittel anlegen und bearbeiten
- **Nachrichten:** ein Chat pro Klient; ungelesene Nachrichten werden in der Übersicht und in der Navigation angezeigt
- **Push-Benachrichtigungen:** einmalig (sofort oder geplant) und wiederkehrend (täglich oder an bestimmten Wochentagen), an alle oder ausgewählte Klienten; Übersicht, wer zugestimmt, abgelehnt oder noch nicht entschieden hat
- Sehen, ob ein Klient Apple Health verbunden hat und wann zuletzt Daten kamen

Klienten sehen immer nur ihre eigenen Daten und ihren eigenen Chat.

Design: redaktionell und fast monochrom – Graphit auf warmem Grau/Weiß, Ember-Orange als einziger Akzent, Brass als zweiter. Überschriften in Space Grotesk, Text in Inter (beide selbst gehostet, keine Verbindung zu Google Fonts). Dark Mode in Schwarz/Orange, folgt automatisch der Geräteeinstellung.

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
