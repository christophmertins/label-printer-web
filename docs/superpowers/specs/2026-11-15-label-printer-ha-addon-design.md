# Etiketten-Studio als Home Assistant Addon — Design

Datum: 2026-11-15
Status: zur Freigabe

## Absicht

Die bestehende Flask-App „Etiketten-Studio" (Brother QL-500, visueller
Label-Editor) soll als Home-Assistant-Addon installiert werden können: Panel in
der HA-Sidebar, Optionen in der HA-Oberfläche, Vorlagen im Addon-Speicher
(inkl. HA-Backup). Der Drucker hängt weiterhin am Linux-Host `10.0.0.225`
(USB); dort läuft die bisherige Instanz der App.

## Ziele

- Addon auf dem Home Assistant Yellow (HA OS 18.5, aarch64) installierbar über
  ein GitHub-Addon-Repository.
- Bedienung vollständig über Ingress (`/api/hassio_ingress/<token>/`), kein
  offener Port, kein eigenes Login.
- Genau eine Addon-Option: `print_proxy_url`. Druckerspezifische Einstellungen
  bleiben dort, wo der Drucker hängt.
- Vorlagen und Seeds liegen in `/data` und werden mitgesichert.
- Drucken funktioniert, obwohl der Drucker an einem anderen Rechner hängt:
  Druckauftrag per HTTP an die bestehende Instanz.

## Nicht-Ziele

- Kein eigener USB-Zugriff im Addon (kein `usb:`/`full_access`), keine
  CUPS-/USB-IP-Anbindung.
- Kein MQTT, keine HA-Services/Automationen, keine Sensoren.
- Keine Änderung an der Alt-Instanz auf `10.0.0.225` (sie bleibt unverändert
  und druckt weiter).
- Kein Multi-User/Login im Addon — Ingress-Authentifizierung genügt.

## Randbedingungen

- QL-500 ist USB-only, hängt nicht am Yellow.
- HA OS: Addon-Images müssen `aarch64` und `amd64` bauen; Basis sind die
  HA-Base-Images (s6-overlay v3, bashio), `init: false`.
- Supervisor-Build-Kontext ist der Addon-Ordner — Quellcode muss darin liegen.
- Ingress: Supervisor entfernt den Pfad-Präfix, setzt aber `X-Ingress-Path`.
- `brother_ql` kann den lokalen Druck über pyusb/linux_kernel/netzwerk; im
  Addon wird davon nur gerendert und (falls kein Proxy gesetzt ist) gedruckt.
- Die Alt-Instanz läuft unter `http://10.0.0.225:8001` und ist ein Checkout
  dieses Repos; Abweichungen der Version zeigen sich als klare Fehlermeldung
  statt als stiller Fehlschlag.
- Der Druckerzustand und die Etikettliste kommen bei gesetztem Proxy von der
  Alt-Instanz; `/data/labels.json` ist nur Rückfallliste, wenn sie nicht
  erreichbar ist.

## Gewählter Ansatz (vom Nutzer entschieden)

**1 — Volle App im Addon, Druck über die bestehende Instanz.**

Die App läuft vollständig im Addon (Editor, Vorschau, Vorlagenverwaltung,
Druckvorschau). Ist `print_proxy_url` gesetzt, rendert das Addon den Auftrag
lokal und schickt das Dokument-JSON per HTTP an `<proxy>/api/print` der
Alt-Instanz, die USB und Drucker besitzt. Die Statusabfrage
(`/api/status`) wird ebenfalls durchgereicht, damit die UI den echten
Druckerzustand zeigt.

Verworfene Alternativen:

- *Addon als reiner Proxy (nginx)*: kein HA-Optionen/Backup, App bleibt doppelt,
  Addon ohne laufende Alt-Instanz wertlos.
- *CUPS-/Socat-Raw-Queue auf `10.0.0.225`*: kein App-Code, aber zusätzlicher
  Dienst und Kernel-/Geräteannahmen auf dem Host, die sich nicht testen lassen.
- *Drucker an den Yellow umstecken*: sauberste Endlösung, aber Kabel umstecken;
  bleibt als späterer Weg offen (Backend `pyusb` + `usb: true`).
- *Drucker-Optionen (Modell, Backend, Dither, Schwelle) als Addon-Optionen*:
  beim Proxy-Druck rastersiert die Alt-Instanz mit ihrer eigenen
  `printer.json` – die Optionen wären wirkungslos, und ein abweichendes Modell
  würde Etiketten anbieten, die der entfernte Drucker nicht kann. Deshalb
  übernimmt das Addon bei gesetztem Proxy `/api/config` **der Alt-Instanz**
  (Etikettliste + Druckerinfo) und hält keine eigenen Druckeroptionen.

## Aufbau

```
repository.yaml                  # Addon-Repository (Name, URL, Wartung)
label_printer/                   # Addon-Ordner = Build-Kontext
  config.yaml                    # Metadaten, Ingress, Optionen/Schema
  Dockerfile                     # HA-Base-Python + App
  run.sh                         # Optionen -> /data, Start gunicorn
  icon.png, logo.png             # optional, aus vorhandenem Asset erzeugt
  README.md, DOCS.md, CHANGELOG.md
  translations/de.yaml
  app/                           # bisheriges app/ (verschoben)
  config/labels.json             # Seed
  templates/*.json               # Seed-Vorlagen
docker-compose.yml               # baut weiterhin label_printer/ (Standalone)
README.md                        # Kurzfassung + Verweis auf DOCS.md
```

