import json
import os
import re
import time

_NAME_RE = re.compile(r"^[a-zA-Z0-9äöüÄÖÜß _\-]{1,80}$")


class TemplateError(Exception):
    pass


def _path(templates_dir, name):
    name = (name or "").strip()
    if not _NAME_RE.match(name):
        raise TemplateError("Ungültiger Vorlagenname (erlaubt: Buchstaben, Ziffern, Leerzeichen, _ und -).")
    return os.path.join(templates_dir, name + ".json")


def list_templates(templates_dir):
    result = []
    try:
        names = os.listdir(templates_dir)
    except OSError:
        return result
    for filename in sorted(names):
        if not filename.endswith(".json"):
            continue
        path = os.path.join(templates_dir, filename)
        try:
            with open(path, encoding="utf-8") as f:
                data = json.load(f)
        except (OSError, ValueError):
            continue
        result.append(
            {
                "name": data.get("name") or filename[:-5],
                "file": filename[:-5],
                "label_id": data.get("label_id"),
                "element_count": len(data.get("elements", [])) if isinstance(data.get("elements"), list) else 0,
            }
        )
    return result


def load_template(templates_dir, name):
    path = _path(templates_dir, name)
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except OSError:
        raise TemplateError("Vorlage nicht gefunden.")


def save_template(templates_dir, name, doc):
    if not isinstance(doc, dict):
        raise TemplateError("Ungültiges Dokument.")
    if "elements" not in doc:
        raise TemplateError("Dokument enthält keine Elemente.")
    path = _path(templates_dir, name)
    doc = dict(doc)
    doc["name"] = name
    doc["saved_at"] = time.strftime("%Y-%m-%dT%H:%M:%S")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    try:
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(doc, f, ensure_ascii=False, indent=2)
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp):
            os.remove(tmp)


def delete_template(templates_dir, name):
    path = _path(templates_dir, name)
    try:
        os.remove(path)
    except OSError:
        raise TemplateError("Vorlage nicht gefunden.")