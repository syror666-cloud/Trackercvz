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
- **Ernährungsplan** vom Coach mit Mengen und Kalorien; einzelne Lebensmittel oder ganze Mahlzeiten zum Tausch anfragen (Coach entscheidet)
- **Hall of Fame** (Profilbild oben rechts → Konto → Hall of Fame): Medaillen in Bronze, Silber und Gold mit kleinen Animationen – z. B. 7/14/30 Tage in Folge getrackt, 100k/250k/750k Schritte, Schrittziel- und Schlafziel-Tage, Gewicht eingetragen, Kalorien eingehalten, Trainings, bewegte Tonnen, neue Bestleistungen, angenommene Check-ins. Noch nicht erreichte Stufen sind ausgegraut mit Ziel und Fortschritt in %; neu freigeschaltete werden gefeiert. Weitere Erfolge lassen sich in `src/achievements.js` ergänzen
- **Kühlschrank & Shop** (Hall of Fame): verdiente Medaillen sind die Währung – im Shop gibt es Monster-Ultra-Dosen in zwölf Sorten für je 1–3 Medaillen. Gekaufte Dosen stehen im Kühlschrank; beim Öffnen gleitet man in einer 3D-Animation in den Pixel-Art-Kühlschrank hinein
- **Einstellungen → Darstellung:** Sprache (Deutsch, Englisch, Spanisch, Italienisch), Erscheinungsbild (System, Hell, Dunkel) und **Liquid Glass** (gläserne Leisten und Menüs nach dem aktuellen iOS-Design) – pro Person gespeichert, gilt auf allen Geräten
- **Trainingsplan** (eigener Tab, auch in der Handy-Leiste): Trainingstage pro Woche wählen, dann einen Standard-Split (Ganzkörper, Upper/Lower, Push/Pull/Legs, Torso/Limbs, Upper/Lower + PPL, Arnold, Bro-Split) oder „Eigener Split“; Übungen per + ergänzen, Plan speichern. Im Training Gewicht und Wiederholungen pro Satz eintragen – beim nächsten Mal stehen die letzten Werte schon drin. „Trainingshistorie“ zeigt pro Übung den Verlauf des schwersten Satzes
- **Check-in vom Coach** oben in der Übersicht: Feedback lesen, antworten oder vorgeschlagene Plananpassungen mit einem Klick annehmen. Check-in und Annahme laufen im Hintergrund; nur die Antwort des Klienten landet im Chat
- **Kalorien:** Zielkalorien als Range (z. B. 2.200–2.300 kcal) mit Diagramm: Range als Band, Mittelwert als Linie, pro Tag eingehalten/nicht eingehalten
- **Push-Benachrichtigungen** (nach Zustimmung; Chat-Nachrichten des Coaches erscheinen nur als „Du hast eine neue Nachricht von deinem Coach“, ohne Inhalt): Erinnerungen des Coaches und neue Chat-Nachrichten. Auf dem iPhone nur, wenn die Seite zum Home-Bildschirm hinzugefügt wurde (ab iOS 16.4)
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
- **Ernährungsplan** pro Klient: Mahlzeiten aus der Lebensmittel-Datenbank zusammenstellen, Tauschwünsche per Klick kcal-gleich übernehmen, selbst anpassen oder ablehnen (Push bei neuen Wünschen)
- **Kategorien** (nur für den Coach sichtbar): Diät, Reverse Diät, Aufbau, Maintenance – als farbige Markierung in Übersicht, Check-in und Admin-Tool
- **Zusatzmaße je Kategorie**, im Admin-Tool zuordenbar: Zahlenwerte wie Bauchumfang (Feld im Tageseintrag + Verlaufsdiagramm) und Kraft-PRs (Übung, Gewicht, Wiederholungen; Rekorde werden erkannt, Push an den Coach); beides auch im Check-in-Wochenvergleich
- **Admin-Tool:** Logins, App-Nutzung und Tage ohne Eintrag je Klient; automatische Gewichts-Erinnerung (täglich, Standard 18 Uhr, an alle ohne Gewicht von heute); automatische Push-Erinnerung nach X Tagen ohne Eintrag (täglich zu fester Uhrzeit, auch in der Push-Übersicht verlinkt); Lebensmittel-Datenbank mit ca. 100 üblichen Lebensmitteln (kcal pro 100 g/ml), eigene Lebensmittel anlegen und bearbeiten
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

**„Das ist neu“-Meldung nach einem Update:** In `public/app.js` die Konstante `RELEASE` auf einen neuen Wert setzen und die Punkte in `WHATS_NEW` (getrennt für Klient und Coach) anpassen. Jeder Nutzer sieht die Meldung dann genau einmal – das Wegklicken wird auf dem Server gespeichert und gilt für alle Geräte.
