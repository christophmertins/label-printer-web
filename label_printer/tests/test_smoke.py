"""Smoke-Tests ohne Zusatz-Abhängigkeiten: `python -m unittest discover label_printer/tests`."""

import json
import os
import sys
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app import create_app  # noqa: E402


class IngressTest(unittest.TestCase):
    def setUp(self):
        self.app = create_app()
        self.client = self.app.test_client()

    def test_ingress_prefix_reaches_static_urls(self):
        html = self.client.get("/", headers={"X-Ingress-Path": "/api/hassio_ingress/abc"}).get_data(as_text=True)
        self.assertIn('href="/api/hassio_ingress/abc/static/css/app.css"', html)
        self.assertIn('<base href="/api/hassio_ingress/abc/">', html)

    def test_without_ingress_root_paths(self):
        html = self.client.get("/").get_data(as_text=True)
        self.assertIn('href="/static/css/app.css"', html)
        self.assertIn('<base href="/">', html)

    def test_client_uses_relative_api_paths(self):
        static = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "app", "static", "js")
        for name in ("app.js", "editor.js"):
            with open(os.path.join(static, name), encoding="utf-8") as f:
                code = f.read()
            self.assertNotIn("fetch('/api/", code, name)
            self.assertNotIn("'/api/", code, name)

    def test_theme_switch_is_shipped(self):
        html = self.client.get("/").get_data(as_text=True)
        self.assertIn('id="btnTheme"', html)
        self.assertIn('js/theme.js', html)

    def test_foreign_ingress_prefix_is_ignored(self):
        html = self.client.get("/", headers={"X-Ingress-Path": "//evil.example"}).get_data(as_text=True)
        self.assertIn('<base href="/">', html)
        self.assertNotIn("evil.example", html)


class _Stub(BaseHTTPRequestHandler):
    """Minimaler Ersatz für die Alt-Instanz."""

    routes = {}
    calls = []

    def _reply(self, status, payload):
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        type(self).calls.append(("GET", self.path, None))
        status, payload = type(self).routes.get(self.path, (404, {"ok": False, "message": "nicht gefunden"}))
        if isinstance(payload, dict) and payload.get("__sleep__"):
            time.sleep(payload["__sleep__"])
        self._reply(status, payload)

    def do_POST(self):
        length = int(self.headers.get("Content-Length") or 0)
        body = json.loads(self.rfile.read(length) or b"{}")
        type(self).calls.append(("POST", self.path, body))
        status, payload = type(self).routes.get(self.path, (404, {"ok": False, "message": "nicht gefunden"}))
        self._reply(status, payload)

    def log_message(self, *args):
        pass


class ProxyTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = HTTPServer(("127.0.0.1", 0), _Stub)
        cls.port = cls.server.server_address[1]
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()

    def setUp(self):
        _Stub.calls = []
        _Stub.routes = {
            "/api/print": (200, {"ok": True, "message": "gedruckt"}),
            "/api/status": (200, {"connected": True, "model": "QL-500", "backend": "pyusb"}),
            "/api/config": (200, {"labels": [{"id": "62", "name": "62 mm fortlaufend"}], "printer": {"model": "QL-500"}}),
        }
        os.environ["LABEL_WEB_PRINT_PROXY"] = f"http://127.0.0.1:{self.port}"
        self.app = create_app()
        self.client = self.app.test_client()

    def tearDown(self):
        os.environ.pop("LABEL_WEB_PRINT_PROXY", None)

    def test_print_is_forwarded(self):
        resp = self.client.post("/api/print", json={"label_id": "62", "elements": []})
        self.assertEqual(resp.status_code, 200)
        self.assertTrue(resp.get_json()["ok"])
        method, path, body = _Stub.calls[-1]
        self.assertEqual((method, path), ("POST", "/api/print"))
        self.assertEqual(body["label_id"], "62")

    def test_remote_error_message_is_passed_on(self):
        _Stub.routes["/api/print"] = (503, {"ok": False, "message": "Papier leer"})
        resp = self.client.post("/api/print", json={"label_id": "62", "elements": []})
        self.assertEqual(resp.status_code, 503)
        self.assertIn("Papier leer", resp.get_json()["message"])

    def test_unreachable_proxy_is_reported(self):
        os.environ["LABEL_WEB_PRINT_PROXY"] = "http://127.0.0.1:1"
        self.client = create_app().test_client()
        resp = self.client.post("/api/print", json={"label_id": "62", "elements": []})
        self.assertEqual(resp.status_code, 503)
        self.assertIn("nicht erreichbar", resp.get_json()["message"])

    def test_status_and_config_are_forwarded(self):
        self.assertTrue(self.client.get("/api/status").get_json()["connected"])
        labels = self.client.get("/api/config").get_json()["labels"]
        self.assertEqual([entry["id"] for entry in labels], ["62"])

    def test_config_falls_back_to_local_labels(self):
        _Stub.routes.pop("/api/config")
        labels = self.client.get("/api/config").get_json()["labels"]
        self.assertTrue(labels)

    def test_foreign_json_is_not_served_as_config(self):
        _Stub.routes["/api/config"] = (200, {"status": "error", "message": "login required"})
        labels = self.client.get("/api/config").get_json()["labels"]
        self.assertTrue(labels)

    def test_hanging_proxy_falls_back_quickly(self):
        _Stub.routes["/api/config"] = (200, {"__sleep__": 5, "labels": []})
        started = time.monotonic()
        labels = self.client.get("/api/config").get_json()["labels"]
        self.assertLess(time.monotonic() - started, 4.0)
        self.assertTrue(labels)

    def test_remote_rejection_is_not_reported_as_unavailable(self):
        _Stub.routes["/api/print"] = (400, {"ok": False, "message": "Etikett kann nicht gerastert werden"})
        resp = self.client.post("/api/print", json={"label_id": "62", "elements": []})
        self.assertEqual(resp.status_code, 400)
        self.assertIn("gerastert", resp.get_json()["message"])

    def test_remote_success_message_is_shown(self):
        _Stub.routes["/api/print"] = (200, {"ok": True, "message": "Druckauftrag an QL-500 gesendet"})
        resp = self.client.post("/api/print", json={"label_id": "62", "elements": []})
        self.assertIn("QL-500", resp.get_json()["message"])


if __name__ == "__main__":
    unittest.main()
