# Etiketten-Studio (Brother QL-500)

Web-App zum Erstellen und Drucken von Etiketten für den **Brother QL-500**
(und weitere QL-Modelle). Labels mit **Text, Bildern und QR-Codes** lassen sich
in einem visuellen WYSIWYG-Editor gestalten und als **Vorlagen** speichern.

Zwei Betriebsarten, ein Code:

- **Home-Assistant-Addon** (`label_printer/`) – Panel in der HA-Sidebar über
  Ingress, Vorlagen im Addon-Speicher, Druck über die Instanz am Drucker.
  Installation: Repository-URL `https://github.com/christophmertins/label-printer-web`
  in HA unter *Einstellungen → Apps → App installieren → ⋮ → Repositories*
  eintragen, dann „Etiketten-Studio (Brother QL)" installieren.
  Details: [`label_printer/DOCS.md`](label_printer/DOCS.md).
- **Docker-Standalone** – `docker compose up --build -d`, UI auf
  `http://localhost:5001`.

Die App funktioniert vollständig **ohne angeschlossenen Drucker**: Editieren,
Vorschau und Vorlagenverwaltung laufen immer. Nur der eigentliche Druck
benötigt den eingeschalteten Drucker.

---

## Funktionen

- **Visueller Editor**: Elemente frei auf der Etiketten-Vorschau platzieren,
  skalieren (8 Ziehpunkte) und drehen (Drehgriff).
- **Elemente**: Text (multi-line, fett/kursiv, 3 Schriftfamilien, Ausrichtung),
  QR-Code (Fehlerkorrektur L/M/Q/H) und Bilder (Hochladen, „Passend“/„Strecken“).
- **Etiketten-Formate konfigurierbar** (`data/labels.json`) – fortlaufend und
  vorgestanzt, z. B. `62`, `62x100`, `29x90`, `29`, `12`, …
- **Vorlagen**: Speichern, Laden, Löschen; mehrere Beispielvorlagen liegen bei.
- **Druckvorschau**: 1:1-Server-Render bei 300 dpi vor dem Drucken.
- **Offline-fähig**: Alles außer Drucken läuft auch ohne Drucker/Libusb.
- **WYSIWYG**: Browser-Vorschau nutzt exakt dieselben DejaVu-Schriftdateien
  wie der Server (keine Font-Abweichungen zwischen Vorschau und Druck).

---

## Schnellstart (Docker, Linux-Host mit Drucker)

```bash
docker compose up --build -d
# UI:  http://localhost:5001
```

**Update von einer älteren Version:** Die App liegt jetzt in `label_printer/`,
die Daten in `label_printer/data/`. Einmalig übernehmen:

```bash
mkdir -p label_printer/data/templates
cp -n config/*.json label_printer/data/ 2>/dev/null
cp -n templates/*.json label_printer/data/templates/ 2>/dev/null
```

Das `docker-compose.yml` reicht `/dev/bus/usb` in den Container durch
(`privileged: true`) und legt die Daten unter `label_printer/data/` ab.

### Nativ auf macOS/Windows (falls USB nicht in Docker durchkommt)

> **Wichtig (macOS):** Docker Desktop kann **keine USB-Geräte** in Linux-
> Container durchreichen. Wenn dein QL-500 direkt am Mac hängt, laufen die
> App und der Druck am besten nativ.

```bash
# macOS: libusb für das pyusb-Backend von brother_ql
brew install libusb

python3 -m venv .venv
source .venv/bin/activate
pip install -r label_printer/requirements.txt

cd label_printer
LABEL_WEB_CONFIG_DIR=$PWD/data LABEL_WEB_TEMPLATES_DIR=$PWD/data/templates python run.py
# UI:  http://localhost:5001
```

---

## Konfiguration

Die Daten liegen im Container unter `/data` (Volume `label_printer/data`):
`printer.json`, `labels.json` und `templates/`. Beim ersten Start werden die
mitgelieferten Seeds kopiert, vorhandene Dateien bleiben unangetastet.

### `printer.json`

| Schlüssel  | Bedeutung | Standard |
|---|---|---|
| `model`    | Brother-Modell | `QL-500` |
| `backend`  | `pyusb` (USB) / `linux_kernel` (Linux) / `network` | `pyusb` |
| `printer`  | Geräte-ID, z. B. `usb://0x04f9:0x2015`; leer = Auto-Erkennung | `""` |
| `dither`   | Fehlerdiffusions-Dithering statt Schwellwert | `false` |
| `threshold`| Schwellwert in % für Schwarz (nur wenn kein Dither) | `70` |
| `compress` | Daten-Kompression (bei QL-500 ignoriert) | `true` |
| `hq`       | Druckqualität | `true` |
| `cut`      | Automatischer Schnitt (bei QL-500 ignoriert) | `true` |
| `print_proxy_url` | Basis-URL der Instanz, die druckt (leer = selbst drucken) | `""` |

Umgebungsvariablen überschreiben die Datei: `BROTHER_MODEL`,
`BROTHER_BACKEND`, `BROTHER_PRINTER`, `LABEL_WEB_PRINT_PROXY`.

### `labels.json`

Liste der verfügbaren Etiketten als `{ "id": …, "name": … }`. Die `id` muss
ein brother_ql-Bezeichner sein. Beim Start werden nur die Formate angeboten,
die zum konfigurierten Druckermodell passen (`Label.works_with_model`).

