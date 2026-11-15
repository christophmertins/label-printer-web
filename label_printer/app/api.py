import base64
import logging

from flask import Blueprint, current_app, jsonify, request

from . import print_service, templates_store
from .label_render import is_endless, label_spec, printable_area_mm, render_document, to_png_bytes

api = Blueprint("api", __name__, url_prefix="/api")
log = logging.getLogger(__name__)


def _cfg():
    return current_app.config["app_config"]


@api.get("/config")
def get_config():
    cfg = _cfg()
    base = print_service.proxy_base(cfg)
    if base:
        try:
            status, payload = print_service.proxy_json(
                cfg, "/api/config", timeout=print_service.PROXY_QUICK_TIMEOUT
            )
            if status < 400 and isinstance(payload, dict) and "labels" in payload:
                return jsonify(payload)
            log.warning("Alt-Instanz liefert keine Etikettliste (HTTP %s).", status)
        except print_service.PrinterUnavailableError as exc:
            log.warning("Etikettliste der Alt-Instanz nicht abrufbar: %s", exc)
    labels = []
    for entry in cfg.labels:
        lid = entry.get("id", entry) if isinstance(entry, dict) else entry
        name = entry.get("name") if isinstance(entry, dict) else str(lid)
        try:
            spec = label_spec(str(lid))
        except Exception:
            log.warning("Unbekanntes Etikett im Labels-Config übersprungen: %s", lid)
            continue
        if not spec.works_with_model(cfg.printer.get("model", "QL-500")):
            continue
        endless = is_endless(spec)
        w_mm, h_mm = printable_area_mm(spec)
        labels.append(
            {
                "id": spec.identifier,
                "name": name,
                "endless": endless,
                "width_mm": round(w_mm, 2),
                "length_mm": round(h_mm, 2) if not endless else None,
                "printable_dots": spec.dots_printable,
                "tape_mm": spec.tape_size,
            }
        )
    return jsonify(
        {
            "labels": labels,
            "printer": {
                "model": cfg.printer.get("model"),
                "backend": cfg.printer.get("backend"),
                "printer": cfg.printer.get("printer"),
            },
            "endless_length_range_mm": [10, 1000],
        }
    )


@api.get("/status")
def get_status():
    cfg = _cfg()
    return jsonify(print_service.printer_status(cfg))


@api.get("/templates")
def list_templates():
    cfg = _cfg()
    return jsonify({"templates": templates_store.list_templates(cfg.templates_dir)})


@api.get("/templates/<name>")
def get_template(name):
    cfg = _cfg()
    try:
        doc = templates_store.load_template(cfg.templates_dir, name)
    except templates_store.TemplateError as exc:
        return jsonify({"ok": False, "message": str(exc)}), 404
    return jsonify(doc)


@api.put("/templates/<name>")
def put_template(name):
    cfg = _cfg()
    doc = request.get_json(silent=True)
    if not isinstance(doc, dict):
        return jsonify({"ok": False, "message": "Ungültige Anfrage."}), 400
    try:
        templates_store.save_template(cfg.templates_dir, name, doc)
    except templates_store.TemplateError as exc:
        return jsonify({"ok": False, "message": str(exc)}), 400
    return jsonify({"ok": True, "message": f"Vorlage „{name}“ gespeichert."})


@api.delete("/templates/<name>")
def delete_template(name):
    cfg = _cfg()
    try:
        templates_store.delete_template(cfg.templates_dir, name)
    except templates_store.TemplateError as exc:
        return jsonify({"ok": False, "message": str(exc)}), 404
    return jsonify({"ok": True, "message": f"Vorlage „{name}“ gelöscht."})


@api.post("/preview")
def preview():
    cfg = _cfg()
    doc = request.get_json(silent=True)
    if not isinstance(doc, dict) or not doc.get("label_id"):
        return jsonify({"ok": False, "message": "Ungültiges Dokument."}), 400
    try:
        image, meta = render_document(cfg, doc)
    except Exception as exc:
        log.warning("Vorschau fehlgeschlagen: %s", exc)
        return jsonify({"ok": False, "message": f"Vorschau fehlgeschlagen: {exc}"}), 400
    png = to_png_bytes(image)
    data_uri = "data:image/png;base64," + base64.b64encode(png).decode("ascii")
    return jsonify({"ok": True, "image": data_uri, **meta})


@api.post("/print")
def print_label():
    cfg = _cfg()
    doc = request.get_json(silent=True)
    if not isinstance(doc, dict) or not doc.get("label_id"):
        return jsonify({"ok": False, "message": "Ungültiges Dokument."}), 400

    def render_fn(d):
        return render_document(cfg, d)

    try:
        result = print_service.print_document(cfg, doc, render_fn)
    except print_service.PrinterUnavailableError as exc:
        return jsonify({"ok": False, "message": str(exc)}), 503
    except print_service.LabelError as exc:
        return jsonify({"ok": False, "message": str(exc)}), 400
    except Exception as exc:
        log.exception("Unerwarteter Druckfehler")
        return jsonify({"ok": False, "message": f"Unerwarteter Fehler: {exc}"}), 500

    message = result.get("message") if isinstance(result, dict) else None
    return jsonify(
        {"ok": True, "message": message or "Druckauftrag gesendet.", "detail": result}
    )