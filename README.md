# Etiketten-Studio (Brother QL-500)

Web-App zum Erstellen und Drucken von Etiketten für den **Brother QL-500**
(und weitere QL-Modelle) als Docker-Container. Labels mit **Text, Bildern und
QR-Codes** lassen sich in einem visuellen WYSIWYG-Editor gestalten und als
**Vorlagen** speichern.

Die App funktioniert vollständig **ohne angeschlossenen Drucker**: Editieren,
Vorschau und Vorlagenverwaltung laufen immer. Nur der eigentliche Druck
benötigt den eingeschalteten, per USB angeschlossenen Drucker.

---

## Funktionen

- **Visueller Editor**: Elemente frei auf der Etiketten-Vorschau platzieren,
  skalieren (8 Ziehpunkte) und drehen (Drehgriff).
- **Elemente**: Text (multi-line, fett/kursiv, 3 Schriftfamilien, Ausrichtung),
  QR-Code (Fehlerkorrektur L/M/Q/H) und Bilder (Hochladen, „Passend“/„Strecken“).
- **Etiketten-Formate konfigurierbar** (`config/labels.json`) – fortlaufend und
  vorgestanzt, z. B. `62`, `62x100`, `29x90`, `29`, `12`, …
- **Vorlagen**: Speichern, Laden, Löschen; mehrere Beispielvorlagen liegen bei.
- **Druckvorschau**: 1:1-Server-Render bei 300 dpi vor dem Drucken.
- **Offline-fähig**: Alles außer Drucken läuft auch ohne Drucker/Libusb.
- **WYSIWYG**: Browser-Vorschau nutzt exakt dieselben DejaVu-Schriftdateien
  wie der Server (keine Font-Abweichungen zwischen Vorschau und Druck).

---

## Schnellstart

### Variante A: Docker (Linux-Host empfohlen)

```bash
docker compose up --build -d
# UI:  http://localhost:5001
```

Das `docker-compose.yml` reicht `/dev/bus/usb` in den Container durch
(`devices` + `privileged`). Das ist der Standard-Weg für Linux-Hosts.

### Variante B: Nativ auf macOS/Windows (falls USB nicht in Docker durchkommt)

> **Wichtig (macOS):** Docker Desktop kann **keine USB-Geräte** in Linux-
> Container durchreichen. Wenn dein QL-500 direkt am Mac hängt, laufen die
> App und der Druck am besten nativ. Alternativ funktioniert Docker auf
> einem Linux-Host oder mit OrbStack (dort ist USB-Forwarding möglich).

```bash
# macOS: libusb für das pyusb-Backend von brother_ql
brew install libusb

python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

python run.py
# UI:  http://localhost:5001
```

---

## Konfiguration

Alle Konfigurationsdateien liegen in `config/` und werden per Volume
eingebunden, damit du sie am Host anpassen kannst.

### `config/printer.json`

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

Umgebungsvariablen überschreiben die Datei: `BROTHER_MODEL`,
`BROTHER_BACKEND`, `BROTHER_PRINTER`.

### `config/labels.json`

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
`39x90`, `52x29`, `60x86`, `62x29`, `d24`, …). Breite Formate (`102`,
`103` …) sind auf größere Modelle beschränkt.

---

## Vorlagen

- Vorlagen werden als JSON-Dokumente unter `templates/` gespeichert
  (Volume `./templates:/app/templates` im Container).
- Im Editor: **Speichern** (Name eingeben), **Laden**, **Löschen** und
  **Neu**. Bereits beigelegte Beispiele: `versandetikett`, `asset-etikett`,
  `kabel-etikett`.
- Vorlagen sind normale Dateien – du kannst auch eigene per Texteditor
  anlegen (siehe `templates/*.json` als Schema-Besipiel).

---

## Drucken über USB im Docker-Container

Der QL-500 spricht über den Linux-USB-Treiber. `pyusb` im Container braucht:

1. `libusb-1.0-0` (im Dockerfile bereits installiert),
2. Zugriff auf den USB-Bus des Hosts → `docker-compose.yml` nutzt
   `devices: ["/dev/bus/usb:/dev/bus/usb"]` und `privileged: true`.

Fehlt der Drucker oder ist er aus, zeigt die App **„Drucker nicht verbunden /
aus“** im Kopfbereich; der Ausgabe-Button liefert eine klare Fehlermeldung.
Editieren und Vorlagen funktionieren in diesem Zustand uneingeschränkt.

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

- **Auflösung**: Dokumente werden im *Druckbereich* (printable area) in mm
  modelliert und auf 300 dpi gerastert. Für vorgestanzte Etiketten erzeugt
  der Renderer exakt die von brother_ql geforderten Bildmaße (z. B.
  62×100 → 696 × 1109 px), für Endlosband die Breite laut Spezifikation und
  die (einstellbare) Länge.
- **QL-500-Einschränkungen**: Der QL-500 unterstützt weder automatischen
  Schnitt noch Kompression noch 600-dpi/2-Farben. brother_ql meldet das beim
  Drucken als Warnings und arbeitet trotzdem korrekt – das ist erwartet.
- **Fonts**: Die DejaVu-Fonts liegen unter `app/static/fonts/` und werden von
  Server (Pillow) und Browser (Canvas) gleichermaßen genutzt.
- **QR-Codes**: Serverseitig `qrcode` (Pillow), clientseitig
  `qrcode-generator` (MIT) – gleiche Geometrie (Quiet-Zone standardmäßig 4
  Module, rundet auf die Element-Box).

---

## Projektstruktur

```
app/
  __init__.py        Flask-App-Factory
  api.py             REST-API (config/status/templates/preview/print)
  config.py          Konfigurations-Loader (JSON + Env-Overrides)
  label_render.py    Render-Engine (Pillow, 300 dpi)
  print_service.py   brother_ql-Anbindung (pyusb), Druck-Serialisierung
  templates_store.py Vorlagen (JSON-Dateien)
  templates/         index.html
  static/            CSS, JS (Editor), Fonts
config/              printer.json, labels.json   (Volume)
templates/           Gespeicherte Vorlagen       (Volume)
Dockerfile, docker-compose.yml, requirements.txt, run.py
```