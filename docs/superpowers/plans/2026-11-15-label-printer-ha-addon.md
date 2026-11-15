# Etiketten-Studio HA-Addon — Umsetzungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Die Flask-App als Home-Assistant-Addon ausliefern, bedienbar über Ingress, druckend über die bestehende Instanz auf `http://10.0.0.225:8001`.

**Architecture:** App zieht nach `label_printer/` (Addon-Ordner = Build-Kontext), HA-Base-Python-Image, Ingress-Middleware + relative JS-Pfade, Druck per HTTP-Proxy an die Alt-Instanz, Vorlagen in `/data`.

**Tech Stack:** Python 3.14 (Alpine-Addon-Image), Flask, gunicorn, s6-overlay/baship (nur Bash), urllib (Standardbibliothek).

**Spec:** `docs/superpowers/specs/2026-11-15-label-printer-ha-addon-design.md`

## Global Constraints

- Genau eine Addon-Option: `print_proxy_url`, Default `http://10.0.0.225:8001`.
- Addon bekommt keinen USB-Zugriff (`usb`, `full_access` bleiben aus); `init: false`, `ingress: true`, `ingress_port: 5001`.
- Keine neuen Python-Abhängigkeiten (Proxy über `urllib.request`).
- Docker-Compose-Betrieb muss weiter funktionieren.
- Keine Änderung an der Alt-Instanz nötig.

## Review Focus

- Alt-Instanz nicht erreichbar → Druck meldet verständlichen Fehler, App bleibt bedienbar.
- Alt-Instanz antwortet mit Nicht-JSON/404 (andere Version) → klare Meldung, kein 500.
- Ingress-Pfad mit Token → Assets, API-Aufrufe, Vorlagen-Speichern funktionieren.
- Erststart ohne `/data`-Inhalt → Templates und labels.json werden angelegt, nichts überschrieben.
- Etikettenliste der Alt-Instanz weicht vom Addon ab → UI zeigt die Liste der Alt-Instanz.

---

### Task 1: Ingress-Fähigkeit

**Files:** `label_printer/app/__init__.py`, `label_printer/app/templates/index.html`, `label_printer/app/static/js/app.js`, `label_printer/app/static/js/editor.js`, `label_printer/tests/test_smoke.py`

**Interfaces:** `create_app()` bleibt Signatur; neu `class IngressPrefix` (WSGI-Middleware) in `app/__init__.py`.

- [ ] Test: Testclient GET `/` mit Header `X-Ingress-Path: /api/hassio_ingress/abc` → HTML enthält `href="/api/hassio_ingress/abc/static/css/app.css"` und `<base href="/api/hassio_ingress/abc/">`. Ohne Header: `/static/css/app.css`.
- [ ] Lauf: `python -m unittest` → FAIL.
- [ ] Middleware setzt `SCRIPT_NAME` aus `HTTP_X_INGRESS_PATH` (rstrip `/`); `<base>` in `index.html`; alle `fetch('/api/…')` in app.js/editor.js auf relative Pfade.
- [ ] Lauf: PASS.
- [ ] Commit.

### Task 2: Druck-Proxy

**Files:** `label_printer/app/config.py`, `label_printer/app/print_service.py`, `label_printer/app/api.py`, `label_printer/tests/test_smoke.py`

**Interfaces:** `AppConfig.printer["print_proxy_url"]` (Env `LABEL_WEB_PRINT_PROXY`, Default `""`); `print_service._proxy_json(cfg, path, payload=None)` → `(status, dict)`, wirft `PrinterUnavailableError`.

- [ ] Test mit lokalem Stub-HTTP-Server: `/api/print` postet Dokument an `<proxy>/api/print`, gibt `{"ok": true}` zurück; Stub antwortet `{"ok": false, "message": "Papier leer"}` → HTTP 400/503 mit dieser Meldung; Stub aus → 503 mit „nicht erreichbar"; `/api/status` und `/api/config` reichen durch; `/api/config` fällt bei Fehler auf lokale Liste zurück.
- [ ] Lauf: FAIL.
- [ ] Implementieren (urljoin, Timeout 120 s, `ok`-Prüfung).
- [ ] Lauf: PASS.
- [ ] Commit.

### Task 3: Addon-Verpackung

**Files:** `git mv app config templates → label_printer/`; neu `repository.yaml`, `label_printer/config.yaml`, `label_printer/Dockerfile`, `label_printer/run.sh`, `label_printer/translations/de.yaml`; `docker-compose.yml`, `run.py` (Pfad).

- [ ] `run.sh`: bashio-Option lesen wenn vorhanden, sonst Env; `/data`-Seeds kopieren (nicht überschreiben); gunicorn starten.
- [ ] `config.yaml` wie oben, Schema nur `print_proxy_url: str?`.
- [ ] `Dockerfile`: `ghcr.io/home-assistant/base-python:3.14-alpine3.24`, `apk add libusb font-dejavu`, `pip --break-system-packages`, `CMD ["/run.sh"]`.
- [ ] Compose auf `build: ./label_printer` + neue Volumes.
- [ ] Lauf: `python -m unittest` PASS; `sh -n run.sh`; App-Start mit `LABEL_WEB_PRINT_PROXY` leer → `/api/config` 200.
- [ ] Commit.

### Task 4: Doku

**Files:** `label_printer/README.md`, `label_printer/DOCS.md`, `label_printer/CHANGELOG.md`, Root-`README.md`.

- [ ] Installation per Repository-URL, Option, Druckweg, Template-Import, Fehlersuche, bekannte Grenzen, Lizenz.
- [ ] Commit.

### Task 5: Auslieferung

- [ ] `git push` auf `origin main`.
- [ ] Addon-Repository in HA prüfen/einbinden (Supervisor), Build-Status beobachten; falls nicht möglich: Anleitung + Prüfung der Dateien gegen Supervisor-Schema.
