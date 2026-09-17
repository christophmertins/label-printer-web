import json
import os

DEFAULT_PRINTER = {
    "model": "QL-500",
    "backend": "pyusb",
    "printer": "",
    "dither": False,
    "threshold": 70,
    "compress": True,
    "dpi_600": False,
    "hq": True,
    "cut": True,
    "rotate": "auto",
}

DEFAULT_LABELS = [
    {"id": "62", "name": "62 mm fortlaufend"},
    {"id": "62x100", "name": "62 x 100 mm Versandetikett"},
]


class AppConfig:
    def __init__(self, root_path):
        self.root_path = root_path
        self.config_dir = os.path.abspath(
            os.environ.get("LABEL_WEB_CONFIG_DIR", os.path.join(root_path, "..", "config"))
        )
        self.templates_dir = os.path.abspath(
            os.environ.get("LABEL_WEB_TEMPLATES_DIR", os.path.join(root_path, "..", "templates"))
        )
        self.fonts_dir = os.path.abspath(
            os.environ.get("LABEL_WEB_FONTS_DIR", os.path.join(root_path, "static", "fonts"))
        )
        self.printer = dict(DEFAULT_PRINTER)
        self.printer.update(self._load_json("printer.json"))
        self.labels = self._load_json("labels.json", DEFAULT_LABELS)
        self._apply_env_overrides()

    def _load_json(self, name, default=None):
        path = os.path.join(self.config_dir, name)
        if os.path.exists(path):
            try:
                with open(path, encoding="utf-8") as f:
                    return json.load(f)
            except (OSError, ValueError):
                return default if default is not None else {}
        return default if default is not None else {}

    def _apply_env_overrides(self):
        for key, env in (
            ("model", "BROTHER_MODEL"),
            ("backend", "BROTHER_BACKEND"),
            ("printer", "BROTHER_PRINTER"),
        ):
            if os.environ.get(env):
                self.printer[key] = os.environ[env]

    def font_search_dirs(self):
        return [self.fonts_dir, "/usr/share/fonts/truetype/dejavu", "/System/Library/Fonts", "/Library/Fonts"]