# Etiketten-Studio – Dokumentation

## Installation

1. Home Assistant → **Einstellungen → Apps → App installieren**.
2. Oben rechts **⋮ → Repositories**.
3. `https://github.com/christophmertins/label-printer-web` eintragen und
   hinzufügen.
4. **Etiketten-Studio (Brother QL)** installieren, danach **Starten**.
5. Optional **In der Seitenleiste anzeigen** aktivieren; sonst über **Öffnen
   der Weboberfläche** auf der App-Seite.

Die Oberfläche läuft über Home-Assistant-Ingress: kein eigener Port, kein
zusätzliches Login. Ein Port muss nur geöffnet werden, wenn du die Oberfläche
bewusst ohne Home Assistant erreichst.

## Voraussetzungen

- Eine Etiketten-Instanz, die den Drucker per USB besitzt. Sie muss die
  Endpunkte `/api/print`, `/api/status` und `/api/config` dieses Projekts
  anbieten (jeder Stand dieses Repos, z. B. `docker compose up -d` auf dem
  Linux-Host am Drucker).
- Netzwerkverbindung vom Home-Assistant-Host zu dieser Instanz (HTTP genügt).

## Optionen

### `print_proxy_url`

| | |
|---|---|
| Typ | Text, optional |
| Standard | `http://10.0.0.225:8001` |

Basis-URL der Instanz, die den Drucker besitzt. Ein Pfad-Präfix ist erlaubt
(`http://host:port/etiketten`). Leer lassen, wenn das Addon selbst drucken
soll – das setzt aber USB-Zugriff voraus, den dieses Addon nicht anfordert
(siehe *Bekannte Grenzen*).

Nach dem Ändern startet Home Assistant das Addon neu; die Einstellung greift
sofort.

## Druckweg

1. Der Editor erzeugt das Dokument und schickt es an das Addon.
2. Das Addon schickt dasselbe Dokument als JSON an
   `<print_proxy_url>/api/print`.
3. Die Instanz am Drucker rastersiert mit **ihrer** `printer.json` und druckt.

Deshalb gelten Modell, Schwellwert, Dithering und Schnitt der Gegenseite – das
Addon hat bewusst keine eigenen Druckeroptionen. Etikettliste und
Druckerstatus werden ebenfalls von dort geholt, damit die Auswahl im Editor zur
echten Hardware passt. Ist die Gegenseite nicht erreichbar, zeigt der Editor
die mitgelieferte Etikettliste und im Kopfbereich eine Fehlermeldung.

Die **Vorschau** (300 dpi) entsteht im Addon. Dithering, Schwellwert und
Drehung wendet erst die Gegenseite beim Drucken an – bei Foto-/Bild-Elementen
kann der Ausdruck deshalb minimal anders aussehen als die Vorschau.

## Daten und Backup

Alles Persistente liegt in `/data`:

```
/data/labels.json     verfügbare Etikettenformate
/data/printer.json    Druckereinstellungen (nur für lokales Drucken relevant)
/data/templates/*.json  Vorlagen
```

Beim ersten Start werden die mitgelieferten Seeds kopiert; vorhandene Dateien
werden nie überschrieben. `/data` ist Teil des HA-Backups (`backup: hot`).

### Eigene Vorlagen von einer bestehenden Instanz übernehmen

Vorlagen wandern nicht automatisch mit. Einmalig kopieren:

- per **Samba share**-Addon: `config/../addon_data/label_printer/…` bzw. den
  Addon-Datenordner öffnen und die JSON-Dateien nach `templates/` legen,
- per **Advanced SSH & Web Terminal**:
  `docker exec addon_local_label_printer ls /data/templates`,
- oder die Vorlagen im Editor der Alt-Instanz öffnen und im Addon erneut
  speichern.

## Fehlersuche

| Symptom | Ursache / Abhilfe |
|---|---|
| „Alt-Instanz … nicht erreichbar" beim Drucken | `print_proxy_url` prüfen, Läuft die Instanz am Drucker? Erreichbar aus dem HA-Netz? |
| „Alt-Instanz antwortet unerwartet (andere Version?)" | Dort läuft ein Stand, der `/api/print` nicht wie erwartet beantwortet – Instanz aktualisieren. |
| Etikettliste weicht ab | Liste kommt von der Gegenseite; `labels.json` dort bearbeiten. |
| Editor lädt, Kopfbereich zeigt Fehler | Normal ohne erreichbare Gegenseite: Bearbeiten und Vorschau funktionieren weiter. |
| Logs | App-Seite → **Protokoll**. |

## Bekannte Grenzen

- **Kein USB im Addon.** Es fordert weder `usb` noch `full_access` an; der
  Drucker muss an einem anderen Rechner hängen (oder das Addon umziehen, siehe
  unten).
- **Kein eigenes Login.** Der Zugriff läuft ausschließlich über Home Assistant;
  die App prüft die Herkunft nicht selbst.
- **Kein MQTT, keine HA-Services.** Das Addon ist reine Oberfläche plus
  Druckauftrag.
- **Druckeroptionen nur auf der Gegenseite**, siehe *Druckweg*.

## Drucker doch direkt am Home-Assistant-Host?

Dann braucht es einen zweiten Weg: in `config.yaml` `usb: true` ergänzen,
`backend: pyusb` konfigurieren und `print_proxy_url` leeren. Das ist bewusst
nicht voreingestellt, weil es deutlich mehr Rechte verlangt.

## Hilfe

Fehler und Wünsche:
<https://github.com/christophmertins/label-printer-web/issues>

## Lizenz

GPL-3.0
