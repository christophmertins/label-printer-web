#!/usr/bin/env bash
# Startet die App im Addon (Supervisor) wie im Standalone-Container.
set -euo pipefail

APP_DIR="${LABEL_WEB_APP_DIR:-/app}"
DATA_DIR="${LABEL_WEB_DATA_DIR:-/data}"
mkdir -p "${DATA_DIR}/templates"

# Addon-Option; im Standalone-Betrieb kommt sie aus der Umgebung.
if [ -z "${LABEL_WEB_PRINT_PROXY:-}" ] && [ -f "${DATA_DIR}/options.json" ]; then
    LABEL_WEB_PRINT_PROXY="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("print_proxy_url") or "")' "${DATA_DIR}/options.json")"
fi
export LABEL_WEB_PRINT_PROXY="${LABEL_WEB_PRINT_PROXY:-}"

# Seeds nur anlegen, nie überschreiben.
[ -f "${DATA_DIR}/labels.json" ] || cp "${APP_DIR}/config/labels.json" "${DATA_DIR}/labels.json"
[ -f "${DATA_DIR}/printer.json" ] || cp "${APP_DIR}/config/printer.json" "${DATA_DIR}/printer.json"
cp -n "${APP_DIR}"/templates/*.json "${DATA_DIR}/templates/" 2>/dev/null || true

export LABEL_WEB_CONFIG_DIR="${DATA_DIR}"
export LABEL_WEB_TEMPLATES_DIR="${DATA_DIR}/templates"

cd "${APP_DIR}"
exec gunicorn --bind 0.0.0.0:5001 --workers 1 --threads 8 --timeout 120 "app:create_app()"
