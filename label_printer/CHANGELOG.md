# Changelog

## 1.0.0

- Erste Version als Home-Assistant-Addon: Ingress-Panel, Option
  `print_proxy_url`, Daten und Vorlagen in `/data`, HA-Backup.
- Druck wird per HTTP an die Instanz am Drucker weitergereicht; Etikettliste
  und Druckerstatus kommen von dort.
- Alle Client-URLs relativ, Ingress-Präfix über `X-Ingress-Path` (läuft
  unverändert unter `/`).
- App-Quellen nach `label_printer/` verschoben (Addon-Ordner = Build-Kontext);
  `docker-compose.yml` baut dasselbe Verzeichnis, Daten unter
  `label_printer/data/`.
- Smoke-Tests für Ingress-Präfix und Druck-Proxy.
- Kurze Zeitlimits (2,5 s) für Etikettliste und Status, 30 s für den
  Druckauftrag: ein ausgeschalteter Drucker-Rechner blockiert den Editor nicht
  und der Druckfehler kommt zügig.
- Fremde JSON-Antworten der Gegenseite werden nicht als Etikettliste
  übernommen (Rückfall auf die lokale Liste); Ablehnungen der Gegenseite (4xx)
  melden sich als 400 mit deren Meldung, nicht als „Drucker nicht erreichbar".
- Vorschau-Fehler werden angezeigt statt still zu scheitern.

### Update-Hinweis (Standalone-Docker)

Die App liegt jetzt in `label_printer/`, die Daten in `label_printer/data/`.
Vor dem ersten Start nach dem Update die alten Dateien übernehmen:

```bash
mkdir -p label_printer/data/templates
cp -n config/*.json label_printer/data/ 2>/dev/null
cp -n templates/*.json label_printer/data/templates/ 2>/dev/null
```

Danach `docker compose up --build -d`. Die alten Ordner `config/` und
`templates/` können weg.