`git mv` für `app/`, `config/`, `templates/`; Root behält Lizenz, Compose und
die kurze README.

## Teile

### 1. Ingress-Fähigkeit (App-Code)

- WSGI-Middleware setzt `SCRIPT_NAME` aus `HTTP_X_INGRESS_PATH`, damit
  `url_for()` absolute, präfixrichtige URLs liefert (CSS/JS/Fonts).
- `app/templates/index.html`: `<base href="{{ request.script_root }}/">`, und
  die JS-Aufrufe werden relativ (`api/config`, `api/status`, Editor-Pfade).
  Damit funktioniert die App unverändert unter `/` und unter Ingress.
- Kein Auth-Code; der Supervisor reicht nur HA-Sitzungen durch.

### 2. Druck-Proxy (App-Code)

- `AppConfig.printer["print_proxy_url"]` (Env `LABEL_WEB_PRINT_PROXY`),
  Default leer. Ein vollständiger Basis-URL, z. B.
  `http://10.0.0.225:8001` (HTTP, optional mit Pfad; Endpunkte werden per
  `urllib.parse.urljoin` gebildet, nicht per String-Konkatenation).
- `print_service.print_document`: ist der Proxy gesetzt, wird das Dokument als
  JSON per `urllib.request` (Timeout 120 s) an `<proxy>/api/print` gepostet;
  Antwort `ok` → Erfolg, sonst `PrinterUnavailableError` mit der Meldung der
  Gegenseite. Netzwerkfehler, Nicht-JSON-Antwort oder 404 → 
  `PrinterUnavailableError` mit Hinweis „Alt-Instanz nicht erreichbar oder
  andere Version" (HTTP 503).
- `print_service.printer_status`: Proxy gesetzt → `GET <proxy>/api/status`,
  Ergebnis unverändert zurückgeben; Fehler → `connected: false` mit Hinweis.
- `api.get_config`: Proxy gesetzt → `GET <proxy>/api/config`, Ergebnis
  unverändert zurückgeben (Etikettliste und Druckerinfo der Alt-Instanz).
  Schlägt das fehl, fällt die Antwort auf die lokale `labels.json` mit Modell
  `QL-500` zurück, damit der Editor auch ohne Alt-Instanz bedienbar bleibt.
- Kein neuer Dependency-Eintrag (nur Standardbibliothek).

### 3. Addon-Verpackung

- `config.yaml`: `init: false`, `ingress: true`, `ingress_port: 5001`,
  `panel_icon: mdi:label-outline`, `panel_title: Etiketten`, `arch: [aarch64,
  amd64]`, `map: []`, `backup: hot`.
- Optionen/Schema: ausschließlich `print_proxy_url` (str, Default
  `http://10.0.0.225:8001`). Keine Druckeroptionen im Addon (siehe oben).
- `run.sh`: liest die Option per bashio (falls vorhanden; sonst
  `LABEL_WEB_PRINT_PROXY` aus der Umgebung, damit `docker compose` ohne
  Supervisor funktioniert), kopiert `labels.json` und die Beispielvorlagen aus
  dem Image nach `/data/…`, falls nicht vorhanden, setzt
  `LABEL_WEB_CONFIG_DIR=/data`, `LABEL_WEB_TEMPLATES_DIR=/data/templates` und
  startet gunicorn auf Port 5001.
- `Dockerfile`: `FROM ghcr.io/home-assistant/base-python:3.14-alpine3.24`
  (Multi-Arch, `amd64`/`aarch64`), `apk add libusb font-dejavu`,
  `pip install --break-system-packages -r requirements.txt` (Alpine-Python ist
  PEP-668-verwaltet), DejaVu-TTFs liegen bereits im Repo unter
  `app/static/fonts` (Vorschau = Druck), `CMD ["/run.sh"]`.
- Doku: Installation über Repository-URL, Option `print_proxy_url`, Druckweg,
  Fehlersuche (Alt-Instanz nicht erreichbar), einmaliger Import selbst
  angelegter Vorlagen von der Alt-Instanz nach `/data/templates` (über Samba,
  SSH oder Datei-Editor), bekannte Grenzen (kein USB im Addon, keine
  Druckeroptionen im Addon).

### 4. Standalone-Betrieb bleibt

`docker-compose.yml` baut `./label_printer`; `docker compose up --build` ergibt
dieselbe App ohne HA. Volumes zeigen auf `./label_printer/config` und
`./label_printer/templates`. README erklärt beide Wege.

## Prüfung

- Smoke-Test als Skript (assert-basiert, ohne pytest-Zusatz): Flask-Testclient
  mit gesetztem `X-Ingress-Path` → HTML enthält präfixrichtige Asset-URLs;
  `/api/print` mit gesetztem Proxy postet an einen lokalen Stub-Server und
  meldet dessen Fehlermeldung weiter; `/api/status` und `/api/config` reichen
  durch und fallen bei Fehler sauber zurück.
- Addon-Image bauen (falls Docker verfügbar) bzw. manuelle Prüfung von
  `config.yaml` gegen die Supervisor-Felder; `run.sh` einmal ohne Supervisor
  starten.
- Kein Test der echten Hardware vom Addon aus — das bleibt am Drucker-Host.

## Offen für den Builder

Dateinamen der Doku, Icon-Erzeugung, genaue Wortwahl der Optionen-Labels,
Reihenfolge der Commits.
