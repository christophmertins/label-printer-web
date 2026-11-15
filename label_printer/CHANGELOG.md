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