Für den QL-500 bzw. 62-mm-Bande sind z. B. geeignet:

| id | Größe | Art |
|---|---|---|
| `62`      | 62 mm fortlaufend | Endlos |
| `62x100`  | 62 × 100 mm      | vorgestanzt |
| `29x90`   | 29 × 90 mm       | vorgestanzt |
| `29x42`   | 29 × 42 mm       | vorgestanzt |
| `29`      | 29 mm fortlaufend| Endlos |
| `12`      | 12 mm fortlaufend| Endlos |

Weitere IDs siehe `brother_ql/labels.py` (z. B. `17x54`, `17x87`, `23x23`,
`39x90`, `52x29`, `60x86`, `62x29`, `d24`, …).

---

## Vorlagen

- Vorlagen liegen als JSON-Dokumente unter `data/templates/`.
- Im Editor: **Speichern** (Name eingeben), **Laden**, **Löschen** und
  **Neu**. Beigelegte Beispiele: `versandetikett`, `asset-etikett`,
  `kabel-etikett`.
- Vorlagen sind normale Dateien – du kannst auch eigene per Texteditor
  anlegen (siehe `label_printer/templates/*.json` als Schema-Beispiel).

---

## Drucken über USB im Docker-Container

Der QL-500 spricht über den Linux-USB-Treiber. `pyusb` im Container braucht:

1. `libusb` (im Image installiert),
2. Zugriff auf den USB-Bus des Hosts → `docker-compose.yml` mappt
   `/dev/bus/usb` und setzt `privileged: true`.

Fehlt der Drucker oder ist er aus, zeigt die App **„Drucker nicht verbunden /
aus“** im Kopfbereich; der Ausgabe-Button liefert eine klare Fehlermeldung.
Editieren und Vorlagen funktionieren in diesem Zustand uneingeschränkt.

Ist `print_proxy_url` gesetzt, wird stattdessen das Dokument an
`<print_proxy_url>/api/print` geschickt (die dortige Instanz besitzt den
Drucker); Status und Etikettliste kommen ebenfalls von dort.

---

## API

| Methode & Route | Zweck |
|---|---|
| `GET  /api/config`    | Verfügbare Etiketten + Druckerkonfiguration |
| `GET  /api/status`    | Ist ein Drucker erreichbar? (wirft nie Fehler) |
| `GET  /api/templates` | Vorlagen-Liste |
| `GET/PUT/DELETE /api/templates/<name>` | Laden / Speichern / Löschen |
| `POST /api/preview`   | 300-dpi-PNG des Dokuments (data-URI) |
| `POST /api/print`     | Rendern + an Drucker senden |

`POST /api/print` liefert bei fehlendem Drucker einen `503` mit verständlicher
Meldung – ein guter Ansatzpunkt für eigene Skripte.

---

## Technische Hinweise

- **Ingress-fähig**: Alle URLs sind relativ bzw. werden über
  `X-Ingress-Path` präfixt; die App läuft unverändert unter `/` und unter
  `/api/hassio_ingress/<token>/`.
- **Auflösung**: Dokumente werden im *Druckbereich* (printable area) in mm
  modelliert und auf 300 dpi gerastert. Für vorgestanzte Etiketten erzeugt
  der Renderer exakt die von brother_ql geforderten Bildmaße (z. B.
  62×100 → 696 × 1109 px), für Endlosband die Breite laut Spezifikation und
  die (einstellbare) Länge.
- **QL-500-Einschränkungen**: Der QL-500 unterstützt weder automatischen
  Schnitt noch Kompression noch 600-dpi/2-Farben. brother_ql meldet das beim
  Drucken als Warnings und arbeitet trotzdem korrekt – das ist erwartet.
- **Fonts**: Die DejaVu-Fonts liegen unter `label_printer/app/static/fonts/`
  und werden von Server (Pillow) und Browser (Canvas) gleichermaßen genutzt.
- **QR-Codes**: Serverseitig `qrcode` (Pillow), clientseitig
  `qrcode-generator` (MIT) – gleiche Geometrie (Quiet-Zone standardmäßig 4
  Module, rundet auf die Element-Box).

---

## Projektstruktur

```
repository.yaml      Addon-Repository (Home Assistant)
docker-compose.yml   Standalone-Betrieb
label_printer/       Addon-Ordner = Docker-Build-Kontext
  config.yaml        Addon-Metadaten, Ingress, Optionen
  Dockerfile         HA-Base-Python + App
  run.sh             Optionen -> /data, Start gunicorn
  app/
    __init__.py      Flask-App-Factory + Ingress-Middleware
    api.py           REST-API (config/status/templates/preview/print)
    config.py        Konfigurations-Loader (JSON + Env-Overrides)
    label_render.py  Render-Engine (Pillow, 300 dpi)
    print_service.py brother_ql-Anbindung + HTTP-Proxy zum Drucker-Host
    templates_store.py Vorlagen (JSON-Dateien)
    templates/       index.html
    static/          CSS, JS (Editor), Fonts
  config/            Seeds: printer.json, labels.json
  templates/         Seed-Vorlagen
  tests/             Smoke-Tests (unittest)
  requirements.txt, run.py
```

Tests: `cd label_printer && python -m unittest discover tests`

## Lizenz

GPL-3.0 – siehe [LICENSE](LICENSE).
