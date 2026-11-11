# Online stellen mit Render

Anbieter: **Render** (render.com)
Produkt: **Web Service** im Instanztyp **Starter**, dazu eine **Persistent Disk** mit 1 GB, Region **Frankfurt (EU Central)**

Kosten: ca. 7 $ (Starter) + 0,25 $ (1 GB Disk) ≈ **7,25 $ pro Monat**. Den aktuellen Preis zeigt Render vor dem Anlegen an.
Der kostenlose Plan reicht **nicht**: Er hat keine Persistent Disk, die Daten wären nach jedem Neustart weg.

---

## Schritt 1 – Code auf den Hauptbranch bringen
Der Code liegt auf dem Branch `claude/brave-euler-2ltiok`. Entweder du wählst in Schritt 4 genau diesen Branch aus,
oder (empfohlen) du führst ihn auf GitHub per Pull Request in `main` zusammen und nimmst `main`.

## Schritt 2 – Render-Konto anlegen
1. https://render.com öffnen → **Get Started**.
2. **Mit GitHub anmelden** (dann ist die Verbindung zum Repo gleich da).
3. Unter **Billing** eine Kreditkarte hinterlegen (für den Starter-Plan nötig).

## Schritt 3 – Neuen Web Service anlegen
1. Im Dashboard oben rechts **+ New** → **Web Service**.
2. Bei „Source Code“ **GitHub** wählen. Falls das Repo `trackercvz` nicht erscheint:
   **Configure GitHub** → Render Zugriff auf dieses Repo geben.
3. Repo `trackercvz` auswählen → **Connect**.

## Schritt 4 – Einstellungen ausfüllen
| Feld | Wert |
|---|---|
| Name | z. B. `fitness-tracker` (wird Teil der Adresse: `fitness-tracker.onrender.com`) |
| Language / Runtime | **Node** (nicht Docker) |
| Branch | `main` (oder `claude/brave-euler-2ltiok`) |
| Region | **Frankfurt (EU Central)** |
| Root Directory | leer lassen |
| Build Command | `npm install` |
| Start Command | `npm start` |
| Instance Type | **Starter** |

## Schritt 5 – Umgebungsvariablen
Unter **Environment Variables** → **Add Environment Variable**:

| Key | Value |
|---|---|
| `NODE_VERSION` | `22` |
| `NODE_ENV` | `production` |
| `DATA_DIR` | `/var/data` |
| `COACH_USERNAME` | dein Login-Name, z. B. `coach` |
| `COACH_PASSWORD` | ein starkes Passwort (mind. 8 Zeichen, besser 16+) |
| `COACH_NAME` | dein Anzeigename, z. B. `Sara` |

## Schritt 6 – Persistent Disk anlegen (wichtig!)
Weiter unten unter **Advanced** → **Add Disk**:

| Feld | Wert |
|---|---|
| Name | `tracker-data` |
| Mount Path | `/var/data` (muss exakt gleich wie `DATA_DIR` sein) |
| Size | `1` GB (reicht für viele Jahre) |

Health Check Path kann auf `/` bleiben. Auto-Deploy auf **On Commit** lassen.

## Schritt 7 – Deployen
**Deploy Web Service** klicken. Im Log sollte nach 1–2 Minuten erscheinen:

```
Coach-Konto "coach" angelegt.
Tracker läuft auf http://localhost:10000
```

Oben links steht dann die Adresse, z. B. `https://fitness-tracker.onrender.com`. HTTPS ist automatisch aktiv.

## Schritt 8 – Testen und Klient anlegen
1. Adresse öffnen → mit `COACH_USERNAME` / `COACH_PASSWORD` anmelden.
2. **+ Neuer Klient** → Name, Benutzername → **Anlegen** → Zugangsdaten **Kopieren** und dem Klienten schicken.
3. Klient öffnet die Adresse auf dem Handy, meldet sich an, ändert über **Passwort** sein Passwort.
   Tipp für den Klienten: Im Browser „Zum Home-Bildschirm hinzufügen“ – dann startet der Tracker wie eine App.
4. Optional: Nach dem ersten erfolgreichen Login kannst du `COACH_PASSWORD` in Render wieder löschen
   (das Konto bleibt bestehen; die Variable wird nur beim allerersten Start gebraucht).

## Schritt 9 (optional) – Eigene Domain
1. Im Service → **Settings** → **Custom Domains** → **Add Custom Domain**, z. B. `tracker.deine-domain.de`.
2. Beim Domain-Anbieter einen **CNAME**-Eintrag `tracker` → `fitness-tracker.onrender.com` anlegen.
3. In Render **Verify** klicken. Das Zertifikat wird automatisch ausgestellt.

---

## Push-Benachrichtigungen
Funktionieren ohne weitere Einrichtung: Die nötigen Schlüssel erzeugt der Server beim ersten Start selbst und speichert sie auf der Disk.
Optional kannst du unter Environment Variables `VAPID_SUBJECT` = `mailto:deine@email.de` setzen (Kontaktadresse für Apple/Google).
Wichtig für iPhones: Push geht nur, wenn der Klient die Seite über Safari → Teilen → „Zum Home-Bildschirm“ hinzugefügt hat und sie von dort öffnet.

## Laufender Betrieb
- **Updates:** Jeder Push auf den gewählten Branch wird automatisch neu deployt. Die Daten auf der Disk bleiben erhalten.
  Während eines Deploys ist die Seite ein paar Sekunden nicht erreichbar (bei Services mit Disk normal).
- **Backup:** Render macht tägliche Snapshots der Disk (wiederherstellbar unter Disks).
  Zusätzlich ab und zu pro Klient **CSV exportieren**.
- **Coach-Passwort vergessen:** Im Service → **Shell** öffnen und ausführen:
  `npm run create-coach -- coach2 'neues-passwort'` → mit dem neuen Konto anmelden.

## Datenschutz (kurz)
Gewicht und Schlaf sind Gesundheitsdaten (Art. 9 DSGVO). Darum:
- Region **Frankfurt** wählen (Schritt 4).
- Den **Auftragsverarbeitungsvertrag (DPA)** von Render lesen und abschließen: https://render.com/dpa (zum Unterzeichnen über https://trust.render.com bzw. support@render.com).
- Vom Klienten eine **schriftliche Einwilligung** zur Verarbeitung seiner Gesundheitsdaten einholen.
- Ist die Seite öffentlich erreichbar und geschäftlich genutzt, brauchst du Impressum und Datenschutzerklärung.
Das ist keine Rechtsberatung – im Zweifel kurz mit einem Datenschutz-Berater abklären.
